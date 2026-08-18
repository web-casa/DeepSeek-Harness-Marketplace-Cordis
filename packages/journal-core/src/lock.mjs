// 目录锁：mkdir 原子排他；heartbeat 写在自有目录内，避免覆盖他人 owner。
// takeover = rename(lockdir, stolen-<tag>) CAS + 复核 dead+stale + mkdir 新锁。
import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { atomicFile, fsyncDir } from './durable.mjs'

const STALE_MS = 30_000
const PROCESS_TOKEN = randomBytes(8).toString('hex')
export class LockBusy extends Error { constructor(reason='lock busy'){ super(reason); this.code='LOCK_BUSY' } }
export class LockFenced extends Error { constructor(){ super('lock token mismatch'); this.code='LOCK_FENCED' } }

function processStartTicks(pid){
  if (process.platform !== 'linux') return null
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    return Number(stat.slice(close + 1).trim().split(/\s+/)[19])
  } catch { return null }
}
function ownerAlive(rec){
  if (!rec || !Number.isInteger(rec.pid)) return false
  try { process.kill(rec.pid, 0) } catch { return false }
  // PID 复用防护：Linux 下比较 /proc/<pid> 进程启动 ticks。
  if (process.platform === 'linux' && Number.isInteger(rec.processStartTicks)) {
    const ticks = processStartTicks(rec.pid)
    if (ticks !== null && ticks !== rec.processStartTicks) return false
  }
  return true
}
function stale(rec){ return Date.now() - (rec.heartbeatAt ?? 0) > STALE_MS }

export class FileLock {
  constructor(root){ this.root=root; this.dir=join(root,'lock'); this.ownerPath=join(this.dir,'owner.json'); this.hbPath=join(this.dir,'heartbeat.json'); this.record=null }

  #readOwner(path){ try { return JSON.parse(readFileSync(path,'utf8')) } catch { return null } }
  #stolenState(){
    const names = readdirSync(this.root).filter(n => n.startsWith('lock.stolen-'))
    if (names.length === 0) return null
    let newest = null
    for (const name of names) {
      const p = join(this.root, name)
      try { const st = statSync(p); if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name, path: p, mtimeMs: st.mtimeMs, owner: this.#readOwner(join(p, 'owner.json')) } } catch {}
    }
    return newest
  }

  acquire(scope='mutation', { wait=false } = {}){
    mkdirSync(this.root,{recursive:true,mode:0o700})
    const rec={owner:'journal-core',scope,bootId:randomBytes(8).toString('hex'),
      pid:process.pid,processStartToken:PROCESS_TOKEN,
      ownerToken:randomBytes(16).toString('hex'),epoch:1,acquiredAt:Date.now(),heartbeatAt:Date.now(),processStartTicks:processStartTicks(process.pid) ?? undefined}
    for(;;){
      const stolen = this.#stolenState()
      if (stolen) {
        const age = Date.now() - stolen.mtimeMs
        if (age < 5000) {
          if (!existsSync(this.dir)) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue }
          // 新锁已建立：继续走下方 mkdir(EEXIST)->BUSY 路径，不必等待 stolen 老化
        }
        // 上一个 takeover 在 rename 后崩溃：读取 stolen owner 继承 epoch
        if (!existsSync(this.dir) && stolen.owner && !ownerAlive(stolen.owner) && stale(stolen.owner)) {
          rec.epoch = (stolen.owner.epoch ?? 0) + 1
        }
      }
      try {
        mkdirSync(this.dir,{mode:0o700})
        // 关闭 rename→mkdir 间隙：若此刻存在刚产生的 stolen 旧锁，继承其 epoch。
        const gapStolen = this.#stolenState()
        if (gapStolen?.owner && !ownerAlive(gapStolen.owner) && stale(gapStolen.owner)) {
          rec.epoch = (gapStolen.owner.epoch ?? 0) + 1
        }
        try {
          atomicFile(this.ownerPath, JSON.stringify(rec), {mode:0o600})
          atomicFile(this.hbPath, JSON.stringify({heartbeatAt:rec.heartbeatAt}), {mode:0o600})
          this.record=rec
          return rec
        } catch(inner){ // 半初始化目录不能留成永久 BUSY
          try { rmSync(this.dir,{recursive:true,force:true}) } catch {}
          throw inner
        }
      } catch(e){
        if(e.code!=='EEXIST') throw e
        let cur=this.#readOwner(this.ownerPath)
        if(!cur) throw new LockBusy('lock dir exists but owner unreadable')
        if(ownerAlive(cur) || !stale(cur)){ if(!wait) throw new LockBusy('owner alive or heartbeat fresh'); /* wait 模式阻塞主线程 50ms；仅用于短命 CLI，长驻进程应自行轮询/重试。 */ Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50); continue }
        // dead+stale takeover CAS
        const tag=randomBytes(6).toString('hex'); const stolen=this.dir+'.stolen-'+tag
        try { renameSync(this.dir, stolen) } catch(e2){ if(e2.code==='ENOENT') continue; throw e2 }
        const stolenOwner=this.#readOwner(join(stolen,'owner.json'))
        if(!stolenOwner || stolenOwner.ownerToken!==cur.ownerToken || stolenOwner.processStartToken!==cur.processStartToken){
          try{ renameSync(stolen,this.dir) }catch{}; throw new LockBusy('stolen owner changed')
        }
        if(ownerAlive(stolenOwner) || !stale(stolenOwner)){
          if(!existsSync(this.dir)) try{ renameSync(stolen,this.dir) }catch{}
          throw new LockBusy('owner revived or heartbeat fresh')
        }
        rec.epoch=(cur.epoch??0)+1
        try { mkdirSync(this.dir,{mode:0o700}) } catch(e3){ if(e3.code==='EEXIST') throw new LockBusy('cas lost to another takeover'); throw e3 }
        atomicFile(this.ownerPath, JSON.stringify(rec), {mode:0o600})
        atomicFile(this.hbPath, JSON.stringify({heartbeatAt:rec.heartbeatAt}), {mode:0o600})
        this.record=rec
        return rec
      }
    }
  }
  heartbeat(){
    if(!this.record) throw new LockBusy('no lease')
    this.fence()
    const rec={...this.record,heartbeatAt:Date.now()}
    atomicFile(this.ownerPath, JSON.stringify(rec), {mode:0o600})
    atomicFile(this.hbPath, JSON.stringify({heartbeatAt:rec.heartbeatAt}), {mode:0o600})
    this.record=rec
  }
  fence(){
    if(!this.record) throw new LockBusy('no lease')
    const cur=this.#readOwner(this.ownerPath)
    if(!cur || cur.ownerToken!==this.record.ownerToken || cur.epoch!==this.record.epoch) throw new LockFenced()
  }
  release(){
    if(!this.record) return
    const cur=this.#readOwner(this.ownerPath)
    if(cur && cur.ownerToken===this.record.ownerToken){ rmSync(this.dir,{recursive:true,force:true}); fsyncDir(this.root) }
    this.record=null
  }
}

export function sweepLockDebris(root, { olderThanMs = 60_000 } = {}){
  if (!existsSync(root)) return
  for(const name of readdirSync(root)){
    if(!name.startsWith('lock.stolen-')) continue
    const p=join(root,name)
    try {
      if(!statSync(p).isDirectory()) continue
      if(Date.now() - statSync(p).mtimeMs > olderThanMs) rmSync(p,{recursive:true,force:true})
    } catch {}
  }
}
