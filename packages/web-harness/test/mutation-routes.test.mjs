import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { InstallError } from '@cordis-mp/install-core'
import { createMutationHandler, mountMutationRoutes } from '../src/mutation-routes.mjs'

function listen(h) { return new Promise(resolve => { const s = createServer(h); s.listen(0, '127.0.0.1', () => resolve(s)) }) }

test('install route forwards slug and confirmation', async () => {
  let called
  const svc = { async install(opts) { called = opts; return { status: 'COMMITTED' } }, async uninstall() {},
    async activate() {} }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'p', entryRevision: 'rev-1' }) })
  assert.equal(res.status, 200)
  assert.deepEqual(called, { slug: 'p', platform: 'web', confirmation: { entryRevision: 'rev-1' } })
  server.close()
})

test('uninstall route forwards name', async () => {
  let called
  const svc = { async install() {}, async uninstall(opts) { called = opts; return { status: 'COMMITTED' } } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/uninstall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'demo' }) })
  assert.equal(res.status, 200)
  assert.equal(called.packageName, 'demo')
  server.close()
})

test('activate route forwards slug', async () => {
  let called
  const svc = { async install() {}, async uninstall() {}, async activate(opts) { called = opts; return { status: 'ACTIVE' } } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'p' }) })
  assert.equal(res.status, 200)
  assert.deepEqual(called, { slug: 'p' })
  server.close()
})

test('status route exposes durable pending activations after host recovery', async () => {
  const svc = { pendingStatus() { return [{ slug: 'p', entryRevision: 'rev-1', createdAt: 1 }] } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/status`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(body.pending, [{ slug: 'p', entryRevision: 'rev-1', createdAt: 1 }])
  server.close()
})

test('invalid JSON body maps to 400', async () => {
  const svc = { async install() {} }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', body: '{bad' })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'BAD_JSON')
  server.close()
})

test('oversized JSON body maps to a deterministic 400 diagnostic', async () => {
  const svc = { async install() { throw new Error('must not install') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(64 * 1024) }),
  })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'BODY_TOO_LARGE')
  server.close()
})

test('profile lock contention maps to a recoverable 409 diagnostic', async () => {
  const svc = { async install() { throw new InstallError('MUTATION_BUSY', 'another profile mutation or recovery is in progress') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'p' }) })
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error.code, 'MUTATION_BUSY')
  server.close()
})

test('self-install refusal maps to a non-mutating 409 diagnostic', async () => {
  const svc = { async install() { throw new InstallError('SELF_INSTALL_FORBIDDEN', 'the marketplace host cannot install its own package') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'self' }) })
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error.code, 'SELF_INSTALL_FORBIDDEN')
  server.close()
})

test('host entry conflict maps to a non-mutating 409 diagnostic', async () => {
  const svc = { async install() { throw new InstallError('HOST_ENTRY_CONFLICT', 'a plugin bundle cannot replace the marketplace host entry') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'foreign' }) })
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error.code, 'HOST_ENTRY_CONFLICT')
  server.close()
})

test('self-uninstall refusal maps to a non-mutating 409 diagnostic', async () => {
  const svc = { async uninstall() { throw new InstallError('SELF_UNINSTALL_FORBIDDEN', 'the marketplace host cannot uninstall its own package') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/uninstall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'self' }) })
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error.code, 'SELF_UNINSTALL_FORBIDDEN')
  server.close()
})

test('fresh catalog recheck failure maps to a retryable 503 diagnostic', async () => {
  const svc = { async activate() { throw new InstallError('CATALOG_RECHECK_FAILED', 'catalog must be reachable before activation') } }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'p' }) })
  const body = await res.json()
  assert.equal(res.status, 503)
  assert.equal(body.error.code, 'CATALOG_RECHECK_FAILED')
  server.close()
})

test('mountMutationRoutes registers four exact routes', () => {
  const routes = []; const ws = { register(r) { routes.push(r); return () => {} } }
  mountMutationRoutes(ws, { installService: { install() {}, uninstall() {} } })
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [
    ['exact', '/cordis-mp/install'],
    ['exact', '/cordis-mp/uninstall'],
    ['exact', '/cordis-mp/activate'],
    ['exact', '/cordis-mp/status'],
  ])
})
