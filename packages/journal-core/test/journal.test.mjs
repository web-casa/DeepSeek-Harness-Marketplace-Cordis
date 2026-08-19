import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Journal, JournalError, FileLock, LockBusy, sha256, fileState, withFileLock } from '../src/index.js'
import { setFailpoint, clearFailpoints } from '../src/failpoints.mjs'

afterEach(()=>clearFailpoints())

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

test('pending INTENDED (crash before CONFIRMED append) is claimed and rolled back', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  // 用 failpoint 在 CONFIRMED append 前模拟崩溃：第一次 append 放行，第二次注入
  let n=0
  setFailpoint('appendRecord:before', ()=>{ n++; if(n===2){ const e=new Error('fp-before-confirm'); e.code='FP_INJECTED'; throw e } })
  await assert.rejects(()=>j.writePresent(tx,'package.json',Buffer.from('A1')), e=>e.code==='FP_INJECTED')
  clearFailpoints()
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
  mkdirSync(join(journalRoot,'lock'),{recursive:true})
  writeFileSync(join(journalRoot,'lock','owner.json'), JSON.stringify({owner:'x',pid:process.pid,processStartToken:'x',ownerToken:'other',epoch:2,heartbeatAt:Date.now()}))
  await assert.rejects(()=>guarded.writePresent(tx,'package.json',Buffer.from('A1')), e=>e.code==='LOCK_FENCED')
})

test('configured journal recovery requires an acquired lock', async ()=>{
  const {j,journalRoot}=make()
  const lock=new FileLock(journalRoot)
  const guarded=new Journal({journalRoot, profileRoot:j.profile, lock})
  await assert.rejects(()=>guarded.recover(), e=>e.code==='LOCK_BUSY')
  assert.deepEqual(await withFileLock(lock, 'recovery', ()=>guarded.recover()), [])
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

test('begin refuses while an active tx exists', async ()=>{
  const {j}=make()
  await j.begin(['package.json'])
  await assert.rejects(()=>j.begin(['pnpm-lock.yaml']), e=>e.code==='ACTIVE_TX')
})

test('invalid manifest is reported as BAD_MANIFEST', async ()=>{
  const {j,journalRoot}=make()
  mkdirSync(join(journalRoot,'journal','tx9'),{recursive:true})
  writeFileSync(join(journalRoot,'journal','tx9','manifest.json'),'{bad json')
  const report=await j.recover()
  assert.equal(report[0].result,'BAD_MANIFEST')
})

test('committed path rejects bad outcome schema', async ()=>{
  const {j,journalRoot,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  await j.commitFiles(tx)
  writeFileSync(join(journalRoot,'journal',tx,'OUTCOME.json'),JSON.stringify({outcome:'ROLLED_BACK',v:0,txid:'other'}))
  const report=await j.recover()
  assert.equal(report[0].result,'BAD_OUTCOME')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
})

test('conflict report with missing evidence is not silently trusted', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  writeFileSync(join(profile,'package.json'),'X')
  await j.recover() // creates evidence + report
  rmSync(join(j.root,'conflicts',tx,'evidence'),{recursive:true,force:true})
  const report=await j.recover()
  assert.equal(report[0].result,'BAD_EVIDENCE')
})

test('conflict archive is once-only', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  writeFileSync(join(profile,'package.json'),'X')
  await j.recover()
  await assert.rejects(()=>j.archiveConflict(tx,[{rel:'package.json',state:fileState(join(profile,'package.json'))}]), e=>e.code==='JOURNALLED')
})

test('delete absent target rejected before writing op', async ()=>{
  const {j}=make()
  const tx=await j.begin(['package.json'])
  await j.deleteTarget(tx,'package.json') // present -> absent
  await assert.rejects(()=>j.deleteTarget(tx,'package.json'), e=>e.code==='BAD_TARGET_STATE')
  const ops=join(j.root,'journal',tx,'ops',createHash('sha256').update('package.json').digest('hex')+'.jsonl')
  const lines=readFileSync(ops,'utf8').trim().split('\n')
  assert.equal(lines.length,2) // 原 delete 的 INTENDED+CONFIRMED，未新增
})

test('recoverReport returns versioned schema', async ()=>{
  const {j}=make()
  const report=await j.recoverReport()
  assert.equal(report.v,1)
  assert.ok(Array.isArray(report.entries))
})

test('begin rejects empty targets', async ()=>{
  const {j}=make()
  await assert.rejects(()=>j.begin([]), e=>e.code==='BAD_TARGETS')
})

test('commit allows tracked-but-unchanged no-op targets', async ()=>{
  const {j,profile}=make()
  const tx=await j.begin(['package.json','cordis.patch.yml'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  await j.commitFiles(tx)
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
})
