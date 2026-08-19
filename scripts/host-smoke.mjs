// R3a：apps/web host 完整 HTTP 冒烟。
// 使用 fake webServer 适配器承载真实 ctx.webServer.register 路由。
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('../spikes/S1/fixture-server.mjs', import.meta.url))
const fixtureChild = spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] })
process.once('exit', () => { try { fixtureChild.kill('SIGTERM') } catch {} })
let fixtureOut = ''
fixtureChild.stdout.on('data', d => fixtureOut += d)
for (let i = 0; i < 20 && !fixtureOut.includes('\n'); i++) await new Promise(r => setTimeout(r, 50))
if (!fixtureOut.includes('\n')) { console.error('fixture failed'); process.exit(1) }
const fixturePort = fixtureOut.trim().split('\n')[0]

const profile = mkdtempSync(join(tmpdir(), 'cordis-host-smoke-'))
mkdirSync(join(profile, '.cordis-mp'), { recursive: true })
process.env.CORDIS_RUN_API = `http://127.0.0.1:${fixturePort}/api/v1`
process.env.CORDIS_MP_PROFILE_DIR = profile

const routes = []
const fakeWebServer = { register(route) { routes.push(route); return () => {} } }
let startup
const hostCtx = { webServer: fakeWebServer, effect(fn) { startup = fn() } }
const { apply } = await import('../apps/web/src/index.js')
const captured = {}
const ctx = { inject(_deps, fn) { captured.fn = fn } }
apply(ctx)
captured.fn(hostCtx)
await startup

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  for (const route of routes) {
    const match = route.kind === 'exact' ? url.pathname === route.path : url.pathname.startsWith(route.path)
    if (match) return route.handler(req, res)
  }
  res.writeHead(404); res.end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

async function request(path, opts = {}) {
  const res = await fetch(origin + path, opts)
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const failures = []
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail ?? ''); if (!ok) failures.push(name) }

const health = await request('/cordis-mp/health'); check('health', health.status === 200 && health.body.ok, health.status)
const status = await request('/cordis-mp/status'); check('status', status.status === 200 && status.body.ok, status.status)
const catalog = await request('/cordis-mp/catalog?platform=web'); check('catalog', catalog.status === 200 && catalog.body.items.length === 1, `${catalog.status} count=${catalog.body.count}`)
const detail = await request('/cordis-mp/plugin/dsh-market'); check('detail', detail.status === 200 && detail.body.plugin.slug === 'dsh-market', detail.status)
const noSession = await request('/cordis-mp/session', { method: 'POST' }); check('session rejects no Origin', noSession.status === 403, noSession.status)
const session = await request('/cordis-mp/session', { method: 'POST', headers: { origin } }); check('session issues token', session.status === 200 && typeof session.body.token === 'string', session.status)
const noTokenInstall = await request('/cordis-mp/install', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'dsh-market' }) })
check('install rejects no token', noTokenInstall.status === 403, noTokenInstall.status)

server.close(); fixtureChild.kill()
console.log(failures.length ? `SMOKE FAIL: ${failures.join(', ')}` : 'SMOKE PASS')
process.exit(failures.length ? 1 : 0)
