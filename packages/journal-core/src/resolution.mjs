import { existsSync, readFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, marker, replaceTarget, unlinkTargetDurable, readJsonIfExists, tombstone, fsyncDir } from './durable.mjs'
import { fileState, fingerprint, targetKey } from './state.mjs'
import { JournalError } from './journal.mjs'

export class ResolutionError extends JournalError {}

export class ResolutionJournal {
  constructor(journal){ this.journal = journal; this.root = journal.root; this.profile = journal.profile; this.dir = join(this.root,'resolutions') }

  #dir(rid){ return join(this.dir, rid) }
  #manifest(rid){ const m=readJsonIfExists(join(this.#dir(rid),'manifest.json')); if(!m) throw new ResolutionError('NO_MANIFEST','resolution manifest missing: '+rid); return m }
  #writeManifest(rid,m){ atomicFile(join(this.#dir(rid),'manifest.json'), JSON.stringify(m,null,2), {mode:0o600}) }
  #opPath(rid,rel){ return join(this.#dir(rid),'ops',targetKey(rel)+'.json') }
  #confirmedPath(rid,rel){ return join(this.#dir(rid),'confirmed',targetKey(rel)) }
  #validationPath(rid){ return join(this.#dir(rid),'validation.json') }
  #outcomePath(rid){ return join(this.#dir(rid),'OUTCOME.json') }

  list(){ const out=[]; if(!existsSync(this.dir)) return out
    for(const name of readdirSync(this.dir)){ const d=join(this.dir,name); if(!statSync(d).isDirectory()) continue
      const m=readJsonIfExists(join(d,'manifest.json')); const outcome=readJsonIfExists(join(d,'OUTCOME.json')); out.push({rid:name,manifest:m,outcome}) }
    return out }

