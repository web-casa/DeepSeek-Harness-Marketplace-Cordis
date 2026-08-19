import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileLock } from '@cordis-mp/journal-core'
import { apply, createRuntime } from '../src/index.js'

test('createRuntime wires real ports with expected paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cordis-runtime-'))
  const rt = createRuntime({ dir, baseUrl: 'http://127.0.0.1:9/api/v1', dshHome: null, profile: 'web' })
  assert.equal(rt.dir, dir)
  assert.equal(rt.journal.root, join(dir, '.cordis-mp'))
  assert.equal(rt.journal.profile, dir)
  assert.equal(rt.profileLock.root, join(dir, '.cordis-mp'))
  assert.equal(rt.journal.lock, rt.profileLock)
  assert.equal(rt.installService.lock, rt.profileLock)
  assert.equal(rt.activation.patchPath, join(dir, 'cordis.patch.yml'))
  assert.equal(rt.inspect.cacheDir, join(dir, '.cordis-mp', 'artifacts'))
  assert.equal(rt.installService.pendingPath, join(dir, '.cordis-mp'))
  assert.equal(rt.installService.selfPackageName, '@webcasa/web')
  assert.deepEqual(rt.installService.selfEntryIds, ['cordis-mp'])
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
  let effectDone
  const hostCtx = {
    webServer: { register(route) { routes.push(route); return () => {} } },
    effect(fn) { effectDone = fn() },
  }
  await captured.fn(hostCtx)
  await effectDone
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

test('host startup fails closed while profile recovery lock is busy', async () => {
  const prevDir = process.env.CORDIS_MP_PROFILE_DIR
  const dir = mkdtempSync(join(tmpdir(), 'cordis-host-lock-'))
  process.env.CORDIS_MP_PROFILE_DIR = dir
  const lock = new FileLock(join(dir, '.cordis-mp'))
  lock.acquire('mutation')
  try {
    let captured
    apply({ inject(deps, fn) { captured = { deps, fn } } })
    const routes = []
    let effectDone
    await captured.fn({
      webServer: { register(route) { routes.push(route); return () => {} } },
      effect(fn) { effectDone = fn() },
    })
    await assert.rejects(() => effectDone, e => e.code === 'LOCK_BUSY')
    assert.deepEqual(routes, [])
  } finally {
    lock.release()
    if (prevDir === undefined) delete process.env.CORDIS_MP_PROFILE_DIR; else process.env.CORDIS_MP_PROFILE_DIR = prevDir
  }
})
