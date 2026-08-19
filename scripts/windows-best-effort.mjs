#!/usr/bin/env node
// Windows-only journal smoke. It deliberately proves the BEST_EFFORT execution
// path, not POSIX FULL durability: directory fsync may be unavailable on NTFS
// and journal-core must downgrade safely rather than silently claiming FULL.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileLock, Journal, durabilityTier, fsyncDir } from '../packages/journal-core/src/index.js'

if (process.platform !== 'win32') {
  throw new Error(`windows-best-effort must run on win32, received ${process.platform}`)
}

const base = mkdtempSync(join(tmpdir(), 'cordis-windows-best-effort-'))
try {
  const profileRoot = join(base, 'profile')
  const journalRoot = join(base, 'journal-meta')
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(join(profileRoot, 'package.json'), 'A0')

  assert.equal(durabilityTier(), 'BEST_EFFORT')
  // On Windows this either fsyncs a supported directory handle or emits the
  // documented one-time downgrade warning; both outcomes must remain usable.
  fsyncDir(profileRoot)

  const lock = new FileLock(journalRoot)
  lock.acquire('windows-best-effort-smoke')
  try {
    lock.fence()
    const journal = new Journal({ journalRoot, profileRoot, lock })
    const txid = await journal.begin(['package.json'])
    await journal.writePresent(txid, 'package.json', Buffer.from('A1'))
    const report = await journal.recover()

    assert.equal(report[0]?.result, 'ROLLED_BACK')
    assert.equal(readFileSync(join(profileRoot, 'package.json'), 'utf8'), 'A0')
    lock.fence()
  } finally {
    lock.release()
  }
  process.stdout.write('Windows BEST_EFFORT journal smoke passed\n')
} finally {
  rmSync(base, { recursive: true, force: true })
}
