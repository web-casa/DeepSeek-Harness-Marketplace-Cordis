import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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

test('invalid JSON body maps to 400', async () => {
  const svc = { async install() {} }
  const server = await listen(createMutationHandler({ installService: svc }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/install`, { method: 'POST', body: '{bad' })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'BAD_JSON')
  server.close()
})

test('mountMutationRoutes registers three exact routes', () => {
  const routes = []; const ws = { register(r) { routes.push(r); return () => {} } }
  mountMutationRoutes(ws, { installService: { install() {}, uninstall() {} } })
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [
    ['exact', '/cordis-mp/install'],
    ['exact', '/cordis-mp/uninstall'],
    ['exact', '/cordis-mp/activate'],
    ['exact', '/cordis-mp/status'],
  ])
})
