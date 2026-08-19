// 客户端 API 封装：设置页 UI 与宿主 HTTP 路由之间的唯一通道。
// 同源 fetch；mutation 自动获取并使用 X-Cordis-MP-Token。
export function createMarketApi({ fetchImpl = globalThis.fetch, base = '' } = {}) {
  let token = null
  async function session() {
    const res = await fetchImpl(`${base}/cordis-mp/session`, { method: 'POST' })
    const body = await json(res)
    if (typeof body.token !== 'string' || !body.token) {
      const error = new Error('session failed: response has no mutation token')
      error.code = 'BAD_SESSION'
      error.status = res.status
      throw error
    }
    token = body.token
    return body.token
  }
  async function json(res) {
    const text = await res.text()
    let body = {}; try { body = JSON.parse(text) } catch {}
    if (!res.ok) {
      const e = new Error(body?.error?.message || `HTTP ${res.status}`)
      e.code = body?.error?.code || 'HTTP_ERROR'; e.status = res.status
      e.requestId = body?.error?.requestId || null; e.retryAfter = body?.error?.retryAfter ?? null
      throw e
    }
    return body
  }
  async function mutation(path, body) {
    if (!token) await session()
    let retried = false
    for (;;) {
      const res = await fetchImpl(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-cordis-mp-token': token }, body: JSON.stringify(body),
      })
      if (res.status === 403 && !retried) { retried = true; token = null; await session(); continue }
      return json(res)
    }
  }
  return {
    session,
    async catalog(params = {}) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
      const res = await fetchImpl(`${base}/cordis-mp/catalog?${qs}`)
      return json(res)
    },
    async detail(slug) { return json(await fetchImpl(`${base}/cordis-mp/plugin/${encodeURIComponent(slug)}`)) },
    async status() { return json(await fetchImpl(`${base}/cordis-mp/status`)) },
    install: payload => mutation('/cordis-mp/install', payload),
    activate: payload => mutation('/cordis-mp/activate', payload),
    uninstall: payload => mutation('/cordis-mp/uninstall', payload),
  }
}
