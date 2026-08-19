// 真实 DSH smoke：把 esbuild 后的 apps/web tarball 装进临时 profile，
// 启动 dsh web，验证 host 路由。不执行安装 mutation。
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const packScript = fileURLToPath(new URL('../apps/web/scripts/pack-smoke.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../spikes/S1/fixture-server.mjs', import.meta.url))
const buildScript = fileURLToPath(new URL('../apps/web/scripts/build.mjs', import.meta.url))

// 1. build + pack
const build = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' })
if (build.status !== 0) { console.error('build failed'); process.exit(1) }
const pack = spawnSync(process.execPath, [packScript], { encoding: 'utf8' })
if (pack.status !== 0) { console.error('pack failed', pack.stderr); process.exit(1) }
const tgz = pack.stdout.trim().split('\n').pop()

// 2. 临时环境
const base = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const home = join(base, 'home'); const dshHome = join(base, 'dsh-home'); mkdirSync(home, { recursive: true })
const env = { ...process.env, HOME: home, DSH_HOME: dshHome, CI: 'true', npm_config_store_dir: '/tmp/cordis-pnpm-store' }

const add = spawnSync('dsh', ['plugin', '--profile', 'web', 'add', `file:${tgz}`, '--ignore-scripts'], { env, encoding: 'utf8', timeout: 180_000 })
console.log('dsh plugin add exit', add.status)
if (add.status !== 0) { console.error(add.stdout); console.error(add.stderr); process.exit(1) }

const children = new Set()
function track(child) {
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}
function cleanupChildren() {
  for (const child of children) { try { child.kill('SIGTERM') } catch {} }
}
process.once('exit', cleanupChildren)

const fixtureChild = track(spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] }))
let fixtureOut = ''; fixtureChild.stdout.on('data', d => fixtureOut += d)
for (let i = 0; i < 40 && !fixtureOut.includes('\n'); i++) await new Promise(r => setTimeout(r, 50))
const fixturePort = fixtureOut.trim().split('\n')[0]
if (!/^\d+$/.test(fixturePort)) { console.error('fixture did not start'); process.exit(1) }

const webEnv = { ...env, CORDIS_RUN_API: `http://127.0.0.1:${fixturePort}/api/v1` }
const web = track(spawn('dsh', ['web', '--port', '0'], { env: webEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
let out = '', err = ''; web.stdout.on('data', d => out += d); web.stderr.on('data', d => err += d)
let port = null
for (let i = 0; i < 120 && !port; i++) {
  const m = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
  if (m) port = m[1]
  else await new Promise(r => setTimeout(r, 250))
}
if (!port) { console.error('dsh web did not start\n' + out + '\n' + err); web.kill(); process.exit(1) }
console.log('dsh web port', port)

const origin = `http://127.0.0.1:${port}`
const checks = []
async function req(path, opts = {}) {
  const res = await fetch(origin + path, opts)
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
const health = await req('/cordis-mp/health')
checks.push(['health', health.status === 200 && health.body.ok === true])
const catalog = await req('/cordis-mp/catalog?platform=web')
checks.push(['catalog', catalog.status === 200 && Array.isArray(catalog.body.items) && catalog.body.items.length === 1])
const detail = await req('/cordis-mp/plugin/dsh-market')
checks.push(['detail', detail.status === 200 && detail.body.plugin?.slug === 'dsh-market'])
const noOrigin = await req('/cordis-mp/session', { method: 'POST' })
checks.push(['session-no-origin', noOrigin.status === 403])
const session = await req('/cordis-mp/session', { method: 'POST', headers: { origin } })
checks.push(['session-token', session.status === 200 && typeof session.body.token === 'string'])
const noToken = await req('/cordis-mp/install', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'dsh-market' }) })
checks.push(['install-no-token', noToken.status === 403])
for (const [name, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', name)

web.kill(); fixtureChild.kill()
const failed = checks.filter(([, ok]) => !ok)
process.exit(failed.length ? 1 : 0)
