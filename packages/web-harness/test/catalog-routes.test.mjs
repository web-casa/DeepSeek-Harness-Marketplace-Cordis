import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createCatalogHandler, mountCatalogRoutes, parseListQuery } from '../src/index.js'
import { CatalogError } from '@cordis-mp/catalog-core'

function fakeCatalog() {
  return {
    async list(opts) { return { source: 'network', catalogRevision: 'r', count: 1, page: { cursor: '1', hasMore: false, limit: 50 }, items: [{ slug: 'a', name: 'a', description: { zh: 'A', en: 'A' }, platforms: ['web'], source: { type: 'npm', packageName: 'a', version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: null } }], opts } },
    async detail(slug) { if (slug === 'not-exist') throw new CatalogError('NOT_FOUND', 'no such slug', { status: 404 }); return { slug, name: slug, description: { zh: 'X', en: 'X' }, platforms: ['web'], screenshots: [], versions: [], source: { type: 'npm', packageName: slug, version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: null } } },
  }
}
function listen(handler) { return new Promise(resolve => { const s = createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)) }) }

test('catalog route returns list with parsed query', async () => {
  const server = await listen(createCatalogHandler(fakeCatalog()))
  const port = server.address().port
  const res = await fetch(`http://127.0.0.1:${port}/cordis-mp/catalog?platform=web&page=2&per_page=10`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.items.length, 1)
  assert.equal(body.opts.page, 2)
  server.close()
})

test('plugin detail route returns normalized plugin', async () => {
  const server = await listen(createCatalogHandler(fakeCatalog()))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/plugin/a`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.plugin.slug, 'a')
  server.close()
})

test('CatalogError maps to JSON error and HTTP status', async () => {
  const server = await listen(createCatalogHandler(fakeCatalog()))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/plugin/not-exist`)
  const body = await res.json()
  assert.equal(res.status, 404)
  assert.equal(body.error.code, 'NOT_FOUND')
  assert.equal(body.error.message, 'no such slug')
  server.close()
})

test('mountCatalogRoutes registers exact and prefix routes', () => {
  const routes = []
  const ws = { register(route) { routes.push(route); return () => {} } }
  const dispose = mountCatalogRoutes(ws, fakeCatalog())
  assert.equal(routes.length, 3)
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [
    ['exact', '/cordis-mp/catalog'],
    ['exact', '/cordis-mp/health'],
    ['prefix', '/cordis-mp/plugin'],
  ])
  dispose()
})

test('parseListQuery defaults web platform', () => {
  const q = parseListQuery(new URL('http://x/cordis-mp/catalog?q=hello'))
  assert.equal(q.platform, 'web')
  assert.equal(q.q, 'hello')
})

test('parseListQuery preserves cursor pagination without legacy page parameters', () => {
  const q = parseListQuery(new URL('http://x/cordis-mp/catalog?platform=desktop&cursor=fixture%3A20&limit=20'))
  assert.equal(q.platform, 'desktop')
  assert.equal(q.cursor, 'fixture:20')
  assert.equal(q.limit, 20)
  assert.equal(q.page, undefined)
  assert.equal(q.perPage, undefined)
})

test('parseListQuery clamps legacy pagination to the documented range', () => {
  const q = parseListQuery(new URL('http://x/cordis-mp/catalog?page=-3&per_page=999'))
  assert.equal(q.page, 1)
  assert.equal(q.perPage, 100)
})

test('malformed encoded detail slug returns a JSON 400 diagnostic', async () => {
  const server = await listen(createCatalogHandler(fakeCatalog()))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/cordis-mp/plugin/%E0%A4%A`)
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'BAD_SLUG')
  server.close()
})
