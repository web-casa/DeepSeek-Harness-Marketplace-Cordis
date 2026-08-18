// Web mutation 路由骨架：/cordis-mp/install、/uninstall、/status。
// 生产接入同源/CSRF 与 mutation token 后启用；当前只做 JSON 与错误映射。
import { InstallError } from '@cordis-mp/install-core'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' })); req.destroy(); return } chunks.push(c) })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (e) { reject(Object.assign(new Error('invalid JSON body'), { code: 'BAD_JSON' })) }
    })
    req.on('error', reject)
  })
}

export function createMutationHandler({ installService, platform = 'web' }) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/cordis-mp/status' && req.method === 'GET') return json(res, 200, { ok: true, busy: false })
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    try {
      if (url.pathname === '/cordis-mp/install') {
        const body = await readJsonBody(req)
        const out = await installService.install({ slug: body.slug, platform, confirmation: { entryRevision: body.entryRevision } })
        return json(res, 200, { ok: true, ...out })
      }
      if (url.pathname === '/cordis-mp/uninstall') {
        const body = await readJsonBody(req)
        const out = await installService.uninstall({ packageName: body.name })
        return json(res, 200, { ok: true, ...out })
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'no such route' } })
    } catch (e) {
      if (e instanceof InstallError) return json(res, 400, { error: { code: e.code, message: e.message } })
      if (e.code === 'BAD_JSON' || e.code === 'BODY_TOO_LARGE') return json(res, 400, { error: { code: e.code, message: e.message } })
      json(res, 500, { error: { code: 'INTERNAL', message: e?.message || String(e) } })
    }
  }
}

export function mountMutationRoutes(webServer, opts) {
  const handler = createMutationHandler(opts)
  const disposers = [
    webServer.register({ kind: 'exact', path: '/cordis-mp/install', handler }),
    webServer.register({ kind: 'exact', path: '/cordis-mp/uninstall', handler }),
    webServer.register({ kind: 'exact', path: '/cordis-mp/status', handler }),
  ]
  return () => { for (const d of disposers) d() }
}
