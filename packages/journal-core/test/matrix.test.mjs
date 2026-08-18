import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Journal } from '../src/journal.mjs'

const helper = fileURLToPath(new URL('./matrix-helper.mjs', import.meta.url))
function setup(){
  const base=mkdtempSync(join(tmpdir(),'mx-')); const profile=join(base,'profile'); const root=join(base,'meta')
  mkdirSync(profile,{recursive:true}); writeFileSync(join(profile,'package.json'),'A0')
  return {base,profile,root}
}
function crash(scenario, ctx){
  return new Promise(resolve=>{
    const c=spawn(process.execPath,[helper,scenario,ctx.profile,ctx.root],{stdio:['ignore','pipe','pipe']})
    c.on('close',code=>resolve(code))
  })
}

test('matrix: forward crash after rename -> rollback A0', async ()=>{
  const c=setup(); assert.equal(await crash('forward-after-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover(); assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: forward crash after dirfsync -> rollback A0', async ()=>{
  const c=setup(); assert.equal(await crash('forward-after-dirfsync',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover(); assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: delete crash after unlink -> rollback restores present', async ()=>{
  const c=setup(); assert.equal(await crash('delete-after-unlink',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover(); assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: rollback crash after rename -> second recovery finishes', async ()=>{
  const c=setup(); assert.equal(await crash('rollback-after-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover(); assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: append crash after write before fsync -> recovery idempotent', async ()=>{
  const c=setup(); assert.equal(await crash('append-after-write',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover(); assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: OUTCOME crash after publish -> committed path cleans', async ()=>{
  const c=setup(); assert.equal(await crash('outcome-after-publish',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover()
  assert.equal(report[0].result,'COMMITTED_OK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A1')
})
test('matrix: resolution op crash after publish -> recover finishes', async ()=>{
  const c=setup(); assert.equal(await crash('resolution-op-after-publish',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const report=await new ResolutionJournal(j).recover()
  assert.equal(report[0].result,'RESOLVED')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: forward crash before rename -> idempotent rollback', async ()=>{
  const c=setup(); assert.equal(await crash('forward-before-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  assert.equal((await j.recover())[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: append crash before dirfsync -> idempotent rollback', async ()=>{
  const c=setup(); assert.equal(await crash('append-before-dirfsync',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  assert.equal((await j.recover())[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: unlink crash before -> idempotent rollback', async ()=>{
  const c=setup(); assert.equal(await crash('unlink-before',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  assert.equal((await j.recover())[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: unlink crash after dirfsync -> rollback restores present', async ()=>{
  const c=setup(); assert.equal(await crash('unlink-after-dirfsync',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  assert.equal((await j.recover())[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: manifest crash after publish -> recover idempotent', async ()=>{
  const c=setup(); assert.equal(await crash('manifest-after-publish',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('matrix: validation crash after publish -> recover completes accept-current', async ()=>{
  const c=setup(); assert.equal(await crash('validation-after-publish',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const report=await new ResolutionJournal(j).recover()
  assert.equal(report[0].result,'ACCEPTED_CURRENT')
})
test('matrix: confirmed marker crash after publish -> recover resolves', async ()=>{
  const c=setup(); assert.equal(await crash('resolution-confirmed-after-publish',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const report=await new ResolutionJournal(j).recover()
  assert.equal(report[0].result,'RESOLVED')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('G1: supersede crash after new manifest before old outcome -> recover continues', async ()=>{
  const c=setup(); assert.equal(await crash('supersede-after-new-manifest',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const report=await new ResolutionJournal(j).recover()
  assert.equal(report[0].result,'RESOLVED')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})
test('G2: ancestor cleanup crash after first tombstone -> recover finishes', async ()=>{
  const c=setup(); assert.equal(await crash('ancestor-cleanup-after-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const report=await new ResolutionJournal(j).recover()
  assert.equal(report[0].result,'CLEANED_TERMINAL')
  const { readdirSync } = await import('node:fs')
  assert.equal(readdirSync(join(c.root,'resolutions')).length,0)
})
test('matrix: committed recover crash after tombstone rename -> sweep cleans', async ()=>{
  const c=setup(); assert.equal(await crash('tombstone-after-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover()
  assert.equal(report.length,0) // 原 journal 已 tombstone，trash 被清扫
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A1')
  assert.equal(j.scan().txs.some(t=>t.txid),false)
})
