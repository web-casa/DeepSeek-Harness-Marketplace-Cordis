import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { FileLock, LockBusy } from '../src/lock.mjs'

function root(){ return mkdtempSync(join(tmpdir(),'lock-')) }
const helper = fileURLToPath(new URL('./lock-helper.mjs', import.meta.url))

test('live owner cannot be stolen', ()=>{
  const r=root(); const a=new FileLock(r); a.acquire('mutation')
  const b=new FileLock(r); assert.throws(()=>b.acquire('mutation'), e=>e.code==='LOCK_BUSY')
  a.release()
})
test('dead+stale owner can be taken over', ()=>{
  const r=root()
  writeFileSync(join(r,'lock.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()-60_000}))
  const a=new FileLock(r); const rec=a.acquire('repair-action')
  assert.equal(rec.epoch,2); assert.notEqual(rec.ownerToken,'old'); a.release()
})
test('dead but fresh heartbeat cannot be taken over', ()=>{
  const r=root()
  writeFileSync(join(r,'lock.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()}))
  assert.throws(()=>new FileLock(r).acquire('repair-action'), e=>e.code==='LOCK_BUSY')
})
test('heartbeat and fence token checks', ()=>{
  const r=root(); const a=new FileLock(r); a.acquire('mutation'); a.heartbeat(); a.fence()
  writeFileSync(join(r,'lock.json'), JSON.stringify({owner:'y',pid:process.pid,processStartToken:'x',ownerToken:'other',epoch:2,heartbeatAt:Date.now()}))
  assert.throws(()=>a.heartbeat(), e=>e.code==='LOCK_FENCED')
  assert.throws(()=>a.fence(), e=>e.code==='LOCK_FENCED')
})
test('dual takeover race yields exactly one winner', async ()=>{
  const r=root()
  writeFileSync(join(r,'lock.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()-60_000}))
  const run=()=>new Promise(resolve=>{
    const c=spawn(process.execPath,[helper,r],{stdio:['ignore','pipe','pipe']}); let out=''
    c.stdout.on('data',d=>out+=d); c.on('close',()=>{try{resolve(JSON.parse(out))}catch{resolve({error:out})}})
  })
  const results=await Promise.all([run(),run()])
  const winners=results.filter(x=>x.ok).length
  assert.equal(winners,1)
  const cur=JSON.parse(readFileSync(join(r,'lock.json'),'utf8'))
  const win=results.find(x=>x.ok); assert.equal(cur.ownerToken, win.token); assert.equal(cur.epoch,2)
})
