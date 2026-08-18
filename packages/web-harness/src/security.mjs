// loopback + Origin/Host + Sec-Fetch-Site + mutation token。
// 定位：anti-CSRF capability，不是用户身份认证。
import { randomBytes } from 'node:crypto'

function normHost(hostHeader) {
  try {
    const u = new URL('http://' + (hostHeader || ''))
    return { host: u.hostname.toLowerCase(), port: u.port || '80' }
  } catch { return { host: (hostHeader || '').toLowerCase(), port: '' } }
}
function isLoopback(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' }
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin || origin === 'null') return { ok: false, reason: 'origin-missing-or-null' }
  let o
  try { o = new URL(origin) } catch { return { ok: false, reason: 'origin-invalid' } }
  const expected = normHost(req.headers.host)
  const actual = normHost(o.host)
  if (actual.host !== expected.host || actual.port !== expected.port) return { ok: false, reason: 'origin-host-mismatch' }
  return { ok: true }
}

export class MutationGuard {
  constructor({ allowedHosts = ['127.0.0.1', 'localhost', '[::1]'], loopbackOnly = true } = {}) {
    this.allowedHosts = new Set(allowedHosts)
    this.loopbackOnly = loopbackOnly
    this.token = randomBytes(32).toString('hex')
  }
  #baseCheck(req) {
    const reasons = []
    if (this.loopbackOnly && !isLoopback(req.socket?.remoteAddress)) reasons.push('peer-not-loopback')
    const h = normHost(req.headers.host)
    if (!this.allowedHosts.has(h.host)) reasons.push('host-not-allowed')
    const so = sameOrigin(req)
    if (!so.ok) reasons.push(so.reason)
    const sf = req.headers['sec-fetch-site']
    if (sf && !['same-origin', 'none'].includes(sf)) reasons.push('sec-fetch-site=' + sf)
    return { ok: reasons.length === 0, reasons }
  }
  session(req) { return this.#baseCheck(req) }
  guard(req) {
    const base = this.#baseCheck(req)
    if (!base.ok) return { ok: false, reason: base.reasons[0], reasons: base.reasons, status: 403 }
    const token = req.headers['x-cordis-mp-token']
    if (token !== this.token) return { ok: false, reason: 'bad-token', reasons: [...base.reasons, 'bad-token'], status: 403 }
    return { ok: true, reasons: base.reasons, status: 0 }
  }
}
