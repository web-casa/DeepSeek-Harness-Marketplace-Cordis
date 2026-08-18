// S4：exclusive acquire + heartbeat CAS + dead-owner takeover（rename-to-stolen）
import { existsSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, fsyncDir } from './durable.mjs'

const STALE_MS = 30_000
const PROCESS_TOKEN = randomBytes(8).toString('hex')
export class LockBusy extends Error { constructor(reason='lock busy'){ super(reason); this.code='LOCK_BUSY' } }
export class LockFenced extends Error { constructor(){ super('lock token mismatch'); this.code='LOCK_FENCED' } }

function ownerAlive(rec){
  if (!rec || !Number.isInteger(rec.pid)) return false
  try { process.kill(rec.pid, 0); return true } catch { return false }
}
function stale(rec){ return Date.now() - (rec.heartbeatAt ?? 0) > STALE_MS }

export class FileLock {
  constructor(root){ this.root=root; this.path=join(root,'lock.json'); this.record=null }
  acquire(scope='mutation', { wait=false } = {}){
    mkdirSync(this.root,{recursive:true,mode:0o700})
    const rec={owner:'journal-core',scope,bootId:randomBytes(8).toString('hex'),
      pid:process.pid,processStartToken:PROCESS_TOKEN,
      ownerToken:randomBytes(16).toString('hex'),epoch:1,acquiredAt:Date.now(),heartbeatAt:Date.now()}
    for(;;){
      try { atomicFile(this.path, JSON.stringify(rec), {mode:0o600, exclusive:true}); this.record=rec; return rec }
      catch(e){ if(e.code!=='EEXIST') throw e }
      let cur=null; try { cur=JSON.parse(readFileSync(this.path,'utf8')) } catch {}
      if(cur && (ownerAlive(cur) || !stale(cur))) {
        if(!wait) throw new LockBusy('owner alive or heartbeat fresh')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50); continue
      }
      // dead + stale → takeover CAS
      const tag=randomBytes(6).toString('hex')
      const stolen=this.path+'.stolen-'+tag
      try { renameSync(this.path, stolen) } catch(e2){ if(e2.code==='ENOENT') continue; throw e2 }
      let stolenRec; try { stolenRec=JSON.parse(readFileSync(stolen,'utf8')) } catch { try{renameSync(stolen,this.path)}catch{}; throw new LockBusy('stolen lock unreadable') }
      if(stolenRec.ownerToken!==cur.ownerToken || stolenRec.processStartToken!==cur.processStartToken){
        try{renameSync(stolen,this.path)}catch{}; throw new LockBusy('stolen content changed')
      }
      if(ownerAlive(stolenRec) || !stale(stolenRec)){
        if(!existsSync(this.path)) try{renameSync(stolen,this.path)}catch{}
        throw new LockBusy('owner revived or heartbeat fresh')
      }
      rec.epoch=(cur.epoch??0)+1
      try { atomicFile(this.path, JSON.stringify(rec), {mode:0o600, exclusive:true}); this.record=rec; return rec }
      catch(e3){ if(e3.code==='EEXIST') throw new LockBusy('cas lost to another takeover'); throw e3 }
    }
  }
  heartbeat(){
    if(!this.record) throw new LockBusy('no lease')
    const rec={...this.record,heartbeatAt:Date.now()}
    let cur=null; try{cur=JSON.parse(readFileSync(this.path,'utf8'))}catch{}
    if(!cur || cur.ownerToken!==this.record.ownerToken || cur.epoch!==this.record.epoch) throw new LockFenced()
    atomicFile(this.path, JSON.stringify(rec), {mode:0o600})
    this.record=rec
  }
  fence(){
    if(!this.record) throw new LockBusy('no lease')
    let cur=null; try{cur=JSON.parse(readFileSync(this.path,'utf8'))}catch{}
    if(!cur || cur.ownerToken!==this.record.ownerToken || cur.epoch!==this.record.epoch) throw new LockFenced()
  }
  release(){
    if(!this.record) return
    let cur=null; try{cur=JSON.parse(readFileSync(this.path,'utf8'))}catch{}
    if(cur && cur.ownerToken===this.record.ownerToken){ unlinkSync(this.path); fsyncDir(this.root) }
    this.record=null
  }
}
