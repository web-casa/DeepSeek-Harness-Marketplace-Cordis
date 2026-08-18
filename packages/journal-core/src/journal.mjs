import { existsSync, readFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, appendRecord, marker, replaceTarget, unlinkTargetDurable, readJsonIfExists, tombstone, sweepTrash } from './durable.mjs'
import { sweepLockDebris } from './lock.mjs'
import { fileState, targetKey, sha256, modeOf } from './state.mjs'
import { parseOpLog, reduceOps, classifyTarget } from './reducer.mjs'
import { validateManifest, validateOutcome, validateConflictReport, makeRecoveryReport } from './schema.mjs'

const ALLOWED = new Set(['package.json','pnpm-lock.yaml','cordis.patch.yml','.cordis-mp/state.json','.cordis-mp/pending-activation.json'])

export class JournalError extends Error { constructor(code, msg){ super(msg); this.code=code } }

export class Journal {
  constructor({ journalRoot, profileRoot, lock = null }) { this.root = journalRoot; this.profile = profileRoot; this.txDir = join(journalRoot,'journal'); this.lock = lock }
  #assertRel(rel){ if(!ALLOWED.has(rel)) throw new JournalError('BAD_TARGET', 'target not allowed: '+rel) }
  #txDir(tx){ return join(this.txDir, tx) }
  #profilePath(rel){ return join(this.profile, rel) }

