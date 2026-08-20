import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { FileLock, LockBusy, withFileLock } from '../src/lock.mjs'

function root(){ return mkdtempSync(join(tmpdir(),'lock-')) }
const helper = fileURLToPath(new URL('./lock-helper.mjs', import.meta.url))

test('live owner cannot be stolen', ()=>{
  const r=root(); const a=new FileLock(r); a.acquire('mutation')
  const b=new FileLock(r); assert.throws(()=>b.acquire('mutation'), e=>e.code==='LOCK_BUSY')
  a.release()
})
test('dead+stale owner can be taken over', ()=>{
  const r=root()
  mkdirSync(join(r,'lock'),{recursive:true})
  writeFileSync(join(r,'lock','owner.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()-60_000}))
  const a=new FileLock(r); const rec=a.acquire('repair-action')
  assert.equal(rec.epoch,2); assert.notEqual(rec.ownerToken,'old'); a.release()
})
test('dead but fresh heartbeat cannot be taken over', ()=>{
  const r=root()
  mkdirSync(join(r,'lock'),{recursive:true})
  writeFileSync(join(r,'lock','owner.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()}))
  assert.throws(()=>new FileLock(r).acquire('repair-action'), e=>e.code==='LOCK_BUSY')
})
test('heartbeat and fence token checks', ()=>{
  const r=root(); const a=new FileLock(r); a.acquire('mutation'); a.heartbeat(); a.fence()
  mkdirSync(join(r,'lock'),{recursive:true})
  writeFileSync(join(r,'lock','owner.json'), JSON.stringify({owner:'y',pid:process.pid,processStartToken:'x',ownerToken:'other',epoch:2,heartbeatAt:Date.now()}))
  assert.throws(()=>a.heartbeat(), e=>e.code==='LOCK_FENCED')
  assert.throws(()=>a.fence(), e=>e.code==='LOCK_FENCED')
})
test('withFileLock fences the operation and releases on failure', async ()=>{
  const r=root(); const a=new FileLock(r)
  await assert.rejects(() => withFileLock(a, 'mutation', async ()=>{
    a.fence()
    assert.throws(()=>new FileLock(r).acquire('mutation'), e=>e.code==='LOCK_BUSY')
    throw new Error('expected failure')
  }), /expected failure/)
  const b=new FileLock(r); b.acquire('mutation'); b.release()
})
test('dual takeover race yields exactly one winner', async ()=>{
  const r=root()
  mkdirSync(join(r,'lock'),{recursive:true})
  writeFileSync(join(r,'lock','owner.json'), JSON.stringify({owner:'x',pid:999999,processStartToken:'dead',ownerToken:'old',epoch:1,heartbeatAt:Date.now()-60_000}))
  const run=()=>new Promise(resolve=>{
    const c=spawn(process.execPath,[helper,r],{stdio:['ignore','pipe','pipe']}); let out=''; let err=''; let spawnError=null; let settled=false
    const finish=(code=null,signal=null)=>{
      if(settled) return
      settled=true
      try{ resolve({...JSON.parse(out),code,signal,stderr:err,spawnError}) }
      catch{ resolve({ok:false,error:out,code,signal,stderr:err,spawnError}) }
    }
    c.stdout.on('data',d=>out+=d); c.stderr.on('data',d=>err+=d)
    c.on('error',error=>{spawnError={code:error.code,message:error.message};finish()})
    c.on('close',finish)
  })
  const results=await Promise.all([run(),run()])
  const winners=results.filter(x=>x.ok).length
  assert.equal(winners,1,JSON.stringify(results))
  const cur=JSON.parse(readFileSync(join(r,'lock','owner.json'),'utf8'))
  const win=results.find(x=>x.ok); assert.equal(cur.ownerToken, win.token); assert.equal(cur.epoch,2)
})
