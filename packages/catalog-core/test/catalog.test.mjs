import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CatalogClient, CatalogError, installability } from '../src/index.js'

const catalog = {
  schemaVersion: 1,
  catalogRevision: 'rev-1',
  updated: '2026-08-18T00:00:00Z',
  count: 2,
  page: { cursor: '1', hasMore: false, limit: 50 },
  items: [
    { slug: 'a', name: 'a', entryRevision: 'a-rev-1', description: { zh: 'A', en: 'A' }, category: 'cat',
      source: { type: 'npm', packageName: 'a', version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' },
      platforms: ['web','desktop'], engines: { dsh: '>=0.1.0-rc.6 <0.2.0' }, stars: 1, blocked: false },
    { slug: 'b', name: 'b', entryRevision: 'b-rev-1', description: { zh: 'B', en: 'B' }, category: 'cat',
      source: { type: 'npm', packageName: 'b', version: '1.0.0', integrity: 'sha512-BBBB', registry: 'https://registry.npmjs.org', tarball: 'https://registry.npmjs.org/b/-/b-1.0.0.tgz' },
      platforms: ['desktop'], engines: { dsh: '>=0.1.0-rc.6 <0.2.0' }, stars: 2, blocked: false },
  ],
}
function fakeResponse(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: k => headers[k] ?? null }, text: async () => JSON.stringify(body) }
}
function clientWith(impl) { return new CatalogClient({ fetchImpl: impl }) }

test('list parses contract response', async () => {
  const c = clientWith(async () => fakeResponse(200, catalog, { etag: '"e1"' }))
  const res = await c.list({ platform: 'desktop' })
  assert.equal(res.count, 2)
  assert.equal(res.items.length, 2)
  assert.equal(res.catalogRevision, 'rev-1')
  assert.equal(c.installability(res.items[0], 'desktop').installable, true)
  assert.equal(c.installability(res.items[1], 'web').installable, false)
})

test('ETag 304 uses cache', async () => {
  let calls = 0
  const c = clientWith(async (url, init) => {
    calls++
    if (calls === 1) return fakeResponse(200, catalog, { etag: '"e1"' })
    assert.equal(init.headers['if-none-match'], '"e1"')
    return fakeResponse(304, {})
  })
  await c.list()
  const r = await c.list()
  assert.equal(r.source, 'cache')
})

test('error body is parsed', async () => {
  const c = clientWith(async () => fakeResponse(404, { error: { code: 'NOT_FOUND', message: 'no such slug' } }))
  await assert.rejects(() => c.detail('nope'), e => e instanceof CatalogError && e.code === 'NOT_FOUND' && e.message === 'no such slug' && e.status === 404)
})

test('network failure falls back to snapshot', async () => {
  const c = new CatalogClient({ fetchImpl: async () => { throw new Error('down') }, snapshot: catalog })
  const res = await c.list({ platform: 'desktop' })
  assert.equal(res.source, 'snapshot')
  assert.equal(res.items.length, 2)
})

test('fresh detail review never falls back to a cached or snapshot response', async () => {
  let online = true
  const c = new CatalogClient({
    snapshot: catalog,
    fetchImpl: async () => {
      if (!online) throw new Error('offline')
      return fakeResponse(200, catalog, { etag: '"detail"' })
    },
  })
  await c.detail('a')
  online = false
  await assert.rejects(() => c.fetchFresh('a'), e => e instanceof CatalogError && e.code === 'NETWORK')
})

test('fresh detail review rejects an invalid 304 instead of authorizing a cached item', async () => {
  let calls = 0
  const c = clientWith(async () => {
    calls++
    return calls === 1 ? fakeResponse(200, catalog, { etag: '"detail"' }) : fakeResponse(304, {})
  })
  await c.detail('a')
  await assert.rejects(() => c.fetchFresh('a'), e => e instanceof CatalogError && e.code === 'NO_FRESH_RESPONSE' && e.status === 304)
})

test('installability only permits strict install artifacts for the requested platform', () => {
  const base = catalog.items[0]
  assert.equal(installability({ ...base, platforms: ['unknown'] }, 'web').installable, false)
  assert.equal(installability({ ...base, source: { ...base.source, tarball: null } }, 'web').reasons.includes('missing-tarball'), true)
  assert.equal(installability({ ...base, source: { ...base.source, tarball: 'http://registry.npmjs.org/a/-/a-1.0.0.tgz' } }, 'web').reasons.includes('tarball-origin-mismatch'), true)
  assert.equal(installability({ ...base, source: { ...base.source, registry: null } }, 'web').reasons.includes('registry-not-allowed'), true)
  assert.equal(installability({ ...base, entryRevision: null }, 'web').reasons.includes('missing-entry-revision'), true)
  assert.equal(installability({ ...base, engines: {} }, 'web').reasons.includes('bad-engines-dsh'), true)
})

