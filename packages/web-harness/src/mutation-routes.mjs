// Web mutation 路由骨架：/cordis-mp/install、/uninstall、/status。
// 生产接入同源/CSRF 与 mutation token 后启用；当前只做 JSON 与错误映射。
import { InstallError } from '@cordis-mp/install-core'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; let settled = false; const chunks = []
    const fail = error => { if (!settled) { settled = true; reject(error) } }
    req.on('data', c => {
      if (settled) return
      size += c.length
      if (size > limit) {
        fail(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }))
        // Drain the request rather than destroying the socket, so the caller
        // receives the deterministic JSON 400 diagnostic.
        req.resume()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (settled) return
      if (!chunks.length) { settled = true; return resolve({}) }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        settled = true
        resolve(body)
      }
      catch { fail(Object.assign(new Error('invalid JSON body'), { code: 'BAD_JSON' })) }
    })
    req.on('error', fail)
  })
}

export function createMutationHandler({ installService, platform = 'web', guard = null }) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/cordis-mp/status' && req.method === 'GET') {
      const pending = typeof installService.pendingStatus === 'function' ? installService.pendingStatus() : []
      return json(res, 200, { ok: true, busy: false, pending })
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    if (guard) {
      const check = guard.guard(req)
      if (!check.ok) return json(res, check.status, { error: { code: check.reason, message: 'untrusted mutation request' } })
    }
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
      if (url.pathname === '/cordis-mp/activate') {
        const body = await readJsonBody(req)
        const out = await installService.activate({ slug: body.slug })
        return json(res, 200, { ok: true, ...out })
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'no such route' } })
    } catch (e) {
      if (e instanceof InstallError) {
        const status = ['MUTATION_BUSY', 'MUTATION_FENCED', 'SELF_INSTALL_FORBIDDEN', 'SELF_UNINSTALL_FORBIDDEN', 'HOST_ENTRY_CONFLICT', 'PENDING_ACTIVATION_EXISTS'].includes(e.code)
          ? 409
          : e.code === 'CATALOG_RECHECK_FAILED' ? 503 : 400
        return json(res, status, { error: { code: e.code, message: e.message } })
      }
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
    webServer.register({ kind: 'exact', path: '/cordis-mp/activate', handler }),
    webServer.register({ kind: 'exact', path: '/cordis-mp/status', handler }),
  ]
  return () => { for (const d of disposers) d() }
}
