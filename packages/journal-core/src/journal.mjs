import { existsSync, readFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, appendRecord, marker, replaceTarget, unlinkTargetDurable, readJsonIfExists, tombstone } from './durable.mjs'
import { fileState, targetKey, sha256, modeOf } from './state.mjs'
import { parseOpLog, reduceOps, classifyTarget } from './reducer.mjs'

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
      const p = this.#profilePath(rel); const st = fileState(p); const baseline = { state: st }
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
  #readOps(tx,rel){
    const p=this.#opsPath(tx,rel); if(!existsSync(p)) return []
    const lines=readFileSync(p,'utf8').split('\n')
    try { return parseOpLog(lines, { txid:tx, rel }).records } catch(e) { throw new JournalError(e.code ?? 'BAD_OP', e.message) }
  }
  #parseTarget(tx,rel){ const p=this.#opsPath(tx,rel); const lines=existsSync(p)?readFileSync(p,'utf8').split('\n'):[]
    try { return parseOpLog(lines, { txid:tx, rel }) } catch(e) { throw new JournalError(e.code ?? 'BAD_OP', e.message) } }
  #validatedTarget(tx,rel){ const parsed=this.#parseTarget(tx,rel); const baseline=this.#loadManifest(tx).targets[rel]
    return reduceOps(parsed, baseline) }
  #ownedBefore(tx,rel){ return this.#validatedTarget(tx,rel).owned }

  #beginOp(tx, rel, {kind, expected, next, mode, length}){
    const m=this.#loadManifest(tx)
    const v=this.#validatedTarget(tx,rel)
    if(v.pending) throw new JournalError('PENDING','previous op is pending INTENDED')
    const seq=v.records.length ? v.records[v.records.length-1].seq + 1 : 1
    const op={v:1,txid:tx,targetKey:targetKey(rel),opId:`${tx}-${seq}`,seq,kind,phase:'INTENDED',expected,next,before:m.targets[rel].state}
    if(next.exists){ op.mode=mode; op.length=length }
    appendRecord(this.#opsPath(tx,rel), JSON.stringify(op))
    return op
  }
  #appendPhase(tx, rel, op, phase){ this.lock?.fence(); appendRecord(this.#opsPath(tx,rel), JSON.stringify({...op, phase})) }

  async writePresent(tx, rel, data) {
    this.lock?.fence(); this.#assertRel(rel)
    const m=this.#loadManifest(tx); const p=this.#profilePath(rel)
    const current=fileState(p); const owned=this.#ownedBefore(tx,rel)
    if(current.hash!==owned.hash || current.exists!==owned.exists) throw new JournalError('CONFLICT','optimistic check failed')
    const next={exists:true, hash:sha256(data)}
    const mode = owned.exists ? (this.#lastMode(tx,rel) || m.targets[rel].mode || '0644') : '0600'
    const op=this.#beginOp(tx,rel,{kind:'FORWARD',expected:owned,next,mode,length:data.length})
    this.lock?.fence(); replaceTarget(p, data, parseInt(mode,8))
    const after=fileState(p)
    if(after.hash!==next.hash||after.exists!==next.exists) throw new JournalError('CONFLICT','post-write check failed')
    this.#appendPhase(tx,rel,op,'CONFIRMED')
  }

  async deleteTarget(tx, rel) {
    this.lock?.fence(); this.#assertRel(rel)
    const p=this.#profilePath(rel); const current=fileState(p); const owned=this.#ownedBefore(tx,rel)
    if(current.hash!==owned.hash || current.exists!==owned.exists) throw new JournalError('CONFLICT','optimistic check failed')
    const next={exists:false,hash:null}
    const op=this.#beginOp(tx,rel,{kind:'FORWARD',expected:owned,next})
    this.lock?.fence(); unlinkTargetDurable(p)
    if(fileState(p).exists) throw new JournalError('CONFLICT','post-delete check failed')
    this.#appendPhase(tx,rel,op,'CONFIRMED')
  }

  #lastMode(tx,rel){ const ops=this.#readOps(tx,rel); for(let i=ops.length-1;i>=0;i--){ if(ops[i].mode) return ops[i].mode } return null }

  async commitFiles(tx){
    this.lock?.fence()
    const m=this.#loadManifest(tx)
    for(const rel of Object.keys(m.targets)){
      const v=this.#validatedTarget(tx,rel)
      if(v.pending) throw new JournalError('PENDING','unconfirmed target: '+rel)
      const current=fileState(this.#profilePath(rel))
      if(current.hash!==v.owned.hash||current.exists!==v.owned.exists) throw new JournalError('CONFLICT','final check failed: '+rel)
    }
    this.lock?.fence(); marker(join(this.#txDir(tx),'COMMITTED'))
    m.state='FILE_COMMITTED'; atomicFile(join(this.#txDir(tx),'manifest.json'), JSON.stringify(m,null,2),{mode:0o600})
    atomicFile(join(this.#txDir(tx),'OUTCOME.json'), JSON.stringify({v:1,txid:tx,outcome:'COMMITTED'}),{mode:0o600})
  }

  getBaseline(tx){ return this.#loadManifest(tx).targets }
  readSnapshot(tx, rel){ const b=this.getBaseline(tx)[rel]; if(!b) return null; if(!b.state.exists) return null; return readFileSync(join(this.#txDir(tx),'snapshots',targetKey(rel)+'.bin')) }
  txExists(tx){ return existsSync(join(this.#txDir(tx),'manifest.json')) }
  hasConflict(tx){ return existsSync(join(this.root,'conflicts',tx,'report.json')) }

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
    // 两阶段：先全局只读预检，再执行
    const pre=[]
    for(const t of scan.txs){
      if(this.hasConflict(t.txid)){ report.push({txid:t.txid,result:'CONFLICTED_EXISTING'}); continue }
      if(t.committed){
        pre.push({t, committed:true}); continue
      }
      try{ this.#verifySnapshots(t.txid) }catch(e){ report.push({txid:t.txid,result:e.code}); continue }
      const m=this.#loadManifest(t.txid); const classified={}; const conflicts=[]; let bad=false
      for(const rel of Object.keys(m.targets)){
        try{ const r=this.#classify(t.txid,rel,m.targets[rel]); classified[rel]=r; if(r.conflict) conflicts.push({rel,state:r.current}) }
        catch(e){ report.push({txid:t.txid,result:e.code}); bad=true; break }
      }
      if(bad) continue
      pre.push({t, committed:false, m, classified, conflicts})
    }
    for(const p of pre){
      if(p.committed){
        const m=this.#loadManifest(p.t.txid); const bad=[]
        for(const rel of Object.keys(m.targets)){
          let v; try{ v=this.#validatedTarget(p.t.txid,rel) }catch(e){ report.push({txid:p.t.txid,result:e.code}); return report }
          const cur=fileState(this.#profilePath(rel))
          if(v.pending || cur.hash!==v.owned.hash || cur.exists!==v.owned.exists) bad.push(rel)
        }
        if(bad.length){ await this.archiveConflict(p.t.txid,bad.map(rel=>({rel,state:fileState(this.#profilePath(rel))}))); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue }
        if(p.t.outcome && p.t.outcome.outcome!=='COMMITTED'){ report.push({txid:p.t.txid,result:'BAD_OUTCOME'}); continue }
        if(!p.t.outcome?.outcome) atomicFile(join(this.#txDir(p.t.txid),'OUTCOME.json'), JSON.stringify({v:1,txid:p.t.txid,outcome:'COMMITTED'}),{mode:0o600})
        tombstone('journal', this.#txDir(p.t.txid))
        report.push({txid:p.t.txid,result:'COMMITTED_OK'})
        continue
      }
      if(p.conflicts.length){ await this.archiveConflict(p.t.txid, p.conflicts); report.push({txid:p.t.txid,result:'CONFLICTED',conflicts:p.conflicts}); continue }
      // Phase 2：每个 planned append 前复核 current
      for(const [rel,r] of Object.entries(p.classified)){
        if(r.pendingAction==='CANCELLED'){ const cur=fileState(this.#profilePath(rel)); if(cur.hash!==r.pending.expected.hash||cur.exists!==r.pending.expected.exists){ await this.archiveConflict(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); return report }
          this.#appendPhase(p.t.txid,rel,r.pending,'CANCELLED') }
        if(r.pendingAction==='CONFIRMED'){ const cur=fileState(this.#profilePath(rel)); if(cur.hash!==r.pending.next.hash||cur.exists!==r.pending.next.exists){ await this.archiveConflict(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); return report }
          this.#appendPhase(p.t.txid,rel,r.pending,'CONFIRMED') }
      }
      const rollback=[]
      for(const [rel] of Object.entries(p.classified)){
        const owned=this.#ownedBefore(p.t.txid,rel); const b=p.m.targets[rel].state
        if(owned.hash!==b.hash||owned.exists!==b.exists) rollback.push(rel)
      }
      for(const rel of rollback){
        try{ await this.#rollbackTarget(p.t.txid,rel,p.m) }
        catch(e){ if(e.code==='FP_INJECTED') throw e; await this.archiveConflict(p.t.txid,[{rel,state:fileState(this.#profilePath(rel))}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); return report }
      }
      // 最终复核：所有 target 必须等于 baseline 才允许宣告 ROLLED_BACK
      for(const rel of Object.keys(p.m.targets)){
        const cur=fileState(this.#profilePath(rel)); const b=p.m.targets[rel].state
        if(cur.exists!==b.exists || cur.hash!==b.hash){
          await this.archiveConflict(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); return report
        }
      }
      atomicFile(join(this.#txDir(p.t.txid),'OUTCOME.json'), JSON.stringify({v:1,txid:p.t.txid,outcome:'ROLLED_BACK'}),{mode:0o600})
      report.push({txid:p.t.txid,result:'ROLLED_BACK'})
    }
    return report
  }

  #classify(tx,rel,baseline){
    const current=fileState(this.#profilePath(rel))
    const parsed=this.#parseTarget(tx,rel)
    const plan=classifyTarget(parsed, baseline, current)
    return { ...plan, current }
  }

  async #rollbackTarget(tx,rel,m){
    const baseline=m.targets[rel]; const p=this.#profilePath(rel); const owned=this.#ownedBefore(tx,rel)
    const cur=fileState(p)
    if(cur.hash!==owned.hash||cur.exists!==owned.exists) throw new JournalError('CONFLICT','rollback optimistic check failed: '+rel)
    if(baseline.state.exists){
      const bytes=readFileSync(join(this.#txDir(tx),'snapshots',targetKey(rel)+'.bin'))
      const op=this.#beginOp(tx,rel,{kind:'ROLLBACK',expected:owned,next:baseline.state,mode:baseline.mode,length:bytes.length})
      this.lock?.fence(); replaceTarget(p, bytes, parseInt(baseline.mode||'0644',8))
      const after=fileState(p)
      if(after.hash!==baseline.state.hash||after.exists!==baseline.state.exists) throw new JournalError('CONFLICT','rollback post-check failed: '+rel)
      this.#appendPhase(tx,rel,op,'CONFIRMED')
    } else {
      const op=this.#beginOp(tx,rel,{kind:'ROLLBACK',expected:owned,next:baseline.state})
      this.lock?.fence(); unlinkTargetDurable(p)
      const after=fileState(p)
      if(after.exists!==false) throw new JournalError('CONFLICT','rollback delete post-check failed: '+rel)
      this.#appendPhase(tx,rel,op,'CONFIRMED')
    }
  }

  async archiveConflict(tx, conflicts){
    const d=join(this.root,'conflicts',tx); mkdirSync(join(d,'evidence'),{recursive:true,mode:0o700})
    const txd=this.#txDir(tx)
    // 复制 manifest/ops/snapshots 作为证据（不修改原 journal 内容）
    if(existsSync(join(txd,'manifest.json'))) copyFileSync(join(txd,'manifest.json'), join(d,'evidence','manifest.json'))
    const opsDir=join(txd,'ops'); if(existsSync(opsDir)){ mkdirSync(join(d,'evidence','ops'),{recursive:true,mode:0o700}); for(const f of readdirSync(opsDir)) copyFileSync(join(opsDir,f), join(d,'evidence','ops',f)) }
    const snapDir=join(txd,'snapshots'); if(existsSync(snapDir)){ mkdirSync(join(d,'evidence','snapshots'),{recursive:true,mode:0o700}); for(const f of readdirSync(snapDir)) copyFileSync(join(snapDir,f), join(d,'evidence','snapshots',f)) }
    for(const c of conflicts){
      const rel=c.rel; const p=this.#profilePath(rel); const st=fileState(p)
      if(st.exists){ const bytes=readFileSync(p); atomicFile(join(d,'evidence',targetKey(rel)+'.bin'), bytes,{mode:0o600})
        if(sha256(bytes)!==st.hash) throw new JournalError('EVIDENCE_BAD','evidence copy hash mismatch') }
      else atomicFile(join(d,'evidence',targetKey(rel)+'.absent.json'), JSON.stringify({exists:false}),{mode:0o600})
    }
    atomicFile(join(d,'report.json'), JSON.stringify({v:1,txid:tx,detectedAt:Date.now(),conflicts},null,2),{mode:0o600})
    const m=this.#loadManifest(tx); m.state='CONFLICTED'; atomicFile(join(txd,'manifest.json'), JSON.stringify(m,null,2),{mode:0o600})
  }
}
