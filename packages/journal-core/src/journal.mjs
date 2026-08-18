import { existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, appendRecord, marker, replaceTarget, unlinkTargetDurable, readJsonIfExists, fsyncDir } from './durable.mjs'
import { fileState, targetKey, sha256, modeOf } from './state.mjs'

const ALLOWED = new Set(['package.json','pnpm-lock.yaml','cordis.patch.yml','.cordis-mp/state.json'])

export class JournalError extends Error { constructor(code, msg){ super(msg); this.code=code } }

export class Journal {
  constructor({ journalRoot, profileRoot, lock = null }) { this.root = journalRoot; this.profile = profileRoot; this.txDir = join(journalRoot,'journal'); this.lock = lock }
  #assertRel(rel){ if(!ALLOWED.has(rel)) throw new JournalError('BAD_TARGET', 'target not allowed: '+rel) }
  #txDir(tx){ return join(this.txDir, tx) }
  #profilePath(rel){ return join(this.profile, rel) }

  async begin(targets) {
    const txid = randomBytes(6).toString('hex')
    const manifest = { v:1, txid, state:'PREPARING', createdAt: Date.now(), targets:{} }
    const dir = this.#txDir(txid); mkdirSync(dir, {recursive:true, mode:0o700})
    for (const rel of targets) {
      this.#assertRel(rel)
      const p = this.#profilePath(rel)
      const st = fileState(p)
      const baseline = { state: st }
      if (st.exists) { baseline.length = readFileSync(p).length; baseline.mode = modeOf(p) || '0644'
        atomicFile(join(dir,'snapshots',targetKey(rel)+'.bin'), readFileSync(p), {mode:0o600}) }
      manifest.targets[rel] = baseline
    }
    manifest.state = 'PREPARED'
    atomicFile(join(dir,'manifest.json'), JSON.stringify(manifest, null, 2), {mode:0o600})
    return txid
  }

