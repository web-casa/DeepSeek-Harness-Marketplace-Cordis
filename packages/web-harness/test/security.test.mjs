import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { MutationGuard, createSessionHandler, createMutationHandler } from '../src/index.js'

function listen(handler) { return new Promise(resolve => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)) }) }

test('session requires Origin/Host match and returns token', async () => {
  const guard = new MutationGuard()
  const server = await listen(createSessionHandler(guard))
  const port = server.address().port
  const good = await fetch(`http://127.0.0.1:${port}/cordis-mp/session`, { method: 'POST', headers: { origin: `http://127.0.0.1:${port}` } })
  assert.equal(good.status, 200)
  const body = await good.json()
  assert.equal(body.token, guard.token)
  const bad = await fetch(`http://127.0.0.1:${port}/cordis-mp/session`, { method: 'POST' })
  assert.equal(bad.status, 403)
  server.close()
})

test('mutations require token and Origin/Host', async () => {
  const guard = new MutationGuard()
  let called = false
  const service = { async install() { called = true; return { status: 'COMMITTED' } }, async uninstall() {} }
  const server = await listen(createMutationHandler({ installService: service, guard }))
  const port = server.address().port
  const headers = { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }
  const noToken = await fetch(`http://127.0.0.1:${port}/cordis-mp/install`, { method: 'POST', headers, body: JSON.stringify({ slug: 'p' }) })
  assert.equal(noToken.status, 403)
  const ok = await fetch(`http://127.0.0.1:${port}/cordis-mp/install`, { method: 'POST', headers: { ...headers, 'x-cordis-mp-token': guard.token }, body: JSON.stringify({ slug: 'p' }) })
  assert.equal(ok.status, 200)
  assert.equal(called, true)
  server.close()
})

test('origin mismatch is rejected', async () => {
  const guard = new MutationGuard()
  const server = await listen(createMutationHandler({ installService: { install() {} }, guard }))
  const port = server.address().port
  const res = await fetch(`http://127.0.0.1:${port}/cordis-mp/install`, { method: 'POST', headers: { origin: `http://evil.example:${port}`, 'content-type': 'application/json', 'x-cordis-mp-token': guard.token }, body: '{}' })
  assert.equal(res.status, 403)
  server.close()
})
