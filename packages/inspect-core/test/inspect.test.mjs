import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { inspectDir, inspectTarball, parsePatchIds } from '../src/index.js'

function makeTarball(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tar-'))
  const root = join(dir, 'package'); mkdirSync(root, { recursive: true })
  for (const [rel, text] of Object.entries(files)) { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text) }
  const out = join(dir, 'pkg.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'package'])
  return out
}

test('inspectDir extracts manifest and patch ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inspect-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' }, platforms: ['web'] } }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: demo-entry\n      name: demo\n')
  const r = inspectDir(dir)
  assert.deepEqual(r.entryIds, ['demo-entry'])
  assert.equal(r.hasBundlePatch, true)
  assert.deepEqual(r.platforms, ['web'])
})

test('inspectTarball reads package/package.json and patch', async () => {
  const file = makeTarball({
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    'cordis.patch.yml': '- insert:\n    - id: a\n    - id: b\n',
  })
  const r = await inspectTarball(file)
  assert.equal(r.packageName, 'demo')
  assert.deepEqual(r.entryIds, ['a', 'b'])
})

test('inspectTarball reads the actual safe dsh.bundle.patch declaration', async () => {
  const file = makeTarball({
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './nested/plugin.patch.yml' } } }),
    'nested/plugin.patch.yml': '- insert:\n    - id: actual-bundle-entry\n',
    'cordis.patch.yml': '- insert:\n    - id: decoy-entry\n',
  })
  const r = await inspectTarball(file)
  assert.equal(r.bundlePatch, 'nested/plugin.patch.yml')
  assert.equal(r.hasBundlePatch, true)
  assert.deepEqual(r.entryIds, ['actual-bundle-entry'])
})

test('inspectTarball rejects an unsafe dsh.bundle.patch path', async () => {
  const file = makeTarball({
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: '../outside.yml' } } }),
  })
  await assert.rejects(() => inspectTarball(file), e => e.code === 'BAD_BUNDLE_PATCH')
})

test('inspectTarball rejects missing manifest', async () => {
  const file = makeTarball({ 'readme.md': '# hi' })
  await assert.rejects(() => inspectTarball(file), e => e.code === 'BAD_MANIFEST')
})

test('parsePatchIds ignores config rows and duplicates', () => {
  assert.deepEqual(parsePatchIds('- id: x\n  config:\n    a: 1\n- id: y\n- id: x\n'), ['x', 'y'])
})
