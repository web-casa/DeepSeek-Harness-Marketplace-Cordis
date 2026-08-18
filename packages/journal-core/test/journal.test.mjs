import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Journal, JournalError, FileLock, LockBusy, sha256 } from '../src/index.js'

function make(){
  const base=mkdtempSync(join(tmpdir(),'jm-'))
  const profile=join(base,'profile'); const journalRoot=join(base,'meta')
  mkdirSync(profile,{recursive:true})
  const files={ 'package.json':'A0', 'pnpm-lock.yaml':'B0' }
  for(const [rel,c] of Object.entries(files)) writeFileSync(join(profile,rel),c)
  const j=new Journal({journalRoot, profileRoot:profile})
  return {base,profile,journalRoot,j,files}
}

test('normal commit path', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  await j.commitFiles(tx)
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
  assert.ok(existsSync(join(j.root,'journal',tx,'COMMITTED')))
  const scan=j.scan(); assert.equal(scan.txs[0].committed,true)
  const report=await j.recover(); assert.equal(report[0].result,'COMMITTED_OK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
})

test('uncommitted rollback restores before', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A0')
})

test('delete and rollback restores present', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.deleteTarget(tx,'package.json')
  assert.equal(existsSync(join(profile,'package.json')),false)
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A0')
})

test('pending INTENDED (crash after write before CONFIRMED) is claimed and rolled back', async ()=>{
  const {j,profile,journalRoot}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  // 删掉最后的 CONFIRMED 行，模拟写后未确认崩溃
  const ops=join(journalRoot,'journal',tx,'ops',createHash('sha256').update('package.json').digest('hex')+'.jsonl')
  const lines=readFileSync(ops,'utf8').trim().split('\n'); lines.pop(); writeFileSync(ops,lines.join('\n')+'\n')
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A0')
})

test('external edit conflict is detected and archived', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  writeFileSync(join(profile,'package.json'),'X')
  const report=await j.recover()
  assert.equal(report[0].result,'CONFLICTED')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'X')
  assert.ok(existsSync(join(j.root,'conflicts',tx,'report.json')))
})

test('multiple writes A->B->C rollback', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  await j.writePresent(tx,'package.json',Buffer.from('A2'))
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A2')
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A0')
})

test('missing snapshot fails before any target write', async ()=>{
  const {j,profile,journalRoot}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  const snap=join(journalRoot,'journal',tx,'snapshots',createHash('sha256').update('package.json').digest('hex')+'.bin')
  rmSync(snap)
  const report=await j.recover()
  assert.equal(report[0].result,'SNAPSHOT_MISSING')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
})

test('target allowlist enforced', async ()=>{
  const {j}=make()
  await assert.rejects(()=>j.begin(['/etc/passwd']), err=>err.code==='BAD_TARGET')
})

test('lock acquire is exclusive', ()=>{
  const {journalRoot}=make()
  const a=new FileLock(journalRoot); a.acquire('mutation')
  const b=new FileLock(journalRoot)
  assert.throws(()=>b.acquire('mutation'), err=>err.code==='LOCK_BUSY')
  a.release(); b.acquire('mutation'); b.release()
})

test('fenced lock blocks journal writes', async ()=>{
  const {j,journalRoot}=make()
  const lock=new FileLock(journalRoot); lock.acquire('mutation')
  const guarded=new Journal({journalRoot, profileRoot:j.profile, lock})
  const tx=await guarded.begin(['package.json'])
  // 替换 lock 使 token 失效
  writeFileSync(join(journalRoot,'lock.json'), JSON.stringify({owner:'x',pid:process.pid,processStartToken:'x',ownerToken:'other',epoch:2,heartbeatAt:Date.now()}))
  await assert.rejects(()=>guarded.writePresent(tx,'package.json',Buffer.from('A1')), e=>e.code==='LOCK_FENCED')
})

test('INTENDED and CONFIRMED share opId and seq', async ()=>{
  const {j,journalRoot}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  const opsFile=join(journalRoot,'journal',tx,'ops',createHash('sha256').update('package.json').digest('hex')+'.jsonl')
  const ops=readFileSync(opsFile,'utf8').trim().split('\n').map(l=>JSON.parse(l))
  assert.equal(ops.length,2)
  assert.equal(ops[0].opId,ops[1].opId)
  assert.equal(ops[0].seq,ops[1].seq)
  assert.equal(ops[0].phase,'INTENDED'); assert.equal(ops[1].phase,'CONFIRMED')
})

test('COMMITTED marker with tampered target is CONFLICTED, not rollback', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  await j.commitFiles(tx)
  writeFileSync(join(profile,'package.json'),'X')
  const report=await j.recover()
  assert.equal(report[0].result,'CONFLICTED')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'X')
})

test('existing conflict report blocks automatic recovery', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  writeFileSync(join(profile,'package.json'),'X')
  await j.recover() // creates report + CONFLICTED
  const before=readFileSync(join(profile,'package.json'),'utf8')
  const report=await j.recover()
  assert.equal(report[0].result,'CONFLICTED_EXISTING')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),before)
})
