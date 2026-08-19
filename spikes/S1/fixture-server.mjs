// cordis.run 本地 fixture server：桌面/Web 联调用。
// 运行：node fixture-server.mjs
// 打印端口后设置：CORDIS_RUN_API=http://127.0.0.1:<port>/api/v1
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('./fixture-data.json', import.meta.url)))
const ETAG = '"cordis-fixture-v1"'

// 1x1 红色 PNG，用于 market_image 联调
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const PNG = Buffer.from(PNG_BASE64, 'base64')

function decodeCursor(value) {
  if (!value) return null
  const match = /^fixture:(\d+)$/.exec(value)
  return match ? Number(match[1]) : NaN
}
function nextCursor(start, limit, total) {
  const next = start + limit
  return next < total ? `fixture:${next}` : null
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname
  const json = (status, body, extra = {}) => {
    if (status === 200 && req.headers['if-none-match'] === ETAG) {
      res.writeHead(304, { etag: ETAG })
      res.end()
      return
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', etag: ETAG, ...extra })
    res.end(JSON.stringify(body))
  }
  if (path === '/api/v1/plugins') {
    const platform = url.searchParams.get('platform')
    const category = url.searchParams.get('category')
    const q = (url.searchParams.get('q') || '').toLowerCase()
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
    const cursorValue = url.searchParams.get('cursor')
    const requestedLimit = cursorValue ? url.searchParams.get('limit') : (url.searchParams.get('per_page') || url.searchParams.get('limit'))
    const perPage = Math.min(100, Math.max(1, parseInt(requestedLimit || '50', 10) || 50))
    const cursor = decodeCursor(cursorValue)
    if (Number.isNaN(cursor)) { json(400, { error: { code: 'BAD_CURSOR', message: 'cursor is invalid' } }); return }
    const sort = url.searchParams.get('sort') || 'stars'
    const order = url.searchParams.get('order') || 'desc'
    let items = [...data.items]
    if (platform) items = items.filter(i => (i.platforms || []).includes(platform))
    if (category) items = items.filter(i => i.category === category)
    if (q) items = items.filter(i => i.slug.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
    const cmp = sort === 'added' ? (a,b)=>String(a.added||'').localeCompare(String(b.added||'')) : (a,b)=>((a.stars||0)-(b.stars||0))
    items = items.sort(cmp); if (order === 'desc') items = items.reverse()
    const total = items.length
    const start = cursor ?? (page - 1) * perPage
    const slice = items.slice(start, start + perPage)
    json(200, { ...data, count: total, page: { cursor: nextCursor(start, perPage, total), hasMore: start + perPage < total, limit: perPage }, items: slice })
    return
  }
  if (path.startsWith('/api/v1/plugins/')) {
    const slug = decodeURIComponent(path.slice('/api/v1/plugins/'.length))
    const item = data.items.find(i => i.slug === slug)
    if (!item) { json(404, { error: { code: 'NOT_FOUND', message: `no such slug: ${slug}` } }); return }
    json(200, {
      ...item,
      screenshots: ['https://cdn.cordis.run/screenshots/' + encodeURIComponent(slug) + '/1.webp'],
      versions: [{ version: item.source.version, source: item.source, platforms: item.platforms, engines: item.engines, blocked: item.blocked, deprecated: item.deprecated, publishedAt: item.updatedAt }],
    })
    return
  }
  if (path === '/fixtures/screenshot.png') {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length, 'cache-control': 'no-store' })
    res.end(PNG)
    return
  }
  json(404, { error: { code: 'NOT_FOUND', message: 'not found' } })
})
server.listen(0, '127.0.0.1', () => console.log(server.address().port))
