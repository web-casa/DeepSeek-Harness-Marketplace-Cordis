// 真实 E2E：从 fixture catalog 发起 install mutation，验证 pre-disable 与 activate。
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const buildScript = fileURLToPath(new URL('../apps/web/scripts/build.mjs', import.meta.url))
const packScript = fileURLToPath(new URL('../apps/web/scripts/pack-smoke.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../spikes/S1/fixture-server.mjs', import.meta.url))
const requestedApi = process.env.CORDIS_RUN_API?.replace(/\/+$/, '') || null
const pluginSlug = process.env.CORDIS_E2E_SLUG || 'dsh-market'
const pluginRoute = process.env.CORDIS_E2E_PLUGIN_ROUTE || '/dsh-market/registry'
const expectSelfRefusal = process.env.CORDIS_E2E_EXPECT_SELF_REFUSAL === '1'

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function disabledInPatch(text, id) { return new RegExp(`- id: ${escapeRegExp(id)}\\s*\\n {2}disabled: true`).test(text) }

const build = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' })
if (build.status !== 0) { console.error('build failed'); process.exit(1) }
const pack = spawnSync(process.execPath, [packScript], { encoding: 'utf8' })
if (pack.status !== 0) { console.error(pack.stderr); process.exit(1) }
const tgz = pack.stdout.trim().split('\n').pop()

const base = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
const home = join(base, 'home'); const dshHome = join(base, 'dsh-home'); mkdirSync(home, { recursive: true })
const env = { ...process.env, HOME: home, DSH_HOME: dshHome, CI: 'true', npm_config_store_dir: '/tmp/cordis-pnpm-store' }
const add = spawnSync('dsh', ['plugin', '--profile', 'web', 'add', `file:${tgz}`, '--ignore-scripts'], { env, encoding: 'utf8', timeout: 180_000 })
if (add.status !== 0) { console.error('add failed\n', add.stdout, add.stderr); process.exit(1) }

let fixtureChild = null
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
let apiBase = requestedApi
if (!apiBase) {
  fixtureChild = track(spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] }))
  let fixtureOut = ''; fixtureChild.stdout.on('data', d => fixtureOut += d)
  for (let i = 0; i < 40 && !fixtureOut.includes('\n'); i++) await new Promise(r => setTimeout(r, 50))
  const fixturePort = fixtureOut.trim().split('\n')[0]
  if (!/^\d+$/.test(fixturePort)) { console.error('fixture did not start'); fixtureChild.kill(); process.exit(1) }
  apiBase = `http://127.0.0.1:${fixturePort}/api/v1`
}
console.log(`catalog api ${apiBase} (${requestedApi ? 'external' : 'fixture'})`)

const webEnv = { ...env, CORDIS_RUN_API: apiBase }
const web = track(spawn('dsh', ['web', '--port', '0'], { env: webEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
let out = '', err = ''; web.stdout.on('data', d => out += d); web.stderr.on('data', d => err += d)
let port = null
for (let i = 0; i < 120 && !port; i++) { const m = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (m) port = m[1]; else await new Promise(r => setTimeout(r, 250)) }
if (!port) { console.error('web did not start\n' + out + '\n' + err); web.kill(); process.exit(1) }
const origin = `http://127.0.0.1:${port}`
async function req(path, opts = {}) { const res = await fetch(origin + path, opts); const text = await res.text(); let body; try { body = JSON.parse(text) } catch { body = text }; return { status: res.status, body } }

const session = await req('/cordis-mp/session', { method: 'POST', headers: { origin } })
if (session.status !== 200) throw new Error('session failed ' + JSON.stringify(session))
const token = session.body.token
const auth = { origin, 'content-type': 'application/json', 'x-cordis-mp-token': token }
const detail = await req('/cordis-mp/plugin/' + encodeURIComponent(pluginSlug))
const entryRevision = detail.body.plugin.entryRevision
console.log('install start', entryRevision)
const install = await req('/cordis-mp/install', { method: 'POST', headers: auth, body: JSON.stringify({ slug: pluginSlug, entryRevision }) })
console.log('install response', install.status, install.body)
if (expectSelfRefusal) {
  if (install.status !== 409 || install.body?.error?.code !== 'SELF_INSTALL_FORBIDDEN') {
    console.error('expected self-install refusal before any profile mutation')
    web.kill(); fixtureChild?.kill(); process.exit(1)
  }
  const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  const patch = readFileSync(patchPath, 'utf8')
  if (disabledInPatch(patch, 'cordis-mp')) {
    console.error('self-install refusal must not pre-disable the marketplace host')
    web.kill(); fixtureChild?.kill(); process.exit(1)
  }
  console.log('E2E SELF-INSTALL REFUSAL PASS')
  web.kill(); fixtureChild?.kill(); process.exit(0)
}
if (install.status !== 200 || !install.body.pendingActivation) { console.error(out, err); process.exit(1) }
const entryIds = install.body.pending?.entryIds
if (!Array.isArray(entryIds) || entryIds.length === 0) { console.error('install response has no inspected entryIds'); process.exit(1) }

const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
const patchAfterInstall = readFileSync(patchPath, 'utf8')
console.log('patch after install:\n' + patchAfterInstall)
if (!entryIds.every(id => disabledInPatch(patchAfterInstall, id))) { console.error('pre-disable row missing'); process.exit(1) }

const dump1 = spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 })
if (dump1.status !== 0 || !entryIds.every(id => new RegExp(`${escapeRegExp(id)}[\\s\\S]{0,80}disabled: true`).test(dump1.stdout))) { console.error('dump-config did not show disabled entry status=' + dump1.status + '\n' + dump1.stdout.slice(0, 2000)); process.exit(1) }

const activate = await req('/cordis-mp/activate', { method: 'POST', headers: auth, body: JSON.stringify({ slug: pluginSlug }) })
console.log('activate response', activate.status, activate.body)
if (activate.status !== 200 || activate.body.status !== 'ACTIVE') process.exit(1)

const patchAfterActivate = readFileSync(patchPath, 'utf8')
console.log('patch after activate:\n' + patchAfterActivate)
if (entryIds.some(id => disabledInPatch(patchAfterActivate, id))) { console.error('disable row still present after activate'); process.exit(1) }

const dump2 = spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 })
if (dump2.status !== 0 || entryIds.some(id => new RegExp(`${escapeRegExp(id)}[\\s\\S]{0,80}disabled: true`).test(dump2.stdout))) { console.error('dump-config still disabled after activate status=' + dump2.status); process.exit(1) }
// 重启 DSH，验证 activate 后目标插件的已知宿主路由真实可达。
web.kill()
await new Promise(r => setTimeout(r, 500))
const web2 = track(spawn('dsh', ['web', '--port', '0'], { env: webEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
let out2 = '', err2 = ''; web2.stdout.on('data', d => out2 += d); web2.stderr.on('data', d => err2 += d)
let port2 = null
for (let i = 0; i < 120 && !port2; i++) { const m = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(out2); if (m) port2 = m[1]; else await new Promise(r => setTimeout(r, 250)) }
if (!port2) { console.error('restart failed\n' + out2 + '\n' + err2); process.exit(1) }
const market = await fetch(`http://127.0.0.1:${port2}${pluginRoute}`)
console.log(`${pluginSlug} after restart`, market.status)
if (market.status !== 200) process.exit(1)
console.log('E2E INSTALL+ACTIVATE+RESTART PASS')
web2.kill(); fixtureChild?.kill()
process.exit(0)
