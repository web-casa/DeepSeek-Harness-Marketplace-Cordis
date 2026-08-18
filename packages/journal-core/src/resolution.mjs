import { existsSync, readFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, marker, replaceTarget, unlinkTargetDurable, readJsonIfExists, tombstone, fsyncDir } from './durable.mjs'
import { fileState, fingerprint, targetKey, sha256 } from './state.mjs'
import { JournalError } from './journal.mjs'
import { validateResolutionManifest, validateValidation } from './schema.mjs'
import { isValidationEvidence } from './validation.mjs'

export class ResolutionError extends JournalError {}

export class ResolutionJournal {
  constructor(journal, { lock = null } = {}) { this.journal = journal; this.root = journal.root; this.profile = journal.profile; this.dir = join(this.root,'resolutions'); this.lock = lock }

  #dir(rid){ return join(this.dir, rid) }
  #manifest(rid){ const raw=readJsonIfExists(join(this.#dir(rid),'manifest.json')); if(!raw) throw new ResolutionError('NO_MANIFEST','resolution manifest missing: '+rid)
    try { return validateResolutionManifest(raw) } catch(e) { throw new ResolutionError('BAD_MANIFEST', e.message) } }
  #writeManifest(rid,m){ this.lock?.fence(); atomicFile(join(this.#dir(rid),'manifest.json'), JSON.stringify(m,null,2), {mode:0o600}) }
  #opPath(rid,rel){ return join(this.#dir(rid),'ops',targetKey(rel)+'.json') }
  #confirmedPath(rid,rel){ return join(this.#dir(rid),'confirmed',targetKey(rel)) }
  #validationPath(rid){ return join(this.#dir(rid),'validation.json') }
  #outcomePath(rid){ return join(this.#dir(rid),'OUTCOME.json') }

  list(){ const out=[]; if(!existsSync(this.dir)) return out
    for(const name of readdirSync(this.dir)){ const d=join(this.dir,name); if(!statSync(d).isDirectory()) continue
      const m=readJsonIfExists(join(d,'manifest.json')); const outcome=readJsonIfExists(join(d,'OUTCOME.json')); out.push({rid:name,manifest:m,outcome}) }
    return out }

  #trashHasResolution(rid){
    const trash=join(this.root,'trash')
    if(!existsSync(trash)) return false
    for(const name of readdirSync(trash)){ if(name.startsWith(`resolution-${rid}-`)) return true }
    return false
  }
  #validateGraphForTx(tx){
    const rs=this.list().filter(r=>r.manifest?.txid===tx)
    const byRid=new Map(rs.map(r=>[r.rid,r]))
    for(const r of rs){
      const old=r.manifest.supersedes
      if(old!==null && old!==undefined){
        const target=byRid.get(old)
        if(!target){
          // 祖先已在 tombstone crash 中移入 trash 时允许悬挂引用（S7 G2）
          if(!this.#trashHasResolution(old)) throw new ResolutionError('BAD_GRAPH','dangling supersedes: '+old)
        } else if(target.manifest.txid!==tx) throw new ResolutionError('BAD_GRAPH','cross-tx supersedes')
      }
    }
    // 循环检测：沿 supersedes 走，若有环/链长>节点数 => 错
    for(const r of rs){
      const seen=new Set(); let cur=r.rid
      while(cur!==null && cur!==undefined){
        if(seen.has(cur)) throw new ResolutionError('BAD_GRAPH','supersedes cycle at '+cur)
        seen.add(cur)
        const node=byRid.get(cur); if(!node) break
        cur=node.manifest.supersedes ?? null
      }
    }
    const superseded=new Set(rs.map(r=>r.manifest.supersedes).filter(Boolean))
    const heads=rs.filter(r=>!superseded.has(r.rid))
    if(heads.length>1) throw new ResolutionError('MULTIPLE_HEADS','multiple resolution heads for tx')
    return { rs, byRid, heads }
  }

  #preflightRestore(tx, plan){
    const baseline=this.journal.getBaseline(tx)
    const rels=Object.keys(baseline)
    const planRels=Object.keys(plan).sort()
    if(JSON.stringify(planRels)!==JSON.stringify(rels.sort())) throw new ResolutionError('BAD_PLAN','plan target set != baseline set')
    // Phase 0：全量 snapshot 预检，失败零 target 写
    for(const rel of rels){
      const b=baseline[rel]
      if(!b.state.exists) continue
      const bytes=this.journal.readSnapshot(tx,rel)
      if(!bytes) throw new ResolutionError('SNAPSHOT_MISSING','snapshot missing: '+rel)
      if(sha256(bytes)!==b.state.hash) throw new ResolutionError('SNAPSHOT_BAD','snapshot hash mismatch: '+rel)
      if(bytes.length!==b.length) throw new ResolutionError('SNAPSHOT_BAD','snapshot length mismatch: '+rel)
    }
  }

  async beginResolution({ tx, action, plan = null }){
    this.lock?.fence()
    if(!['restore-snapshot','accept-current'].includes(action)) throw new ResolutionError('BAD_ACTION','unknown action')
    if(!this.journal.txExists(tx)) throw new ResolutionError('NO_TX','unknown tx: '+tx)
    if(action==='restore-snapshot'){ if(!plan) throw new ResolutionError('BAD_PLAN','plan required'); this.#preflightRestore(tx,plan) }
    if(action==='accept-current' && plan) throw new ResolutionError('BAD_PLAN','plan not allowed for accept-current')
    const { heads }=this.#validateGraphForTx(tx)
    if(heads.length===1){
      const old=heads[0]
      // 只允许 supersede 已 RESOLUTION_CONFLICTED 的 head；active 无 outcome 不允许并发 supersede
      if(old.outcome?.outcome !== 'RESOLUTION_CONFLICTED') throw new ResolutionError('BAD_HEAD','head is not RESOLUTION_CONFLICTED: '+(old.outcome?.outcome??'active'))
    }
    const rid=randomBytes(6).toString('hex')
    const manifest={ v:1, resolutionId:rid, txid:tx, createdAt:Date.now(), supersedes:null, action, state:'PLANNED', plan }
    if(heads.length===1){
      const old=heads[0]; manifest.supersedes=old.rid
      mkdirSync(this.#dir(rid),{recursive:true,mode:0o700})
      this.#writeManifest(rid,manifest)
      // 旧 SUPERSEDED 是补写信息；失败不阻断（freeze gate G1 语义）
      try{ atomicFile(join(this.#dir(old.rid),'OUTCOME.json'), JSON.stringify({v:1,resolutionId:old.rid,outcome:'SUPERSEDED'}), {mode:0o600}) }catch{}
    } else { mkdirSync(this.#dir(rid),{recursive:true,mode:0o700}); this.#writeManifest(rid,manifest) }
    return rid
  }

  async resolveTarget(rid, rel){
    this.lock?.fence()
    const m=this.#manifest(rid)
    if(m.action!=='restore-snapshot') throw new ResolutionError('BAD_ACTION','resolveTarget only for restore-snapshot')
    // 每次 target 写前重跑全量 Phase 0，确保任一其他 snapshot 损坏时本次零 target 写
    this.#preflightRestore(m.txid, m.plan)
    const plan=m.plan?.[rel]; if(!plan) throw new ResolutionError('BAD_REL','rel not in plan')
    const baseline=this.journal.getBaseline(m.txid)[rel]
    if(!baseline) throw new ResolutionError('BAD_REL','rel missing in original baseline')
    const p=join(this.profile,rel); const current=fileState(p)
    const opPath=this.#opPath(rid,rel); const confirmed=this.#confirmedPath(rid,rel)
    if(existsSync(confirmed)){
      if(current.exists===plan.next.exists && current.hash===plan.next.hash) return 'DONE'
      if(current.exists===plan.expected.exists && current.hash===plan.expected.hash){ unlinkSync(confirmed); fsyncDir(join(this.#dir(rid),'confirmed')) }
      else throw new ResolutionError('RESOLUTION_CONFLICT','current changed after confirmed: '+rel)
    }
    if(!existsSync(opPath)) atomicFile(opPath, JSON.stringify({v:1,resolutionId:rid,txid:m.txid,rel,targetKey:targetKey(rel),expected:plan.expected,next:plan.next}), {mode:0o600})
    if(current.exists===plan.next.exists && current.hash===plan.next.hash){ marker(confirmed); return 'DONE' }
    if(!(current.exists===plan.expected.exists && current.hash===plan.expected.hash)) throw new ResolutionError('RESOLUTION_CONFLICT','current != expected/next: '+rel)
    if(plan.next.exists){
      const bytes=this.journal.readSnapshot(m.txid,rel)
      if(!bytes || sha256(bytes)!==baseline.state.hash || bytes.length!==baseline.length) throw new ResolutionError('SNAPSHOT_BAD','snapshot invalid before restore write')
      this.lock?.fence(); replaceTarget(p, bytes, parseInt(baseline.mode||'0644',8))
    } else { this.lock?.fence(); unlinkTargetDurable(p) }
    const after=fileState(p)
    if(after.exists!==plan.next.exists || after.hash!==plan.next.hash) throw new ResolutionError('RESOLUTION_CONFLICT','post-write check failed: '+rel)
    this.lock?.fence(); marker(confirmed)
    return 'DONE'
  }

  async recordValidation(rid, evidence){
    this.lock?.fence()
    const m=this.#manifest(rid)
    if(m.action!=='accept-current') throw new ResolutionError('BAD_ACTION','recordValidation only for accept-current')
    if(!isValidationEvidence(evidence)) throw new ResolutionError('BAD_EVIDENCE','evidence must be a ValidationEvidence ticket')
    if(evidence.valid!==true) throw new ResolutionError('BAD_EVIDENCE','evidence.valid must be true')
    if(evidence.baselineReport?.ok!==true) throw new ResolutionError('BAD_EVIDENCE','evidence.baselineReport.ok must be true')
    const currentFp=this.#currentFingerprint(m.txid)
    if(evidence.fingerprint!==currentFp) throw new ResolutionError('FINGERPRINT_MISMATCH','current fingerprint does not match evidence')
    try{ atomicFile(this.#validationPath(rid), JSON.stringify({v:1,resolutionId:rid,valid:true,fingerprint:currentFp,baselineReport:evidence.baselineReport,createdAt:Date.now()},null,2), {mode:0o600, exclusive:true}) }
    catch(e){ if(e.code==='EEXIST') throw new ResolutionError('JOURNALLED','validation already recorded'); throw e }
  }

  #currentFingerprint(tx){
    const baseline=this.journal.getBaseline(tx); const states={}
    for(const rel of Object.keys(baseline)) states[rel]=fileState(join(this.profile,rel))
    return fingerprint(states)
  }

  async completeResolution(rid){
    this.lock?.fence()
    const m=this.#manifest(rid)
    const existing=readJsonIfExists(this.#outcomePath(rid))
    if(existing) throw new ResolutionError('JOURNALLED','resolution outcome already exists: '+existing.outcome)
    if(m.action==='restore-snapshot'){
      this.#preflightRestore(m.txid, m.plan)
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
      let val
      try { val=readJsonIfExists(this.#validationPath(rid)); if(val) validateValidation(val) } catch(e) { throw new ResolutionError('BAD_VALIDATION', e.message) }
      if(!val || val.valid!==true) throw new ResolutionError('NO_VALIDATION','no validation evidence')
      const fp=this.#currentFingerprint(m.txid)
      if(fp!==val.fingerprint){ atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'RESOLUTION_CONFLICTED'}), {mode:0o600}); return {outcome:'RESOLUTION_CONFLICTED'} }
      atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,outcome:'ACCEPTED_CURRENT'}), {mode:0o600})
      return {outcome:'ACCEPTED_CURRENT'}
    }
    throw new ResolutionError('BAD_ACTION','unknown action')
  }


  async markConflicted(rid){
    const m=this.#manifest(rid)
    atomicFile(this.#outcomePath(rid), JSON.stringify({v:1,resolutionId:rid,txid:m.txid,outcome:'RESOLUTION_CONFLICTED'}), {mode:0o600})
  }

  async recover(){
    const report=[]
    let list
    try { list=this.list() } catch(e){ return [{result:e.code}] }
    const byTx={}
    for(const r of list){ const tx=r.manifest?.txid; if(!tx) continue; (byTx[tx]??=[]).push(r) }
    for(const [tx] of Object.entries(byTx)){
      let heads
      try{ heads=this.#validateGraphForTx(tx).heads }catch(e){ report.push({tx,result:e.code}); continue }
      if(heads.length!==1){ report.push({tx,result:'NO_HEAD'}); continue }
      const head=heads[0]; const rid=head.rid
      const m=this.#manifest(rid)
      const outcome=head.outcome?.outcome ?? null
      if(outcome==='RESOLVED' || outcome==='ACCEPTED_CURRENT'){
        try{ await this.cleanupTerminal(rid); report.push({tx,rid,result:'CLEANED_TERMINAL'}) }catch(e){ report.push({tx,rid,result:e.code}) }
        continue
      }
      if(outcome==='RESOLUTION_CONFLICTED'){ report.push({tx,rid,result:'WAITING_AUTHORIZATION'}); continue }
      if(outcome==='SUPERSEDED'){ try{ tombstone('resolution', this.#dir(rid)); report.push({tx,rid,result:'CLEANED_SUPERSEDED'}) }catch(e){ report.push({tx,rid,result:e.code}) }; continue }
      if(m.action==='restore-snapshot'){
        try{ this.#preflightRestore(m.txid, m.plan) }catch(e){ report.push({tx,rid,result:e.code}); continue }
        const conflicts=[]
        for(const rel of Object.keys(m.plan)){
          try{ await this.resolveTarget(rid, rel) }catch(e){ conflicts.push({rel,error:e.code}) }
        }
        if(conflicts.length){ try{ await this.markConflicted(rid) }catch{}; report.push({tx,rid,result:'RESOLUTION_CONFLICTED',conflicts}); continue }
        try{
          const out=await this.completeResolution(rid)
          report.push({tx,rid,result:out.outcome})
          if(out.outcome==='RESOLVED'){ try{ await this.cleanupTerminal(rid) }catch(e){ report[report.length-1].cleanup=e.code } }
        }catch(e){ report.push({tx,rid,result:e.code}) }
        continue
      }
      if(m.action==='accept-current'){
        let val
        try { val=readJsonIfExists(this.#validationPath(rid)); if(val) validateValidation(val) } catch(e) { report.push({tx,rid,result:e.code}); continue }
        if(!val){ report.push({tx,rid,result:'WAITING_VALIDATION'}); continue }
        try{
          const out=await this.completeResolution(rid)
          report.push({tx,rid,result:out.outcome})
          if(out.outcome==='ACCEPTED_CURRENT'){ try{ await this.cleanupTerminal(rid) }catch(e){ report[report.length-1].cleanup=e.code } }
        }catch(e){ report.push({tx,rid,result:e.code}) }
        continue
      }
      report.push({tx,rid,result:'BAD_ACTION'})
    }
    return report
  }

  scan(){
    const byTx={}
    for(const r of this.list()){ const tx=r.manifest?.txid; if(!tx) continue; (byTx[tx]??=[]).push(r) }
    const report=[]
    for(const [tx,rs] of Object.entries(byTx)){
      try{ this.#validateGraphForTx(tx) }catch(e){ report.push({tx, error:e.code, heads:[]}); continue }
      const superseded=new Set(rs.map(r=>r.manifest.supersedes).filter(Boolean))
      const heads=rs.filter(r=>!superseded.has(r.rid))
      report.push({tx, heads:heads.map(r=>({rid:r.rid,outcome:r.outcome?.outcome??null, action:r.manifest.action, supersedes:r.manifest.supersedes??null})), count:rs.length})
    }
    return report
  }

  async cleanupTerminal(rid){
    this.lock?.fence()
    const m=this.#manifest(rid); const outcome=readJsonIfExists(this.#outcomePath(rid))
    if(!outcome || !['RESOLVED','ACCEPTED_CURRENT'].includes(outcome.outcome)) throw new ResolutionError('NOT_TERMINAL','resolution not terminal: '+rid)
    const tx=m.txid
    this.#validateGraphForTx(tx)
    tombstone('journal', join(this.root,'journal',tx))
    tombstone('conflicts', join(this.root,'conflicts',tx))
    const ancestors=[]; const seen=new Set()
    let cur=m.supersedes
    while(cur){ if(seen.has(cur)) throw new ResolutionError('BAD_GRAPH','cycle in supersedes chain'); seen.add(cur)
      const rm=readJsonIfExists(join(this.#dir(cur),'manifest.json'))
      if(!rm){
        if(this.#trashHasResolution(cur)) break // 已 tombstone 的祖先：正常断链
        throw new ResolutionError('BAD_GRAPH','dangling ancestor during cleanup: '+cur)
      }
      if(rm.txid!==tx) throw new ResolutionError('BAD_GRAPH','cross-tx ancestor during cleanup')
      ancestors.push(cur); cur=rm.supersedes }
    for(const rid of ancestors.reverse()) tombstone('resolution', this.#dir(rid))
    tombstone('resolution', this.#dir(rid))
    return {cleaned:{journal:true,conflicts:true,ancestors,head:rid}}
  }
}
