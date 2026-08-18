import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, createRuntime } from '../src/index.js'

test('createRuntime wires real ports with expected paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cordis-runtime-'))
  const rt = createRuntime({ dir, baseUrl: 'http://127.0.0.1:9/api/v1', dshHome: null, profile: 'web' })
  assert.equal(rt.dir, dir)
  assert.equal(rt.journal.root, join(dir, '.cordis-mp'))
  assert.equal(rt.journal.profile, dir)
  assert.equal(rt.activation.patchPath, join(dir, 'cordis.patch.yml'))
  assert.equal(rt.inspect.cacheDir, join(dir, '.cordis-mp', 'artifacts'))
  assert.equal(rt.installService.pendingPath, join(dir, '.cordis-mp'))
  assert.ok(rt.installService.inspect)
  assert.ok(rt.installService.activation)
})

test('host injects webServer and mounts catalog + mutation routes', async () => {
  const prevDir = process.env.CORDIS_MP_PROFILE_DIR
  process.env.CORDIS_MP_PROFILE_DIR = mkdtempSync(join(tmpdir(), 'cordis-host-'))
  try {
  let captured
  const ctx = { inject(deps, fn) { captured = { deps, fn } } }
  apply(ctx)
  assert.deepEqual(captured.deps, ['webServer'])
  const routes = []
  const hostCtx = {
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(fn) { fn() },
  }
  captured.fn(hostCtx)
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [
    ['exact', '/cordis-mp/catalog'],
    ['exact', '/cordis-mp/health'],
    ['prefix', '/cordis-mp/plugin'],
    ['exact', '/cordis-mp/install'],
    ['exact', '/cordis-mp/uninstall'],
    ['exact', '/cordis-mp/activate'],
    ['exact', '/cordis-mp/status'],
    ['exact', '/cordis-mp/session'],
  ])
  } finally { if (prevDir === undefined) delete process.env.CORDIS_MP_PROFILE_DIR; else process.env.CORDIS_MP_PROFILE_DIR = prevDir }
})
