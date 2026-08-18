import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

test('host injects webServer and mounts catalog routes', async () => {
  let captured
  const ctx = {
    inject(deps, fn) { captured = { deps, fn } },
  }
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
  ])
})
