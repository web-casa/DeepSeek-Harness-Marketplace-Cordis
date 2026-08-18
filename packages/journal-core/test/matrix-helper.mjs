import { Journal } from '../src/journal.mjs'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { setFailpoint } from '../src/failpoints.mjs'

const scenario = process.argv[2]
const profile = process.argv[3]
const root = process.argv[4]
const j = new Journal({ journalRoot: root, profileRoot: profile })

if (scenario === 'forward-after-rename') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  setFailpoint('replaceTarget:after-rename', ({ path }) => { if (path.endsWith('package.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.writePresent(tx, 'package.json', Buffer.from('A2'))
}
if (scenario === 'forward-after-dirfsync') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  setFailpoint('replaceTarget:after-dirfsync', ({ path }) => { if (path.endsWith('package.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.writePresent(tx, 'package.json', Buffer.from('A2'))
}
if (scenario === 'rollback-after-rename') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  setFailpoint('replaceTarget:after-rename', ({ path }) => { if (path.endsWith('package.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.recover()
}
if (scenario === 'delete-after-unlink') {
  const tx = await j.begin(['package.json'])
  setFailpoint('unlinkTarget:after-unlink', ({ path }) => { if (path.endsWith('package.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.deleteTarget(tx, 'package.json')
}
if (scenario === 'append-after-write') {
  const tx = await j.begin(['package.json'])
  setFailpoint('appendRecord:after-write', ({ path }) => { if (path.includes('/ops/')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
}
if (scenario === 'outcome-after-publish') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  await j.commitFiles(tx)
  // 覆盖 OUTCOME 由 recover 补写场景：删掉后重跑并注入 crash
  rmSync(join(root,'journal',tx,'OUTCOME.json'))
  setFailpoint('atomicFile:after-publish', ({ path }) => { if (path.endsWith('OUTCOME.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await j.recover()
}
if (scenario === 'resolution-op-after-publish') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  writeFileSync(join(profile,'package.json'),'X')
  await j.recover()
  const { ResolutionJournal } = await import('../src/resolution.mjs')
  const r = new ResolutionJournal(j)
  const baseline = j.getBaseline(tx)
  const xhash='sha256:'+createHash('sha256').update('X').digest('hex')
  const plan = { 'package.json': { expected: { exists:true, hash: xhash }, next: baseline['package.json'].state } }
  const rid = await r.beginResolution({ tx, action:'restore-snapshot', plan })
  setFailpoint('atomicFile:after-publish', ({ path }) => { if (path.includes('/resolutions/') && path.endsWith('.json')) { console.log('CRASH '+scenario); process.exit(43) } })
  await r.resolveTarget(rid, 'package.json')
}
if (scenario === 'tombstone-after-rename') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  await j.commitFiles(tx)
  setFailpoint('tombstone:after-rename', () => { console.log('CRASH '+scenario); process.exit(43) })
  await j.recover()
}