  async begin(targets) {
    if (!Array.isArray(targets) || targets.length === 0) throw new JournalError('BAD_TARGETS', 'targets must not be empty')
    this.lock?.fence()
    const active = this.scan().txs.filter(t => !t.committed && !(t.outcome && t.outcome.outcome==='ROLLED_BACK'))
    if (active.length > 0) throw new JournalError('ACTIVE_TX', 'an active journal transaction already exists: ' + active.map(t=>t.txid).join(','))
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

  #loadManifest(tx){ const raw = readJsonIfExists(join(this.#txDir(tx),'manifest.json')); if(!raw) throw new JournalError('NO_MANIFEST','no manifest')
    try { return validateManifest(raw) } catch(e) { throw new JournalError('BAD_MANIFEST', e.message) } }
  #opsPath(tx,rel){ return join(this.#txDir(tx),'ops',targetKey(rel)+'.jsonl') }
  #parseTarget(tx,rel){ const p=this.#opsPath(tx,rel); const lines=existsSync(p)?readFileSync(p,'utf8').split('\n'):[]
    try {
      const parsed=parseOpLog(lines, { txid:tx, rel })
      if(parsed.truncatedTail) console.warn(`[journal-core] ignoring truncated op tail for tx=${tx} rel=${rel}`)
      return parsed
    } catch(e) { throw new JournalError(e.code ?? 'BAD_OP', e.message) } }
  #validatedTarget(tx,rel){ const parsed=this.#parseTarget(tx,rel); const baseline=this.#loadManifest(tx).targets[rel]
    return reduceOps(parsed, baseline) }
  #ownedBefore(tx,rel){ return this.#validatedTarget(tx,rel).owned }

  #beginOp(tx, rel, {kind, expected, next, mode, length}){
    const m=this.#loadManifest(tx)
    const v=this.#validatedTarget(tx,rel)
    if(v.pending) throw new JournalError('PENDING','previous op is pending INTENDED')
    const seq=v.records.length ? v.records[v.records.length-1].seq + 1 : 1
    const op={v:1,txid:tx,targetKey:targetKey(rel),opId:`${tx}-${seq}`,seq,kind,phase:'INTENDED',expected,next,before:expected}
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
    if(!owned.exists) throw new JournalError('BAD_TARGET_STATE','cannot delete absent target: '+rel)
    if(current.hash!==owned.hash || current.exists!==owned.exists) throw new JournalError('CONFLICT','optimistic check failed')
    const next={exists:false,hash:null}
    const op=this.#beginOp(tx,rel,{kind:'FORWARD',expected:owned,next})
    this.lock?.fence(); unlinkTargetDurable(p)
    if(fileState(p).exists) throw new JournalError('CONFLICT','post-delete check failed')
    this.#appendPhase(tx,rel,op,'CONFIRMED')
  }

  #lastMode(tx,rel){ const ops=this.#parseTarget(tx,rel).records; for(let i=ops.length-1;i>=0;i--){ if(ops[i].mode) return ops[i].mode } return null }

  async commitFiles(tx){
    this.lock?.fence()
    const m=this.#loadManifest(tx)
    for(const rel of Object.keys(m.targets)){
      const v=this.#validatedTarget(tx,rel)
      if(v.pending) throw new JournalError('PENDING','unconfirmed target: '+rel)
      const current=fileState(this.#profilePath(rel))
      const baseline=m.targets[rel].state
      // 未写入且当前等于 baseline 的目标视为 no-op，允许提交
      if(v.records.length===0 && current.exists===baseline.exists && current.hash===baseline.hash) continue
      if(current.hash!==v.owned.hash||current.exists!==v.owned.exists) throw new JournalError('CONFLICT','final check failed: '+rel)
    }
    this.lock?.fence(); marker(join(this.#txDir(tx),'COMMITTED'))
    m.state='FILE_COMMITTED'; atomicFile(join(this.#txDir(tx),'manifest.json'), JSON.stringify(m,null,2),{mode:0o600})
    this.lock?.fence(); atomicFile(join(this.#txDir(tx),'OUTCOME.json'), JSON.stringify({v:1,txid:tx,outcome:'COMMITTED'}),{mode:0o600})
  }

  getBaseline(tx){ return this.#loadManifest(tx).targets }
  readSnapshot(tx, rel){ const b=this.getBaseline(tx)[rel]; if(!b) return null; if(!b.state.exists) return null; return readFileSync(join(this.#txDir(tx),'snapshots',targetKey(rel)+'.bin')) }
  txExists(tx){ return existsSync(join(this.#txDir(tx),'manifest.json')) }
  hasConflict(tx){ return this.#conflictStatus(tx) === 'conflicted' }
  #conflictStatus(tx){
    const reportPath=join(this.root,'conflicts',tx,'report.json')
    if(!existsSync(reportPath)) return 'none'
    let report
    try { report=validateConflictReport(JSON.parse(readFileSync(reportPath,'utf8'))) } catch { return 'bad-report' }
    if(report.txid!==tx) return 'bad-report'
    const ev=join(this.root,'conflicts',tx,'evidence')
    if(Array.isArray(report.evidence)){
      for(const e of report.evidence){
        if(!e || typeof e.name!=='string' || typeof e.hash!=='string' || !Number.isInteger(e.length)) return 'bad-report'
        const f=join(ev,e.name)
        try {
          if(!existsSync(f)) return 'bad-evidence'
          const bytes=readFileSync(f)
          if(sha256(bytes)!==e.hash || bytes.length!==e.length) return 'bad-evidence'
        } catch { return 'bad-evidence' }
      }
    }
    for(const c of report.conflicts){
      if(!c || typeof c.rel!=='string' || !c.state) return 'bad-report'
      const f=join(ev,targetKey(c.rel)+'.bin')
      const a=join(ev,targetKey(c.rel)+'.absent.json')
      if(c.state.exists){
        if(!existsSync(f)) return 'bad-evidence'
        try { if(sha256(readFileSync(f))!==c.state.hash) return 'bad-evidence' } catch { return 'bad-evidence' }
      } else if(!existsSync(a)) return 'bad-evidence'
    }
    return 'conflicted'
  }

  scan(){ const out={txs:[]}; if(!existsSync(this.txDir)) return out
    for(const tx of readdirSync(this.txDir)){ const d=join(this.txDir,tx); if(!statSync(d).isDirectory()) continue
      let m=null, manifestInvalid=false
      try { const raw=readJsonIfExists(join(d,'manifest.json')); if(raw) m=validateManifest(raw) } catch { manifestInvalid=true }
      const committed=existsSync(join(d,'COMMITTED'))
      let outcome=null, outcomeInvalid=false
      const op=join(d,'OUTCOME.json')
      if(existsSync(op)){ try{ outcome=validateOutcome(JSON.parse(readFileSync(op,'utf8'))) }catch{ outcomeInvalid=true } }
      out.txs.push({txid:tx, manifest:m, manifestInvalid, committed, outcome, outcomeInvalid}) }
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

  async recoverReport(){ return makeRecoveryReport(await this.#recoverEntries()) }
  async #safeArchive(tx, conflicts){
    try { await this.archiveConflict(tx, conflicts); return null }
    catch(e) { if(e.code==='FP_INJECTED') throw e; console.warn(`[journal-core] archiveConflict failed for ${tx}: ${e.code ?? e.message}`); return e.code ?? 'EVIDENCE_ERROR' }
  }
  async recover(){ return this.#recoverEntries() }
  async #recoverEntries(){
    sweepLockDebris(this.root)
    sweepTrash(this.root)
    const scan=this.scan(); const report=[]
    // 两阶段：先全局只读预检，再执行
    const pre=[]
    for(const t of scan.txs){
      if(t.manifestInvalid){ report.push({txid:t.txid,result:'BAD_MANIFEST'}); continue }
      const conflictStatus=this.#conflictStatus(t.txid)
      if(conflictStatus==='conflicted'){ report.push({txid:t.txid,result:'CONFLICTED_EXISTING'}); continue }
      if(conflictStatus!=='none'){ report.push({txid:t.txid,result: conflictStatus==='bad-evidence' ? 'BAD_EVIDENCE' : 'BAD_REPORT'}); continue }
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
    outer: for(const p of pre){
      if(p.committed){
        const m=this.#loadManifest(p.t.txid); const bad=[]
        for(const rel of Object.keys(m.targets)){
          let v; try{ v=this.#validatedTarget(p.t.txid,rel) }catch(e){ report.push({txid:p.t.txid,result:e.code}); continue outer }
          const cur=fileState(this.#profilePath(rel))
          if(v.pending || cur.hash!==v.owned.hash || cur.exists!==v.owned.exists) bad.push(rel)
        }
        if(bad.length){ await this.#safeArchive(p.t.txid,bad.map(rel=>({rel,state:fileState(this.#profilePath(rel))}))); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue }
        if(p.t.outcomeInvalid){ report.push({txid:p.t.txid,result:'BAD_OUTCOME'}); continue }
        if(p.t.outcome && p.t.outcome.outcome!=='COMMITTED'){ report.push({txid:p.t.txid,result:'BAD_OUTCOME'}); continue }
        if(!p.t.outcome) atomicFile(join(this.#txDir(p.t.txid),'OUTCOME.json'), JSON.stringify({v:1,txid:p.t.txid,outcome:'COMMITTED'}),{mode:0o600})
        tombstone('journal', this.#txDir(p.t.txid))
        report.push({txid:p.t.txid,result:'COMMITTED_OK'})
        continue
      }
      if(p.conflicts.length){ await this.#safeArchive(p.t.txid, p.conflicts); report.push({txid:p.t.txid,result:'CONFLICTED',conflicts:p.conflicts}); continue }
      // Phase 2：每个 planned append 前复核 current
      for(const [rel,r] of Object.entries(p.classified)){
        if(r.pendingAction==='CANCELLED'){ const cur=fileState(this.#profilePath(rel)); if(cur.hash!==r.pending.expected.hash||cur.exists!==r.pending.expected.exists){ await this.#safeArchive(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue outer }
          this.#appendPhase(p.t.txid,rel,r.pending,'CANCELLED') }
        if(r.pendingAction==='CONFIRMED'){ const cur=fileState(this.#profilePath(rel)); if(cur.hash!==r.pending.next.hash||cur.exists!==r.pending.next.exists){ await this.#safeArchive(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue outer }
          this.#appendPhase(p.t.txid,rel,r.pending,'CONFIRMED') }
      }
      const rollback=[]
      for(const [rel] of Object.entries(p.classified)){
        const owned=this.#ownedBefore(p.t.txid,rel); const b=p.m.targets[rel].state
        if(owned.hash!==b.hash||owned.exists!==b.exists) rollback.push(rel)
      }
      for(const rel of rollback){
        try{ await this.#rollbackTarget(p.t.txid,rel,p.m) }
        catch(e){ if(e.code==='FP_INJECTED') throw e; await this.#safeArchive(p.t.txid,[{rel,state:fileState(this.#profilePath(rel))}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue outer }
      }
      // 最终复核：所有 target 必须等于 baseline 才允许宣告 ROLLED_BACK
      for(const rel of Object.keys(p.m.targets)){
        const cur=fileState(this.#profilePath(rel)); const b=p.m.targets[rel].state
        if(cur.exists!==b.exists || cur.hash!==b.hash){
          await this.#safeArchive(p.t.txid,[{rel,state:cur}]); report.push({txid:p.t.txid,result:'CONFLICTED'}); continue outer
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
    const d=join(this.root,'conflicts',tx)
    if(existsSync(join(d,'report.json'))) throw new JournalError('JOURNALLED','conflict report already exists for tx: '+tx)
    mkdirSync(join(d,'evidence'),{recursive:true,mode:0o700})
    const txd=this.#txDir(tx); const entries=[]
    const addEntry=(relPath, bytes)=>{
      const target=join(d,'evidence',relPath)
      mkdirSync(dirname(target),{recursive:true,mode:0o700})
      atomicFile(target, bytes, {mode:0o600})
      entries.push({name:relPath, hash:sha256(bytes), length:bytes.length})
    }
    // 复制 manifest/ops/snapshots 作为证据（不修改原 journal 内容）
    if(existsSync(join(txd,'manifest.json'))) addEntry('manifest.json', readFileSync(join(txd,'manifest.json')))
    const opsDir=join(txd,'ops'); if(existsSync(opsDir)){ for(const f of readdirSync(opsDir)) addEntry('ops/'+f, readFileSync(join(opsDir,f))) }
    const snapDir=join(txd,'snapshots'); if(existsSync(snapDir)){ for(const f of readdirSync(snapDir)) addEntry('snapshots/'+f, readFileSync(join(snapDir,f))) }
    for(const c of conflicts){
      const rel=c.rel; const p=this.#profilePath(rel); const st=fileState(p)
      if(st.exists){ const bytes=readFileSync(p); addEntry(targetKey(rel)+'.bin', bytes)
        if(sha256(bytes)!==st.hash) throw new JournalError('EVIDENCE_BAD','evidence copy hash mismatch') }
      else addEntry(targetKey(rel)+'.absent.json', Buffer.from(JSON.stringify({exists:false})))
    }
    atomicFile(join(d,'evidence-manifest.json'), JSON.stringify({v:1,txid:tx,entries},null,2),{mode:0o600})
    atomicFile(join(d,'report.json'), JSON.stringify({v:1,txid:tx,detectedAt:Date.now(),conflicts,evidence:entries},null,2),{mode:0o600})
    const m=this.#loadManifest(tx); m.state='CONFLICTED'; atomicFile(join(txd,'manifest.json'), JSON.stringify(m,null,2),{mode:0o600})
  }
}
