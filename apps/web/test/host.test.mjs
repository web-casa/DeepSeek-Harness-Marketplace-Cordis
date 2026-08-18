import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/index.js'

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
