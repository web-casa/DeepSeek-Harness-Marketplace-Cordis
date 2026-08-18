import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Journal, ResolutionJournal, fingerprint } from '../src/index.js'
import { fileState } from '../src/state.mjs'

function make(){
  const base=mkdtempSync(join(tmpdir(),'res-'))
  const profile=join(base,'profile'); const root=join(base,'meta')
  mkdirSync(profile,{recursive:true})
  writeFileSync(join(profile,'package.json'),'A0'); writeFileSync(join(profile,'pnpm-lock.yaml'),'B0')
  const j=new Journal({journalRoot:root, profileRoot:profile})
  const r=new ResolutionJournal(j)
  return {base,profile,root,j,r}
}
async function conflictedTx(ctx){
  const tx=await ctx.j.begin(['package.json','pnpm-lock.yaml'])
  await ctx.j.writePresent(tx,'package.json',Buffer.from('A1'))
  await ctx.j.writePresent(tx,'pnpm-lock.yaml',Buffer.from('B1'))
  writeFileSync(join(ctx.profile,'package.json'),'X') // external edit
  await ctx.j.recover()
  return tx
}
function restorePlan(ctx,tx){
  const baseline=ctx.j.getBaseline(tx); const plan={}
  for(const rel of Object.keys(baseline)) plan[rel]={expected:fileState(join(ctx.profile,rel)),next:baseline[rel].state}
  return plan
}

test('restore-snapshot resolves conflicted tx', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  assert.equal(await c.r.resolveTarget(rid,'package.json'),'DONE')
  assert.equal(await c.r.resolveTarget(rid,'pnpm-lock.yaml'),'DONE')
  const out=await c.r.completeResolution(rid)
  assert.equal(out.outcome,'RESOLVED')
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'A0')
  assert.equal(readFileSync(join(c.profile,'pnpm-lock.yaml'),'utf8'),'B0')
})

test('crash after first target: new instance continues', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  await c.r.resolveTarget(rid,'package.json')
  // 模拟进程重启
  const r2=new ResolutionJournal(new Journal({journalRoot:c.root, profileRoot:c.profile}))
  assert.equal(await r2.resolveTarget(rid,'pnpm-lock.yaml'),'DONE')
  assert.equal((await r2.completeResolution(rid)).outcome,'RESOLVED')
})

test('partial progress never reports success', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  await c.r.resolveTarget(rid,'package.json')
  // pnpm-lock 仍未恢复；complete 必须 RESOLUTION_CONFLICTED
  const out=await c.r.completeResolution(rid)
  assert.equal(out.outcome,'RESOLUTION_CONFLICTED')
})

test('external edit after plan -> conflict for that target only', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  writeFileSync(join(c.profile,'package.json'),'X2')
  await assert.rejects(()=>c.r.resolveTarget(rid,'package.json'), e=>e.code==='RESOLUTION_CONFLICT')
  assert.equal(await c.r.resolveTarget(rid,'pnpm-lock.yaml'),'DONE')
  assert.equal((await c.r.completeResolution(rid)).outcome,'RESOLUTION_CONFLICTED')
})

test('accept-current with validation evidence', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'accept-current'})
  const states={}
  for(const rel of Object.keys(c.j.getBaseline(tx))) states[rel]=fileState(join(c.profile,rel))
  await c.r.recordValidation(rid,{valid:true,fingerprint:fingerprint(states),baselineReport:{ok:true}})
  const out=await c.r.completeResolution(rid)
  assert.equal(out.outcome,'ACCEPTED_CURRENT')
  // profile 不被修改
  assert.equal(readFileSync(join(c.profile,'package.json'),'utf8'),'X')
})

test('validation once-only and fingerprint mismatch', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'accept-current'})
  const states={}
  for(const rel of Object.keys(c.j.getBaseline(tx))) states[rel]=fileState(join(c.profile,rel))
  await c.r.recordValidation(rid,{valid:true,fingerprint:fingerprint(states),baselineReport:{ok:true}})
  await assert.rejects(()=>c.r.recordValidation(rid,{valid:true,fingerprint:fingerprint(states),baselineReport:{ok:true}}), e=>e.code==='JOURNALLED')
  writeFileSync(join(c.profile,'package.json'),'X2')
  assert.equal((await c.r.completeResolution(rid)).outcome,'RESOLUTION_CONFLICTED')
})

test('supersede old conflicted resolution and cleanup ancestors', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid1=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  await c.r.resolveTarget(rid1,'package.json')
  await c.r.completeResolution(rid1) // RESOLUTION_CONFLICTED
  // 新 resolution supersede 旧 rid
  const rid2=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  const scan=c.r.scan(); const heads=scan.find(s=>s.tx===tx).heads
  assert.deepEqual(heads.map(h=>h.rid),[rid2])
  await c.r.resolveTarget(rid2,'package.json')
  await c.r.resolveTarget(rid2,'pnpm-lock.yaml')
  assert.equal((await c.r.completeResolution(rid2)).outcome,'RESOLVED')
  const cleaned=await c.r.cleanupTerminal(rid2)
  assert.equal(cleaned.cleaned.ancestors.includes(rid1),true)
  assert.equal(existsSync(join(c.root,'journal',tx)),false)
  assert.equal(existsSync(join(c.root,'conflicts',tx)),false)
  assert.equal(existsSync(join(c.root,'resolutions',rid1)),false)
  assert.equal(existsSync(join(c.root,'resolutions',rid2)),false)
})

test('terminal cleanup does not regress to conflict report', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  await c.r.resolveTarget(rid,'package.json'); await c.r.resolveTarget(rid,'pnpm-lock.yaml')
  await c.r.completeResolution(rid)
  await c.r.cleanupTerminal(rid)
  const j2=new Journal({journalRoot:c.root, profileRoot:c.profile})
  const scan=j2.scan(); assert.equal(scan.txs.some(t=>t.txid===tx),false)
})

test('plan target set must equal baseline set', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  await assert.rejects(()=>c.r.beginResolution({tx, action:'restore-snapshot', plan:{'package.json':restorePlan(c,tx)['package.json']}}), e=>e.code==='BAD_PLAN')
})

test('corrupt snapshot is rejected before any restore write', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const key=createHash('sha256').update('pnpm-lock.yaml').digest('hex')
  writeFileSync(join(c.root,'journal',tx,'snapshots',key+'.bin'),Buffer.from('corrupt'))
  const before=readFileSync(join(c.profile,'pnpm-lock.yaml'),'utf8')
  await assert.rejects(()=>c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)}), e=>e.code==='SNAPSHOT_BAD')
  assert.equal(readFileSync(join(c.profile,'pnpm-lock.yaml'),'utf8'),before)
})

test('supersedes cycle is rejected', async ()=>{
  const c=make(); const tx=await conflictedTx(c)
  const rid=await c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)})
  // 手工制造自环
  const mp=join(c.root,'resolutions',rid,'manifest.json')
  const m=JSON.parse(readFileSync(mp,'utf8')); m.supersedes=rid; writeFileSync(mp,JSON.stringify(m))
  await assert.rejects(()=>c.r.beginResolution({tx, action:'restore-snapshot', plan:restorePlan(c,tx)}), e=>e.code==='BAD_GRAPH')
})
