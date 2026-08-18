import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'

const dir = process.argv[3]
const mode = process.argv[2]
const valuePath = join(dir, 'value.txt')
const intentPath = join(dir, 'intent.json')
const journalPath = join(dir, 'journal.json')
const markerPath = join(dir, 'COMMITTED')

const hash = (s) => createHash('sha256').update(s).digest('hex')
const atomicWrite = (path, content) => {
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`
  const fd = openSync(tmp, 'wx', 0o600)
  writeFileSync(fd, content); fsyncSync(fd); closeSync(fd)
  renameSync(tmp, path)
  const dfd = openSync(dirname(path), 'r'); fsyncSync(dfd); closeSync(dfd)
}

function setup(){ rmSync(dir, {recursive:true, force:true}); mkdirSync(dir, {recursive:true}); atomicWrite(valuePath, 'V0') }

function run(crash){
  setup()
  const beforeHash = hash('V0')
  atomicWrite(journalPath, JSON.stringify({txid:'tx1', state:'PREPARED', beforeHash}))
  const nextHash = hash('V1')
  atomicWrite(intentPath, JSON.stringify({phase:'intended', expectedHash:beforeHash, nextHash}))
  atomicWrite(valuePath, 'V1')
  if (crash === 'after-write') { console.log('CRASHED_AFTER_WRITE'); process.exit(0) }
  atomicWrite(intentPath, JSON.stringify({phase:'confirmed', expectedHash:beforeHash, nextHash}))
  if (crash === 'after-confirm') { console.log('CRASHED_AFTER_CONFIRM'); process.exit(0) }
  atomicWrite(markerPath, 'ok')
  if (crash === 'after-committed') { console.log('CRASHED_AFTER_COMMITTED'); process.exit(0) }
  for (const f of [journalPath,intentPath,markerPath]) rmSync(f,{force:true})
  console.log('CLEAN')
}

function recover(){
  if (!existsSync(journalPath)) { console.log(JSON.stringify({result:'CLEAN'})); return }
  const journal = JSON.parse(readFileSync(journalPath,'utf8'))
  const beforeHash = journal.beforeHash
  const intent = JSON.parse(readFileSync(intentPath,'utf8'))
  const currentHash = hash(readFileSync(valuePath,'utf8'))
  const marker = existsSync(markerPath)
  let decision
  if (marker) {
    decision = currentHash === intent.nextHash ? 'COMMITTED_OK' : 'COMMITTED_CONFLICT'
  } else if (intent.phase === 'confirmed') {
    decision = currentHash === intent.nextHash ? 'ROLLBACK_OWN_WRITE' : (currentHash === beforeHash ? 'ROLLBACK_IDEMPOTENT' : 'CONFLICT')
  } else if (intent.phase === 'intended') {
    if (currentHash === intent.nextHash) { atomicWrite(intentPath, JSON.stringify({...intent, phase:'confirmed'})); decision = 'RECOVERED_OWN_WRITE_THEN_ROLLBACK' }
    else if (currentHash === beforeHash) decision = 'NOTHING_WRITTEN'
    else decision = 'CONFLICT'
  } else decision = 'UNRECOVERABLE'
  let rollback = false
  if (decision.includes('ROLLBACK')) { atomicWrite(valuePath, 'V0'); rollback = true }
  const out = {marker, intentPhase:intent.phase, decision, valueAfter: readFileSync(valuePath,'utf8'), rollback}
  console.log(JSON.stringify(out))
}
if (mode==='run') run(process.argv[4])
else if (mode==='recover') recover()
