import { MutationGuard } from './security.mjs'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function createSessionHandler(guard = new MutationGuard()) {
  return (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    const check = guard.session(req)
    if (!check.ok) return json(res, 403, { error: { code: check.reason, message: 'untrusted session request' } })
    json(res, 200, { token: guard.token, ttl: 900 })
  }
}
export function mountSessionRoute(webServer, guard = new MutationGuard()) {
  return webServer.register({ kind: 'exact', path: '/cordis-mp/session', handler: createSessionHandler(guard) })
}
