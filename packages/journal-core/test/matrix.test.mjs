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
test('matrix: committed recover crash after tombstone rename -> sweep cleans', async ()=>{
  const c=setup(); assert.equal(await crash('tombstone-after-rename',c),43)
  const j=new Journal({journalRoot:c.root,profileRoot:c.profile})
  const report=await j.recover()
  assert.equal(report.length,0) // 原 journal 已 tombstone，trash 被清扫
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A1')
  assert.equal(j.scan().txs.some(t=>t.txid),false)
})
