import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshActivationPort } from '../src/index.js'

function setup(text = '[]\n') {
  const dir = mkdtempSync(join(tmpdir(), 'act-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, text)
  return { patchPath, port: new DshActivationPort({ patchPath }) }
}

test('preDisable appends disable rows and activate removes them', async () => {
  const { patchPath, port } = setup()
  assert.equal(port.preDisable(['a', 'b']), 2)
  const state = port.readState()
  assert.deepEqual(state.disables, ['a', 'b'])
  assert.equal(port.activate(['a']), 1)
  assert.deepEqual(port.readState().disables, ['b'])
  assert.ok(readFileSync(patchPath, 'utf8').includes('- id: b'))
})

test('preDisable flips forced row to disabled', async () => {
  const { port } = setup('- id: a\n  disabled: false\n')
  assert.equal(port.preDisable(['a']), 1)
  assert.deepEqual(port.readState(), { disables: ['a'], forced: [], inserts: [] })
})

test('prepareDisable uses artifact entryIds', async () => {
  const { port } = setup()
  assert.deepEqual(await port.prepareDisable({ artifact: { entryIds: ['x'] } }), { entryIds: ['x'] })
})

test('activate without disable rows is idempotent', async () => {
  const { port } = setup('- id: a\n  disabled: false\n')
  assert.equal(port.activate(['a']), 0)
  assert.deepEqual(port.readState().forced, ['a'])
})
