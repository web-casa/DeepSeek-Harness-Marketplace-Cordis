import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { HttpArtifactInspector } from '../src/index.js'

function makeTarball() {
  const dir = mkdtempSync(join(tmpdir(), 'hi-'))
  const root = join(dir, 'package'); mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(root, 'cordis.patch.yml'), '- insert:\n    - id: demo-entry\n')
  const out = join(dir, 'pkg.tgz')
  execFileSync('tar', ['-czf', out, '-C', dir, 'package'])
  return { file: out, integrity: 'sha512-' + createHash('sha512').update(readFileSync(out)).digest('base64') }
}

test('http inspector verifies sha512 integrity', async () => {
  const { file, integrity } = makeTarball()
  const inspector = new HttpArtifactInspector({ fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(readFileSync(file)).buffer }) })
  const r = await inspector.inspectArtifact({ tarball: 'https://x/p.tgz', integrity })
  assert.deepEqual(r.entryIds, ['demo-entry'])
})

test('http inspector rejects integrity mismatch', async () => {
  const { file } = makeTarball()
  const inspector = new HttpArtifactInspector({ fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(readFileSync(file)).buffer }) })
  await assert.rejects(() => inspector.inspectArtifact({ tarball: 'https://x/p.tgz', integrity: 'sha512-AAAA' }), e => e.code === 'INTEGRITY_MISMATCH')
})

test('http inspector rejects non-ok', async () => {
  const inspector = new HttpArtifactInspector({ fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) })
  await assert.rejects(() => inspector.inspectArtifact({ tarball: 'https://x/y.tgz', integrity: 'sha512-AAAA' }), e => e.code === 'FETCH_FAILED')
})