  #headsForTx(tx){
    const list=this.list().filter(r=>r.manifest?.txid===tx)
    const superseded=new Set()
    for(const r of list){ if(r.manifest?.supersedes) superseded.add(r.manifest.supersedes) }
    // head = 未被任何同 tx manifest.supersedes 指向
    return list.filter(r=>!superseded.has(r.rid))
  }

  async beginResolution({ tx, action, plan = null }){
    if(!this.journal.txExists(tx)) throw new ResolutionError('NO_TX','unknown tx: '+tx)
    if(action==='restore-snapshot' && !plan) throw new ResolutionError('BAD_PLAN','plan required for restore-snapshot')
    if(action==='accept-current' && plan) throw new ResolutionError('BAD_PLAN','plan not allowed for accept-current')
    const heads=this.#headsForTx(tx)
    if(heads.length>1) throw new ResolutionError('MULTIPLE_HEADS','multiple resolution heads for tx')
    const rid=randomBytes(6).toString('hex')
    const manifest={ v:1, resolutionId:rid, txid:tx, createdAt:Date.now(), supersedes:null, action, state:'PLANNED', plan }
    if(heads.length===1){
      const old=heads[0]
      // v7 顺序：先持久化新 manifest（含 supersedes 边），再补写旧 SUPERSEDED
      manifest.supersedes=old.rid
      mkdirSync(this.#dir(rid),{recursive:true,mode:0o700})
      this.#writeManifest(rid,manifest)
      if(!old.outcome || old.outcome.outcome!=='SUPERSEDED'){
        try{ atomicFile(join(this.#dir(old.rid),'OUTCOME.json'), JSON.stringify({v:1,resolutionId:old.rid,outcome:'SUPERSEDED'}), {mode:0o600}) } catch(e){ throw new ResolutionError('SUPERSEDE_FAILED', e.message) }
      }
    } else {
      mkdirSync(this.#dir(rid),{recursive:true,mode:0o700}); this.#writeManifest(rid,manifest)
    }
    return rid
  }

  async resolveTarget(rid, rel){
    const m=this.#manifest(rid)
    if(m.action!=='restore-snapshot') throw new ResolutionError('BAD_ACTION','resolveTarget only for restore-snapshot')
    const plan=m.plan?.[rel]; if(!plan) throw new ResolutionError('BAD_REL','rel not in plan')
    const p=join(this.profile,rel); const current=fileState(p)
    const opPath=this.#opPath(rid,rel); const confirmed=this.#confirmedPath(rid,rel)
    if(existsSync(confirmed)){
      if(current.exists===plan.next.exists && current.hash===plan.next.hash) return 'DONE'
      if(current.exists===plan.expected.exists && current.hash===plan.expected.hash){ unlinkSync(confirmed); fsyncDir(this.#dir(rid)); }
      else throw new ResolutionError('RESOLUTION_CONFLICT','current changed after confirmed: '+rel)
    }
    if(!existsSync(opPath)) atomicFile(opPath, JSON.stringify({v:1,resolutionId:rid,txid:m.txid,rel,targetKey:targetKey(rel),expected:plan.expected,next:plan.next}), {mode:0o600})
    if(current.exists===plan.next.exists && current.hash===plan.next.hash){ marker(confirmed); return 'DONE' }
    if(!(current.exists===plan.expected.exists && current.hash===plan.expected.hash)) throw new ResolutionError('RESOLUTION_CONFLICT','current != expected/next: '+rel)
    // 执行恢复写：next == 原 baseline；字节来自原 journal snapshot
    const baseline=this.journal.getBaseline(m.txid)[rel]
    if(!baseline) throw new ResolutionError('BAD_REL','rel missing in original baseline')
    if(plan.next.exists){
      const bytes=this.journal.readSnapshot(m.txid,rel)
      if(!bytes) throw new ResolutionError('SNAPSHOT_MISSING','snapshot missing for restore: '+rel)
      replaceTarget(p, bytes, parseInt(baseline.mode||'0644',8))
    } else {
      unlinkTargetDurable(p)
    }
    const after=fileState(p)
    if(after.exists!==plan.next.exists || after.hash!==plan.next.hash) throw new ResolutionError('RESOLUTION_CONFLICT','post-write check failed: '+rel)
    marker(confirmed)
    return 'DONE'
  }

  async recordValidation(rid, evidence){
    const m=this.#manifest(rid)
    if(m.action!=='accept-current') throw new ResolutionError('BAD_ACTION','recordValidation only for accept-current')
    if(evidence?.valid!==true) throw new ResolutionError('BAD_EVIDENCE','evidence.valid must be true')
    const currentFp=this.#currentFingerprint()
    if(evidence.fingerprint!==currentFp) throw new ResolutionError('FINGERPRINT_MISMATCH','current fingerprint does not match evidence')
    atomicFile(this.#validationPath(rid), JSON.stringify({v:1,resolutionId:rid,valid:true,fingerprint:currentFp,baselineReport:evidence.baselineReport??null,createdAt:Date.now()},null,2), {mode:0o600, exclusive:true})
  }

  #currentFingerprint(){
    // 原 journal 的 target 集合定义 fingerprint 范围
    const txids=new Set(this.list().map(r=>r.manifest?.txid).filter(Boolean))
    if(txids.size!==1) throw new ResolutionError('BAD_STATE','cannot derive single tx for fingerprint')
    const tx=[...txids][0]
    const baseline=this.journal.getBaseline(tx)
    const states={}
    for(const rel of Object.keys(baseline)) states[rel]=fileState(join(this.profile,rel))
    return fingerprint(states)
  }

  async completeResolution(rid){
    const m=this.#manifest(rid)
    if(m.action==='restore-snapshot'){
      for(const [rel,plan] of Object.entries(m.plan)){
        const cur=fileState(join(this.profile,rel))
        if(cur.exists!==plan.next.exists || cur.hash!==plan.next.hash){
          atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'RESOLUTION_CONFLICTED'}), {mode:0o600})
          return {outcome:'RESOLUTION_CONFLICTED'}
        }
      }
      atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'RESOLVED'}), {mode:0o600})
      return {outcome:'RESOLVED'}
    }
    if(m.action==='accept-current'){
      const val=readJsonIfExists(this.#validationPath(rid))
      if(!val || val.valid!==true) throw new ResolutionError('NO_VALIDATION','no validation evidence')
      const fp=this.#currentFingerprint()
      if(fp!==val.fingerprint){
        atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'RESOLUTION_CONFLICTED'}), {mode:0o600})
        return {outcome:'RESOLUTION_CONFLICTED'}
      }
      atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'ACCEPTED_CURRENT'}), {mode:0o600})
      return {outcome:'ACCEPTED_CURRENT'}
    }
    throw new ResolutionError('BAD_ACTION','unknown action')
  }

  scan(){
    const list=this.list(); const byTx={}
    for(const r of list){ const tx=r.manifest?.txid; if(!tx) continue; (byTx[tx]??=[]).push(r) }
    const report=[]
    for(const [tx,rs] of Object.entries(byTx)){
      const superseded=new Set(); for(const r of rs){ if(r.manifest?.supersedes) superseded.add(r.manifest.supersedes) }
      const heads=rs.filter(r=>!superseded.has(r.rid))
      report.push({tx, heads:heads.map(r=>({rid:r.rid,outcome:r.outcome?.outcome??null, action:r.manifest?.action, supersedes:r.manifest?.supersedes??null})), count:rs.length})
    }
    return report
  }

  async cleanupTerminal(rid){
    const m=this.#manifest(rid); const outcome=readJsonIfExists(this.#outcomePath(rid))
    if(!outcome || !['RESOLVED','ACCEPTED_CURRENT'].includes(outcome.outcome)) throw new ResolutionError('NOT_TERMINAL','resolution not terminal: '+rid)
    const tx=m.txid
    // 1 journal, 2 conflicts, 3 ancestors, 4 head（v7 固定顺序）
    tombstone('journal', join(this.root,'journal',tx))
    tombstone('conflicts', join(this.root,'conflicts',tx))
    const ancestors=[]
    let cur=m.supersedes
    while(cur){ const rm=readJsonIfExists(join(this.#dir(cur),'manifest.json')); if(!rm) break; ancestors.push(cur); cur=rm.supersedes }
    for(const rid of ancestors.reverse()) tombstone('resolution', this.#dir(rid))
    tombstone('resolution', this.#dir(rid))
    return {cleaned:{journal:true,conflicts:true,ancestors,head:rid}}
  }
}
