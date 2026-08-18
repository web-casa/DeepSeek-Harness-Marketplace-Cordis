import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMarketApi } from '../src/client/api.js'

test('install obtains session token and sends it', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([url, init.method, init.headers || {}])
    if (url.endsWith('/cordis-mp/session')) return mk(200, { token: 'T1' })
    if (url.endsWith('/cordis-mp/install')) return mk(200, { ok: true })
    throw new Error('unexpected ' + url)
  }
  const api = createMarketApi({ fetchImpl })
  await api.install({ slug: 'p', entryRevision: 'r' })
  assert.equal(calls[1][2]['x-cordis-mp-token'], 'T1')
  assert.equal(calls[1][1], 'POST')
})

test('403 retries session once and succeeds', async () => {
  const calls = []
  let installCalls = 0
  const fetchImpl = async (url, init = {}) => {
    calls.push(url)
    if (url.endsWith('/session')) return mk(200, { token: `T${calls.filter(x=>x.endsWith('/session')).length}` })
    if (url.endsWith('/install')) { installCalls++; return installCalls === 1 ? mk(403, { error: { code: 'bad-token' } }) : mk(200, { ok: true }) }
    throw new Error('unexpected')
  }
  const api = createMarketApi({ fetchImpl })
  await api.install({ slug: 'p' })
  assert.equal(calls.filter(x => x.endsWith('/session')).length, 2)
  assert.equal(installCalls, 2)
})

test('catalog serializes query params', async () => {
  let lastUrl
  const api = createMarketApi({ fetchImpl: async url => { lastUrl = url; return mk(200, { ok: true, items: [] }) } })
  await api.catalog({ q: 'x y', platform: 'web', page: 2, perPage: 20 })
  assert.match(lastUrl, /q=x\+y/)
  assert.match(lastUrl, /platform=web/)
  assert.match(lastUrl, /page=2/)
})

function mk(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), json: async () => body }
}
