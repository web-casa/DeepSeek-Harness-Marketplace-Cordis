// S5c: dead-owner lock takeover CAS 原型（rename-to-stolen）
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const root = process.argv[2], mode = process.argv[3]
const lock = join(root, 'lock.json')
const STALE_MS = 30_000
const atomic = (p, c) => { const t=p+'.tmp'; const fd=openSync(t,'wx',0o600); writeFileSync(fd,c); fsyncSync(fd); closeSync(fd); renameSync(t,p); const d=openSync(root,'r'); fsyncSync(d); closeSync(d) }

function makeDeadOwner(pid=999999){ mkdirSync(root,{recursive:true}); atomic(lock, JSON.stringify({owner:'host',bootId:'b1',pid,processStartToken:'dead-'+pid,ownerToken:'old-token',epoch:1,heartbeatAt:Date.now()-60_000})) }
function isAlive(pid){ try { process.kill(pid,0); return true } catch { return false } }
function readLock(){ try { return JSON.parse(readFileSync(lock,'utf8')) } catch { return null } }

function takeOver(myToken, tag, failWith){
  const before = readLock()
  if (!before) return {tag,ok:false,reason:'no-lock'}
  if (isAlive(before.pid)) return {tag,ok:false,reason:'owner-alive'}
  if (Date.now() - before.heartbeatAt < STALE_MS) return {tag,ok:false,reason:'heartbeat-not-stale'}
  // CAS: rename(lock, stolen-<myTag>)。同源文件只允许一个赢家。
  const stolen = `${lock}.stolen-${tag}`
  try { renameSync(lock, stolen) } catch (e) { return {tag,ok:false,reason:'cas-lost',code:e.code} }
  const stolenContent = JSON.parse(readFileSync(stolen,'utf8'))
  if (stolenContent.ownerToken !== before.ownerToken || stolenContent.processStartToken !== before.processStartToken) {
    return {tag,ok:false,reason:'stolen-content-changed'}
  }
  // 再次确认死亡后创建新锁；open wx 原子
  if (isAlive(before.pid) || Date.now() - before.heartbeatAt < STALE_MS) { // rename 后复查失败 → 尝试恢复原锁
    try { renameSync(stolen, lock); return {tag,ok:false,reason:'owner-revived-restored'} } catch { return {tag,ok:false,reason:'owner-revived-no-restore'} }
  }
  const newLock = { owner:'repair', bootId:'b2', pid:process.pid, processStartToken:'me', ownerToken:myToken, epoch:before.epoch+1, heartbeatAt:Date.now() }
  const fd = openSync(lock,'wx',0o600); writeFileSync(fd,JSON.stringify(newLock)); fsyncSync(fd); closeSync(fd)
  return {tag,ok:true,stolen:readFileSync(stolen,'utf8')}
}

if (mode==='contender'){
  const tag=process.argv[4]
  setTimeout(()=>{ const r=takeOver('token-'+tag, tag); console.log(JSON.stringify(r)) }, 30 + Math.floor(Math.random()*30))
} else if (mode==='race'){
  makeDeadOwner()
  const results=[]
  let left=2
  for (const tag of ['A','B']) {
    const child = spawn(process.execPath, [import.meta.url.replace('file://',''), root, 'contender', tag])
    let out=''; child.stdout.on('data',c=>out+=c)
    child.on('close',()=>{ results.push(JSON.parse(out)); if(--left===0){ console.log(JSON.stringify({results, winners:results.filter(r=>r.ok).length, lock:readLock()})); process.exit(0) } })
  }
} else if (mode==='fencing'){
  makeDeadOwner(process.pid) // 活 owner
  console.log(JSON.stringify(takeOver('token-new','F')))
  const cur = readLock(); console.log(JSON.stringify({stillOld: cur.ownerToken==='old-token'}))
}
