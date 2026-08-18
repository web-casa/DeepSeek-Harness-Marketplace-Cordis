import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOpLog, reduceOps, classifyTarget } from '../src/reducer.mjs'
import { sha256, targetKey } from '../src/state.mjs'

const H = { A: sha256(Buffer.from('A')), B: sha256(Buffer.from('B')), C: sha256(Buffer.from('C')), D: sha256(Buffer.from('D')) }
const st = (x) => ({ exists: true, hash: x })
const absent = { exists: false, hash: null }
const baseline = { state: st(H.A) }
function rec({seq, phase, kind='FORWARD', expected=st(H.A), next=st(H.B), before=st(H.A)}){
  const op={v:1,txid:'tx1',targetKey:targetKey('pkg'),opId:`tx1-${seq}`,seq,kind,phase,expected,next,before}
  if(next.exists){ op.mode='0644'; op.length=1 }
  return op
}

test('A->B->C chain reduces to owned C', ()=>{
  const lines=[
    JSON.stringify(rec({seq:1,phase:'INTENDED',next:st(H.B)})),
    JSON.stringify(rec({seq:1,phase:'CONFIRMED',next:st(H.B)})),
    JSON.stringify(rec({seq:2,phase:'INTENDED',expected:st(H.B),before:st(H.B),next:st(H.C)})),
    JSON.stringify(rec({seq:2,phase:'CONFIRMED',expected:st(H.B),before:st(H.B),next:st(H.C)})),
  ]
  const parsed=parseOpLog(lines,{txid:'tx1',rel:'pkg'})
  const r=reduceOps(parsed,baseline)
  assert.equal(r.owned.hash,H.C)
  const plan=classifyTarget(parsed,baseline,st(H.C))
  assert.equal(plan.conflict,false); assert.equal(plan.owned.hash,H.C)
})

test('pending INTENDED with current expected -> CANCELLED plan', ()=>{
  const lines=[JSON.stringify(rec({seq:1,phase:'INTENDED'}))]
  const parsed=parseOpLog(lines,{txid:'tx1',rel:'pkg'})
  const plan=classifyTarget(parsed,baseline,st(H.A))
  assert.equal(plan.pendingAction,'CANCELLED')
})

test('pending INTENDED with current next -> CONFIRMED plan', ()=>{
  const lines=[JSON.stringify(rec({seq:1,phase:'INTENDED'}))]
  const parsed=parseOpLog(lines,{txid:'tx1',rel:'pkg'})
  const plan=classifyTarget(parsed,baseline,st(H.B))
  assert.equal(plan.pendingAction,'CONFIRMED')
  assert.equal(plan.owned.hash,H.B)
})

test('seq gap rejected', ()=>{
  assert.throws(()=>parseOpLog([
    JSON.stringify(rec({seq:1,phase:'INTENDED'})),
    JSON.stringify(rec({seq:3,phase:'INTENDED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('first phase must be INTENDED', ()=>{
  assert.throws(()=>parseOpLog([JSON.stringify(rec({seq:1,phase:'CONFIRMED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('duplicate phase rejected', ()=>{
  assert.throws(()=>parseOpLog([
    JSON.stringify(rec({seq:1,phase:'INTENDED'})),
    JSON.stringify(rec({seq:1,phase:'INTENDED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('expected chain mismatch rejected', ()=>{
  const lines=[
    JSON.stringify(rec({seq:1,phase:'INTENDED',next:st(H.B)})),
    JSON.stringify(rec({seq:1,phase:'CONFIRMED',next:st(H.B)})),
    JSON.stringify(rec({seq:2,phase:'INTENDED',expected:st(H.A),next:st(H.C)})),
    JSON.stringify(rec({seq:2,phase:'CONFIRMED',expected:st(H.A),next:st(H.C)})),
  ]
  assert.throws(()=>reduceOps(parseOpLog(lines,{txid:'tx1',rel:'pkg'}),baseline), e=>e.code==='BAD_OP')
})

test('rollback next must equal baseline', ()=>{
  const lines=[
    JSON.stringify(rec({seq:1,phase:'INTENDED',next:st(H.B)})),
    JSON.stringify(rec({seq:1,phase:'CONFIRMED',next:st(H.B)})),
    JSON.stringify(rec({seq:2,phase:'INTENDED',kind:'ROLLBACK',expected:st(H.B),before:st(H.B),next:st(H.C)})),
  ]
  assert.throws(()=>reduceOps(parseOpLog(lines,{txid:'tx1',rel:'pkg'}),baseline), e=>e.code==='BAD_OP')
})

test('trailing truncated JSONL line is tolerated', ()=>{
  const parsed=parseOpLog([JSON.stringify(rec({seq:1,phase:'INTENDED'})), '{"broken"'],{txid:'tx1',rel:'pkg'})
  assert.equal(parsed.truncatedTail,true)
})

test('physical out-of-order sequence rejected', ()=>{
  assert.throws(()=>parseOpLog([
    JSON.stringify(rec({seq:2,phase:'INTENDED'})),
    JSON.stringify(rec({seq:1,phase:'INTENDED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('interleaved terminal phase rejected', ()=>{
  assert.throws(()=>parseOpLog([
    JSON.stringify(rec({seq:1,phase:'INTENDED'})),
    JSON.stringify(rec({seq:2,phase:'INTENDED'})),
    JSON.stringify(rec({seq:1,phase:'CONFIRMED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('double pending rejected', ()=>{
  assert.throws(()=>parseOpLog([
    JSON.stringify(rec({seq:1,phase:'INTENDED'})),
    JSON.stringify(rec({seq:2,phase:'INTENDED'}))],{txid:'tx1',rel:'pkg'}), e=>e.code==='BAD_OP')
})

test('absent next state is valid and rollback-required compares exists/hash', ()=>{
  const lines=[
    JSON.stringify(rec({seq:1,phase:'INTENDED',next:{exists:false,hash:null}})),
    JSON.stringify(rec({seq:1,phase:'CONFIRMED',next:{exists:false,hash:null}})),
  ]
  const parsed=parseOpLog(lines,{txid:'tx1',rel:'pkg'})
  const r=reduceOps(parsed,baseline)
  assert.equal(r.owned.exists,false)
})
