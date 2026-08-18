// 子进程 crash 注入：在指定 failpoint 直接 exit(42)，模拟断电/进程死亡。
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Journal } from '../src/journal.mjs'
import { setFailpoint } from '../src/failpoints.mjs'

const scenario = process.argv[2]
const profile = process.argv[3]
const root = process.argv[4]
const j = new Journal({ journalRoot: root, profileRoot: profile })
if (scenario === 'marker-publish-crash') {
  // COMMITTED marker 已 publish、目录 fsync 前崩溃
  const tx = await j.begin(['package.json'])
  await j.writePresent(tx, 'package.json', Buffer.from('A1'))
  setFailpoint('atomicFile:after-publish', ({ path, exclusive }) => {
    if (exclusive && path.endsWith('COMMITTED')) { console.log('CRASH marker-publish'); process.exit(42) }
  })
  await j.commitFiles(tx)
}
