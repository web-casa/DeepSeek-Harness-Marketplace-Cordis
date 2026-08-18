import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Journal } from '../src/journal.mjs'
import { setFailpoint, clearFailpoints } from '../src/failpoints.mjs'
import { sha256 } from '../src/state.mjs'

afterEach(()=>clearFailpoints())

function setup(){
  const base=mkdtempSync(join(tmpdir(),'fp-'))
  const profile=join(base,'profile'); const root=join(base,'meta')
  mkdirSync(profile,{recursive:true}); mkdirSync(join(root,'journal','tx1','ops'),{recursive:true}); mkdirSync(join(root,'journal','tx1','snapshots'),{recursive:true})
  writeFileSync(join(profile,'package.json'),'A0')
  const key=createHash('sha256').update('package.json').digest('hex')
  const baseline={state:{exists:true,hash:sha256(Buffer.from('A0'))},length:2,mode:'0644'}
  writeFileSync(join(root,'journal','tx1','manifest.json'), JSON.stringify({v:1,txid:'tx1',state:'MUTATING',createdAt:Date.now(),targets:{'package.json':baseline}}))
  writeFileSync(join(root,'journal','tx1','snapshots',key+'.bin'),'A0')
  const H={A0:sha256(Buffer.from('A0')),A1:sha256(Buffer.from('A1'))}
  const op={v:1,txid:'tx1',targetKey:key,opId:'tx1-1',seq:1,kind:'FORWARD',expected:{exists:true,hash:H.A0},next:{exists:true,hash:H.A1},before:{exists:true,hash:H.A0},mode:'0644',length:2}
  const ops=join(root,'journal','tx1','ops',key+'.jsonl')
  writeFileSync(ops, JSON.stringify({...op,phase:'INTENDED'})+'\n'+JSON.stringify({...op,phase:'CONFIRMED'})+'\n')
  writeFileSync(join(profile,'package.json'),'A1')
  return {base,profile,root,j:new Journal({journalRoot:root,profileRoot:profile})}
}

test('clean rollback without failpoint', async ()=>{
  const c=setup()
  const report=await c.j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
})

test('failpoint before replaceTarget -> CONFLICTED, target unchanged', async ()=>{
  const c=setup()
  setFailpoint('replaceTarget:before', ({path})=>{ if(path.endsWith('package.json')) throw new Error('fp-replace') })
  const report=await c.j.recover()
  assert.equal(report[0].result,'CONFLICTED')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A1')
  assert.ok(existsSync(join(c.root,'conflicts','tx1','report.json')))
  clearFailpoints()
})

test('failpoint before marker prevents commit; recover rolls back', async ()=>{
  const base=mkdtempSync(join(tmpdir(),'fp-'))
  const profile=join(base,'profile'); const root=join(base,'meta')
  mkdirSync(profile,{recursive:true}); writeFileSync(join(profile,'package.json'),'A0')
  const j=new Journal({journalRoot:root,profileRoot:profile})
  const tx=await j.begin(['package.json'])
  await j.writePresent(tx,'package.json',Buffer.from('A1'))
  setFailpoint('marker:before', ()=>{ throw new Error('fp-marker') })
  await assert.rejects(()=>j.commitFiles(tx), /fp-marker/)
  clearFailpoints()
  const report=await j.recover()
  assert.equal(report[0].result,'ROLLED_BACK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A0')
})

test('failpoint before rollback append leaves target untouched and throws', async ()=>{
  const c=setup()
  setFailpoint('appendRecord:before', ({path})=>{ if(path.includes('ops')){ const e=new Error('fp-append'); e.code='FP_INJECTED'; throw e } })
  await assert.rejects(()=>c.j.recover(), /fp-append/)
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A1')
  clearFailpoints()
})
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('child crash after COMMITTED publish before dirfsync: recovery keeps commit', async ()=>{
  const base=mkdtempSync(join(tmpdir(),'kill-'))
  const profile=join(base,'profile'); const root=join(base,'meta'); mkdirSync(profile,{recursive:true}); writeFileSync(join(profile,'package.json'),'A0')
  const helper=fileURLToPath(new URL('./kill-helper.mjs', import.meta.url))
  await new Promise(resolve=>{
    const c=spawn(process.execPath,[helper,'marker-publish-crash',profile,root],{stdio:['ignore','pipe','pipe']})
    c.on('close',code=>{ assert.equal(code,42); resolve() })
  })
  const j=new Journal({journalRoot:root,profileRoot:profile})
  const report=await j.recover()
  assert.equal(report[0].result,'COMMITTED_OK')
  assert.equal(readFileSync(join(profile,'package.json'),'utf8'),'A1')
})