  #loadManifest(tx){ const m = readJsonIfExists(join(this.#txDir(tx),'manifest.json')); if(!m) throw new JournalError('NO_MANIFEST','no manifest'); return m }
  #opsPath(tx,rel){ return join(this.#txDir(tx),'ops',targetKey(rel)+'.jsonl') }
  #readOps(tx,rel){ const p=this.#opsPath(tx,rel); if(!existsSync(p)) return []; return readFileSync(p,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{throw new JournalError('BAD_OP','bad op line')}}) }
  #ownedBefore(tx,rel){
    const m=this.#loadManifest(tx); const ops=this.#readOps(tx,rel); const before=m.targets[rel].state
    let owned=before
    for(const op of ops){ if(op.phase==='CONFIRMED') owned=op.next }
    return owned
  }

  #appendOp(tx, rel, {kind, phase, expected, next, mode, length}){
    const m=this.#loadManifest(tx); const before=m.targets[rel].state
    const ops=this.#readOps(tx,rel)
    const seq=ops.length ? ops[ops.length-1].seq + 1 : 1
    const op={v:1,txid:tx,targetKey:targetKey(rel),opId:`${tx}-${seq}`,seq,kind,phase,expected,next,before}
    if(next.exists){op.mode=mode;op.length=length}
    appendRecord(this.#opsPath(tx,rel), JSON.stringify(op))
    return op
  }

  async writePresent(tx, rel, data) {
    this.lock?.fence()
    this.#assertRel(rel)
    const m=this.#loadManifest(tx)
    const current=fileState(this.#profilePath(rel))
    const owned=this.#ownedBefore(tx,rel)
    if(current.hash!==owned.hash || current.exists!==owned.exists) throw new JournalError('CONFLICT','optimistic check failed')
    const next={exists:true, hash:sha256(data)}
    const mode = owned.exists ? (m.targets[rel].mode || this.#lastMode(tx,rel) || '0644') : '0600'
    const op=this.#appendOp(tx,rel,{kind:'FORWARD',phase:'INTENDED',expected:owned,next,mode,length:data.length})
    replaceTarget(this.#profilePath(rel), data, parseInt(mode,8))
    const after=fileState(this.#profilePath(rel))
    if(after.hash!==next.hash||after.exists!==next.exists){ throw new JournalError('CONFLICT','post-write check failed') }
    this.#appendOp(tx,rel,{kind:op.kind,phase:'CONFIRMED',expected:owned,next,mode,length:data.length})
  }

  async deleteTarget(tx, rel) {
    this.lock?.fence()
    this.#assertRel(rel)
    const m=this.#loadManifest(tx)
    const p=this.#profilePath(rel); const current=fileState(p); const owned=this.#ownedBefore(tx,rel)
    if(current.hash!==owned.hash || current.exists!==owned.exists) throw new JournalError('CONFLICT','optimistic check failed')
    const next={exists:false,hash:null}
    const op=this.#appendOp(tx,rel,{kind:'FORWARD',phase:'INTENDED',expected:owned,next})
    unlinkTargetDurable(p)
    const after=fileState(p)
    if(after.exists!==false) throw new JournalError('CONFLICT','post-delete check failed')
    this.#appendOp(tx,rel,{kind:'FORWARD',phase:'CONFIRMED',expected:owned,next})
  }

  #lastMode(tx,rel){ const ops=this.#readOps(tx,rel); for(let i=ops.length-1;i>=0;i--){ if(ops[i].mode) return ops[i].mode } return null }

  async commitFiles(tx){
    this.lock?.fence()
    const m=this.#loadManifest(tx)
    for(const rel of Object.keys(m.targets)){
      const ops=this.#readOps(tx,rel)
      if(!ops.length||ops[ops.length-1].phase!=='CONFIRMED') throw new JournalError('PENDING','unconfirmed target: '+rel)
      const current=fileState(this.#profilePath(rel)); const last=ops[ops.length-1]
      if(current.hash!==last.next.hash||current.exists!==last.next.exists) throw new JournalError('CONFLICT','final check failed: '+rel)
    }
    marker(join(this.#txDir(tx),'COMMITTED'))
    m.state='FILE_COMMITTED'; atomicFile(join(this.#txDir(tx),'manifest.json'), JSON.stringify(m,null,2),{mode:0o600})
    atomicFile(join(this.#txDir(tx),'OUTCOME.json'), JSON.stringify({v:1,txid:tx,outcome:'COMMITTED'}),{mode:0o600})
  }

  scan(){ const out={txs:[]}; if(!existsSync(this.txDir)) return out
    for(const tx of readdirSync(this.txDir)){ const d=join(this.txDir,tx); if(!statSync(d).isDirectory()) continue
      const m=readJsonIfExists(join(d,'manifest.json')); const committed=existsSync(join(d,'COMMITTED')); const outcome=readJsonIfExists(join(d,'OUTCOME.json'))
      out.txs.push({txid:tx, manifest:m, committed, outcome}) }
    return out }

  #verifySnapshots(tx){
    const m=this.#loadManifest(tx)
    for(const [rel,b] of Object.entries(m.targets)){
      if(!b.state.exists) continue
      const snap=join(this.#txDir(tx),'snapshots',targetKey(rel)+'.bin')
      if(!existsSync(snap)) throw new JournalError('SNAPSHOT_MISSING','snapshot missing: '+rel)
      const bytes=readFileSync(snap)
      if(sha256(bytes)!==b.state.hash) throw new JournalError('SNAPSHOT_BAD','snapshot hash mismatch: '+rel)
      if(bytes.length!==b.length) throw new JournalError('SNAPSHOT_BAD','snapshot length mismatch: '+rel)
    }
  }

  async recover(){
    const scan=this.scan(); const report=[]
    for(const t of scan.txs){
      if(t.outcome?.outcome==='COMMITTED'||t.committed){ report.push({txid:t.txid,result:'COMMITTED_OK'}); continue }
      try{ this.#verifySnapshots(t.txid) }catch(e){ report.push({txid:t.txid,result:e.code}); continue }
      const m=this.#loadManifest(t.txid); const classified={}; const conflicts=[]
      for(const rel of Object.keys(m.targets)){
        const r=this.#classify(t.txid,rel,m.targets[rel]); classified[rel]=r
        if(r.conflict) conflicts.push({rel,state:r.current})
      }
      if(conflicts.length){ await this.archiveConflict(t.txid, conflicts); report.push({txid:t.txid,result:'CONFLICTED',conflicts}); continue }
      // Phase 2: 先持久化 pending 判定，再按最新 owned 回滚
      for(const [rel,r] of Object.entries(classified)){
        if(r.pendingAction==='CANCELLED') this.#appendPhase(t.txid,rel,r.pending,'CANCELLED')
        if(r.pendingAction==='CONFIRMED') this.#appendPhase(t.txid,rel,r.pending,'CONFIRMED')
      }
      const rollback=[]
      for(const [rel] of Object.entries(classified)){
        const owned=this.#ownedBefore(t.txid,rel); const b=m.targets[rel].state
        if(owned.hash!==b.hash||owned.exists!==b.exists) rollback.push(rel)
      }
      for(const rel of rollback) await this.#rollbackTarget(t.txid,rel,m)
      atomicFile(join(this.#txDir(t.txid),'OUTCOME.json'), JSON.stringify({v:1,txid:t.txid,outcome:'ROLLED_BACK'}),{mode:0o600})
      report.push({txid:t.txid,result:'ROLLED_BACK'})
    }
    return report
  }

  #appendPhase(tx,rel,op,phase){
    const next={...op, phase}
    appendRecord(this.#opsPath(tx,rel), JSON.stringify(next))
  }

  #classify(tx,rel,baseline){
    const current=fileState(this.#profilePath(rel)); const ops=this.#readOps(tx,rel)
    let owned=baseline.state
    for(const op of ops){ if(op.phase==='CONFIRMED') owned=op.next }
    const pending=ops.length && ops[ops.length-1].phase==='INTENDED' ? ops[ops.length-1] : null
    if(pending){
      if(current.hash===pending.expected.hash&&current.exists===pending.expected.exists) return {conflict:false,current,owned,pending,pendingAction:'CANCELLED'}
      if(current.hash===pending.next.hash&&current.exists===pending.next.exists) return {conflict:false,current,owned:pending.next,pending,pendingAction:'CONFIRMED'}
      return {conflict:true,current,owned,pending,pendingAction:null}
    }
    if(current.hash!==owned.hash||current.exists!==owned.exists) return {conflict:true,current,owned,pending:null,pendingAction:null}
    return {conflict:false,current,owned,pending:null,pendingAction:null}
  }

  async #rollbackTarget(tx,rel,m){
    const baseline=m.targets[rel]; const p=this.#profilePath(rel)
    const owned=this.#ownedBefore(tx,rel)
    const cur=fileState(p)
    if(cur.hash!==owned.hash||cur.exists!==owned.exists) throw new JournalError('CONFLICT','rollback optimistic check failed: '+rel)
    if(baseline.state.exists){
      const bytes=readFileSync(join(this.#txDir(tx),'snapshots',targetKey(rel)+'.bin'))
      const op=this.#appendOp(tx,rel,{kind:'ROLLBACK',phase:'INTENDED',expected:owned,next:baseline.state,mode:baseline.mode,length:bytes.length})
      replaceTarget(p, bytes, parseInt(baseline.mode||'0644',8))
      this.#appendOp(tx,rel,{kind:'ROLLBACK',phase:'CONFIRMED',expected:owned,next:baseline.state,mode:baseline.mode,length:bytes.length})
    } else {
      const op=this.#appendOp(tx,rel,{kind:'ROLLBACK',phase:'INTENDED',expected:owned,next:baseline.state})
      unlinkTargetDurable(p)
      this.#appendOp(tx,rel,{kind:'ROLLBACK',phase:'CONFIRMED',expected:owned,next:baseline.state})
    }
  }

  async archiveConflict(tx, conflicts){
    const d=join(this.root,'conflicts',tx); mkdirSync(join(d,'evidence'),{recursive:true,mode:0o700})
    for(const c of conflicts){
      const rel=c.rel; const p=this.#profilePath(rel); const st=fileState(p)
      if(st.exists) atomicFile(join(d,'evidence',targetKey(rel)+'.bin'), readFileSync(p),{mode:0o600})
      else atomicFile(join(d,'evidence',targetKey(rel)+'.absent.json'), JSON.stringify({exists:false}),{mode:0o600})
    }
    atomicFile(join(d,'report.json'), JSON.stringify({v:1,txid:tx,conflicts},null,2),{mode:0o600})
  }
}
