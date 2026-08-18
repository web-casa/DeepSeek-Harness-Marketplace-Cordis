import { Journal } from '../src/journal.mjs'
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
if (scenario === 'tombstone-after-rename') {
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  await j.commitFiles(tx)
  setFailpoint('tombstone:after-rename', () => { console.log('CRASH '+scenario); process.exit(43) })
  await j.recover()
}