test('legacy flat item and page number are normalized', async () => {
  const legacy = { schemaVersion: 1, catalogRevision: 'r', total: 1, page: 1, per_page: 30, items: [
    { slug: 'legacy', name: 'legacy', npm: 'legacy', version: '2.0.0', integrity: 'sha512-CCCC', description: 'Legacy text', platforms: ['web'] }
  ]}
  const c = clientWith(async () => fakeResponse(200, legacy))
  const res = await c.list()
  assert.equal(res.page.cursor, '1'); assert.equal(res.page.limit, 30)
  assert.equal(res.items[0].description.zh, 'Legacy text')
  assert.equal(res.items[0].source.packageName, 'legacy')
  assert.equal(c.installability(res.items[0], 'web').installable, false)
  assert.equal(c.installability(res.items[0], 'web').reasons.includes('non-npm-source'), true)
})

test('detail rejects screenshots outside the contract CDN', async () => {
  const item = { ...catalog.items[0], screenshots: ['https://cdn.cordis.run/screenshots/a/1.webp', 'http://127.0.0.1/unsafe.png', 'https://example.test/unsafe.png'] }
  const c = clientWith(async () => fakeResponse(200, item))
  const detail = await c.detail('a')
  assert.deepEqual(detail.screenshots, ['https://cdn.cordis.run/screenshots/a/1.webp'])
})

test('fixture server integration: cursor/page compatibility, ETag, detail, and error', async () => {
  const fixture = fileURLToPath(new URL('../../../spikes/S1/fixture-server.mjs', import.meta.url))
  const child = spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', d => out += d)
  child.stderr.on('data', d => err += d)
  for (let i = 0; i < 20 && !out.includes('\n'); i++) await new Promise(r => setTimeout(r, 50))
  assert.ok(out.includes('\n'), 'fixture server did not start; err=' + err + ' fixture=' + fixture)
  const port = out.trim().split('\n')[0]
  try {
    const c = new CatalogClient({ baseUrl: `http://127.0.0.1:${port}/api/v1` })
    const list = await c.list({ platform: 'desktop', limit: 1 })
    assert.equal(list.source, 'network')
    assert.equal(list.count, 2)
    assert.equal(list.items.length, 1)
    assert.equal(list.page.hasMore, true)
    assert.equal(list.page.cursor, 'fixture:1')
    const cursorPage = await c.list({ platform: 'desktop', cursor: list.page.cursor, limit: 1 })
    assert.equal(cursorPage.items[0].slug, 'desktop-only')
    assert.equal(cursorPage.page.hasMore, false)
    assert.equal(cursorPage.page.cursor, null)
    const legacyPage = await c.list({ platform: 'desktop', page: 2, perPage: 1 })
    assert.equal(legacyPage.items[0].slug, 'desktop-only')
    const category = await c.list({ category: 'agent' })
    assert.deepEqual(category.items.map(item => item.slug), ['desktop-only'])
    const listUrl = `http://127.0.0.1:${port}/api/v1/plugins?platform=web&limit=1`
    const first = await fetch(listUrl)
    const etag = first.headers.get('etag')
    assert.equal(first.status, 200)
    assert.ok(etag)
    const notModified = await fetch(listUrl, { headers: { 'if-none-match': etag } })
    assert.equal(notModified.status, 304)
    const probe = fileURLToPath(new URL('../../../scripts/cordis-run-contract-probe.mjs', import.meta.url))
    const probeResult = spawnSync(process.execPath, [probe], {
      env: { ...process.env, CORDIS_RUN_API: `http://127.0.0.1:${port}/api/v1` }, encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(probeResult.status, 0, probeResult.stderr || probeResult.stdout)
    const detail = await c.detail('dsh-market')
    assert.equal(detail.source.type, 'npm')
    assert.equal(detail.screenshots.length, 1)
    assert.match(detail.screenshots[0], /^https:\/\/cdn\.cordis\.run\//)
    await assert.rejects(() => c.detail('not-exist'), e => e.code === 'NOT_FOUND')
  } finally {
    child.kill()
  }
})
