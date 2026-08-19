import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileLock, Journal } from '../src/index.js'

const repair = fileURLToPath(new URL('../bin/repair.mjs', import.meta.url))

function runRepair(journalRoot, profileRoot) {
  return spawnSync(process.execPath, [repair, '--journal-root', journalRoot, '--profile-root', profileRoot], { encoding: 'utf8' })
}

test('repair holds the profile lock before it recovers a journal', async () => {
  const base = mkdtempSync(join(tmpdir(), 'repair-'))
  const profileRoot = join(base, 'profile')
  const journalRoot = join(base, 'meta')
  mkdirSync(profileRoot, { recursive: true })
  writeFileSync(join(profileRoot, 'package.json'), 'A0')
  const journal = new Journal({ journalRoot, profileRoot })
  const txid = await journal.begin(['package.json'])
  await journal.writePresent(txid, 'package.json', Buffer.from('A1'))

  const held = new FileLock(journalRoot)
  held.acquire('mutation')
  try {
    const blocked = runRepair(journalRoot, profileRoot)
    assert.notEqual(blocked.status, 0)
    assert.match(blocked.stderr, /owner alive or heartbeat fresh/)
    assert.equal(readFileSync(join(profileRoot, 'package.json'), 'utf8'), 'A1')
  } finally {
    held.release()
  }

  const repaired = runRepair(journalRoot, profileRoot)
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.equal(readFileSync(join(profileRoot, 'package.json'), 'utf8'), 'A0')
  const report = JSON.parse(repaired.stdout)
  assert.equal(report.journal.entries[0]?.result, 'ROLLED_BACK')
})
