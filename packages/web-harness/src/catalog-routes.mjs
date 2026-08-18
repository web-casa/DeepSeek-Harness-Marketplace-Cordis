// DSH host 路由：只读市场目录。挂到 ctx.webServer（或测试用 node:http）。
import { CatalogError } from '../../catalog-core/src/index.js'

const PREFIX = '/cordis-mp'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function parseListQuery(url) {
  const q = url.searchParams.get('q') || ''
  const category = url.searchParams.get('category') || undefined
  const platform = url.searchParams.get('platform') || 'web'
  const sort = url.searchParams.get('sort') || undefined
  const order = url.searchParams.get('order') || undefined
  const page = parseInt(url.searchParams.get('page') || '1', 10) || 1
  const perPage = parseInt(url.searchParams.get('per_page') || '50', 10) || 50
  return { q: q || undefined, category, platform, sort, order, page, perPage }
}

export function createCatalogHandler(catalog) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
      if (url.pathname === `${PREFIX}/catalog`) {
        const result = await catalog.list(parseListQuery(url))
        return json(res, 200, { ok: true, ...result })
      }
      const m = url.pathname.match(/^\/cordis-mp\/plugin\/([^/]+)$/)
      if (m) {
        const slug = decodeURIComponent(m[1])
        const detail = await catalog.detail(slug)
        return json(res, 200, { ok: true, plugin: detail })
      }
      if (url.pathname === `${PREFIX}/health`) return json(res, 200, { ok: true, service: 'cordis-mp-catalog' })
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'no such route' } })
    } catch (e) {
      if (e instanceof CatalogError) return json(res, e.status || 502, { error: { code: e.code, message: e.message, requestId: e.requestId, retryAfter: e.retryAfter } })
      json(res, 500, { error: { code: 'INTERNAL', message: e?.message || String(e) } })
    }
  }
}

/** 挂到 DSH 上游 webServer.register({kind,path,handler}) 风格的宿主服务。 */
export function mountCatalogRoutes(webServer, catalog) {
  const handler = createCatalogHandler(catalog)
  const disposers = [
    webServer.register({ kind: 'exact', path: `${PREFIX}/catalog`, handler }),
    webServer.register({ kind: 'exact', path: `${PREFIX}/health`, handler }),
    webServer.register({ kind: 'prefix', path: `${PREFIX}/plugin`, handler }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
