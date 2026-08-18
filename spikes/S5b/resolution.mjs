// S5b v2: independent RESOLUTION journal prototype
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

const root = process.argv[2], mode = process.argv[3], crash = process.argv[4]
const txDir = join(root, 'journal/tx1'), resDir = join(root, 'resolutions/r1'), profile = join(root, 'profile')
const files = ['package.json', 'pnpm-lock.yaml']
const CONTENTS = { A0:'A0', A1:'A1', B0:'B0', B1:'B1', X:'X' }
const hash = s => createHash('sha256').update(s).digest('hex')
const H = { A0:hash('A0'), A1:hash('A1'), B0:hash('B0'), B1:hash('B1'), X:hash('X') }
const atomic = (path, content) => {
  const tmp = path + '.tmp-' + randomBytes(3).toString('hex')
  const fd = openSync(tmp, 'wx', 0o600); writeFileSync(fd, content); fsyncSync(fd); closeSync(fd)
  renameSync(tmp, path)
  const d = openSync(dirname(path), 'r'); fsyncSync(d); closeSync(d)
}
const readState = p => existsSync(p) ? { exists:true, hash:hash(readFileSync(p,'utf8')) } : { exists:false, hash:null }
const contentOf = st => Object.entries(H).find(([,h])=>h===st.hash)?.[0]

function setup(){
  rmSync(root,{recursive:true,force:true}); mkdirSync(profile,{recursive:true}); mkdirSync(txDir,{recursive:true}); mkdirSync(join(root,'resolutions'),{recursive:true}); mkdirSync(join(root,'trash'),{recursive:true})
  writeFileSync(join(profile,'package.json'),'A0'); writeFileSync(join(profile,'pnpm-lock.yaml'),'B0')
  const baseline = { 'package.json': readState(join(profile,'package.json')), 'pnpm-lock.yaml': readState(join(profile,'pnpm-lock.yaml')) }
  atomic(join(txDir,'manifest.json'), JSON.stringify({v:1,txid:'tx1',state:'CONFLICTED',baseline}))
  writeFileSync(join(profile,'package.json'),'A1'); writeFileSync(join(profile,'pnpm-lock.yaml'),'B1')
  writeFileSync(join(profile,'package.json'),'X') // 外部编辑造成冲突
  atomic(join(txDir,'report.json'), JSON.stringify({conflict:true,target:'package.json',current:readState(join(profile,'package.json'))}))
}

function makePlan(){
  const tx = JSON.parse(readFileSync(join(txDir,'manifest.json'),'utf8'))
  const plan = {}
  for (const rel of files) plan[rel] = { expected: readState(join(profile,rel)), next: tx.baseline[rel] }
  return plan
}

function persistPlan(plan){
  mkdirSync(resDir,{recursive:true})
  atomic(join(resDir,'manifest.json'), JSON.stringify({v:1,resolutionId:'r1',txid:'tx1',action:'restore-snapshot',state:'RESOLVING',plan}))
}

function resolveOne(rel, plan){
  const key = hash(rel), p = join(profile,rel), opFile = join(resDir,'op-'+key+'.json'), cf = join(resDir,'confirmed-'+key)
  if (!existsSync(opFile)) atomic(opFile, JSON.stringify({kind:'RESOLUTION', expected:plan[rel].expected, next:plan[rel].next}))
  const op = JSON.parse(readFileSync(opFile,'utf8'))
  const current = readState(p)
  if (existsSync(cf)) {
    if (current.hash === op.next.hash && current.exists === op.next.exists) return 'DONE'
    if (current.hash === op.expected.hash && current.exists === op.expected.exists) { rmSync(cf,{force:true}); return 'PENDING' } // confirmed 后又被改回，重做
    return 'CONFLICT'
  }
  if (current.hash === op.next.hash && current.exists === op.next.exists) { atomic(cf,'ok'); return 'DONE' }
  if (current.hash === op.expected.hash && current.exists === op.expected.exists) {
    const content = contentOf(op.next)
    if (content === undefined) return 'CONFLICT'
    writeFileSync(p, content)
    if (crash === 'mid-resolve' && rel === 'package.json') { console.log('CRASH_MID_RESOLVE'); process.exit(0) }
    atomic(cf,'ok')
    return 'DONE'
  }
  return 'CONFLICT'
}

function run(){
  setup()
  const plan = makePlan(); persistPlan(plan)
  let i = 0
  for (const rel of files) {
    const s = resolveOne(rel, plan); console.log('resolved', rel, s)
    if (s !== 'DONE') { atomic(join(resDir,'OUTCOME.json'), JSON.stringify({outcome:'RESOLUTION_CONFLICTED', rel})); console.log('RESOLUTION_CONFLICTED'); return }
    i++
    if (crash === 'after-first' && i === 1) { console.log('CRASH_AFTER_FIRST'); process.exit(0) }
  }
  atomic(join(resDir,'OUTCOME.json'), JSON.stringify({outcome:'RESOLVED'}))
  if (crash === 'after-outcome') { console.log('CRASH_AFTER_OUTCOME'); process.exit(0) }
  renameSync(resDir, join(root,'trash','r1')); renameSync(txDir, join(root,'trash','tx1'))
  console.log('RESOLVED_AND_CLEANED')
}

function recover(){
  if (!existsSync(join(resDir,'manifest.json'))) {
    if (existsSync(join(root,'trash','r1')) || existsSync(join(root,'trash','tx1'))) { console.log(JSON.stringify({result:'TRASH_CLEANED'})); return }
    console.log(JSON.stringify({result:'NOTHING'})); return
  }
  const m = JSON.parse(readFileSync(join(resDir,'manifest.json'),'utf8'))
  if (existsSync(join(resDir,'OUTCOME.json'))) {
    const out = JSON.parse(readFileSync(join(resDir,'OUTCOME.json'),'utf8'))
    if (out.outcome === 'RESOLVED') { console.log(JSON.stringify({result:'OUTCOME_RESOLVED_TOMBSTONE'})); return }
    if (out.outcome === 'RESOLUTION_CONFLICTED') { console.log(JSON.stringify({result:'OUTCOME_RESOLUTION_CONFLICTED'})); return }
  }
  const statuses = {}
  for (const rel of files) statuses[rel] = resolveOne(rel, m.plan)
  const conflicts = Object.values(statuses).filter(s=>s==='CONFLICT')
  const allDone = Object.values(statuses).every(s=>s==='DONE')
  if (conflicts.length) { atomic(join(resDir,'OUTCOME.json'), JSON.stringify({outcome:'RESOLUTION_CONFLICTED'})); console.log(JSON.stringify({result:'RESOLUTION_CONFLICTED', statuses})); return }
  if (allDone) { atomic(join(resDir,'OUTCOME.json'), JSON.stringify({outcome:'RESOLVED'})); console.log(JSON.stringify({result:'RESOLVED', statuses})); return }
  console.log(JSON.stringify({result:'RESOLVING_CONTINUED', statuses}))
}

if (mode==='setup') setup()
else if (mode==='plan-only') { setup(); persistPlan(makePlan()); console.log('PLANNED') }
else if (mode==='run') run()
else if (mode==='recover') recover()
