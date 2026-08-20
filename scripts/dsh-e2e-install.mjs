// 真实 DSH 安装 E2E：fixture 默认覆盖已知宿主路由；外部目录则以
// inspect → pre-disable → pending 恢复 → 显式 activate → restart 的配置证据为准。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveDshE2EOptions } from './lib/dsh-e2e-options.mjs'

const buildScript = fileURLToPath(new URL('../apps/web/scripts/build.mjs', import.meta.url))
const packScript = fileURLToPath(new URL('../apps/web/scripts/pack-smoke.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../spikes/S1/fixture-server.mjs', import.meta.url))
const pluginSlug = process.env.CORDIS_E2E_SLUG || 'dsh-market'
const expectSelfRefusal = process.env.CORDIS_E2E_EXPECT_SELF_REFUSAL === '1'
const { requestedApi, pluginRoute } = resolveDshE2EOptions({
  api: process.env.CORDIS_RUN_API,
  pluginRoute: process.env.CORDIS_E2E_PLUGIN_ROUTE,
})

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function disabledInPatch(text, id) { return new RegExp(`- id: ${escapeRegExp(id)}\\s*\\n {2}disabled: true`).test(text) }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function commandFailure(label, result) {
  return `${label} failed (status=${result.status}, signal=${result.signal ?? 'none'}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function runNode(label, script) {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 180_000 })
  if (result.status !== 0) throw new Error(commandFailure(label, result))
  return result
}

function assertPendingIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Error('install response has no inspected entryIds')
  }
  return value
}

function assertDumpConfig({ result, entryIds, disabled, label }) {
  if (result.status !== 0) throw new Error(commandFailure(`${label} dump-config`, result))
  const hasDisabled = id => new RegExp(`${escapeRegExp(id)}[\\s\\S]{0,160}disabled: true`).test(result.stdout)
  const mismatch = disabled ? entryIds.filter(id => !hasDisabled(id)) : entryIds.filter(hasDisabled)
  if (mismatch.length > 0) {
    throw new Error(`${label} dump-config has unexpected disabled state for: ${mismatch.join(', ')}\n${result.stdout.slice(0, 4000)}`)
  }
}

const children = new Set()
function track(child) {
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

async function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const gracefulExit = once(child, 'exit')
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    gracefulExit.then(() => true),
    wait(5_000).then(() => false),
  ])
  if (exited) return
  const forcedExit = once(child, 'exit')
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await Promise.race([
    forcedExit,
    wait(5_000).then(() => { throw new Error(`${label} did not exit after SIGKILL`) }),
  ])
}

function cleanupOnExit() {
  for (const child of children) {
    try { child.kill('SIGTERM') } catch {}
  }
}
process.once('exit', cleanupOnExit)

async function startFixture() {
  const child = track(spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] }))
  let output = ''
  let error = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { error += data })
  const deadline = Date.now() + 10_000
  while (!output.includes('\n') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`fixture exited early: ${output}\n${error}`)
    await wait(50)
  }
  const port = output.trim().split('\n')[0]
  if (!/^\d+$/.test(port)) throw new Error(`fixture did not start: ${output}\n${error}`)
  return { child, base: `http://127.0.0.1:${port}/api/v1` }
}

async function startWeb(env, label) {
  const child = track(spawn('dsh', ['web', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] }))
  let output = ''
  let error = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { error += data })
  const deadline = Date.now() + 30_000
  let port = null
  while (!port && Date.now() < deadline) {
    const match = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/.exec(output)
    if (match) port = match[1]
    else if (child.exitCode !== null) throw new Error(`${label} exited before readiness:\n${output}\n${error}`)
    else await wait(250)
  }
  if (!port) throw new Error(`${label} did not start:\n${output}\n${error}`)
  return { child, origin: `http://127.0.0.1:${port}` }
}

async function request(origin, path, options = {}) {
  const response = await fetch(origin + path, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

async function sessionAuth(origin) {
  const session = await request(origin, '/cordis-mp/session', { method: 'POST', headers: { origin } })
  if (session.status !== 200 || typeof session.body?.token !== 'string' || session.body.token.length === 0) {
    throw new Error(`session failed: ${JSON.stringify(session)}`)
  }
  return { origin, 'content-type': 'application/json', 'x-cordis-mp-token': session.body.token }
}

async function main() {
  const build = runNode('web plugin build', buildScript)
  if (build.stderr) process.stderr.write(build.stderr)
  const pack = runNode('web plugin pack', packScript)
  const tgz = pack.stdout.trim().split('\n').pop()
  if (!tgz || !existsSync(tgz)) throw new Error(`pack script did not return a regular artifact path: ${JSON.stringify(tgz)}`)

  const base = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
  const home = join(base, 'home')
  const dshHome = join(base, 'dsh-home')
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, HOME: home, DSH_HOME: dshHome, CI: 'true', npm_config_store_dir: '/tmp/cordis-pnpm-store' }
  const add = spawnSync('dsh', ['plugin', '--profile', 'web', 'add', `file:${tgz}`, '--ignore-scripts'], { env, encoding: 'utf8', timeout: 180_000 })
  if (add.status !== 0) throw new Error(commandFailure('market host add', add))

  let fixtureChild = null
  try {
    let apiBase = requestedApi
    if (!apiBase) {
      const fixtureServer = await startFixture()
      fixtureChild = fixtureServer.child
      apiBase = fixtureServer.base
    }
    console.log(`catalog api ${apiBase} (${requestedApi ? 'external' : 'fixture'})`)

    const webEnv = { ...env, CORDIS_RUN_API: apiBase }
    const first = await startWeb(webEnv, 'first web host')
    let activeWeb = first.child
    try {
      const detail = await request(first.origin, '/cordis-mp/plugin/' + encodeURIComponent(pluginSlug))
      if (detail.status !== 200 || typeof detail.body?.plugin?.entryRevision !== 'string') {
        throw new Error(`catalog detail failed: ${JSON.stringify(detail)}`)
      }
      const entryRevision = detail.body.plugin.entryRevision
      const auth = await sessionAuth(first.origin)
      console.log('install start', entryRevision)
      const install = await request(first.origin, '/cordis-mp/install', {
        method: 'POST', headers: auth, body: JSON.stringify({ slug: pluginSlug, entryRevision }),
      })
      console.log('install response', install.status, install.body)

      const patchPath = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
      if (expectSelfRefusal) {
        if (install.status !== 409 || install.body?.error?.code !== 'SELF_INSTALL_FORBIDDEN') {
          throw new Error(`expected self-install refusal before any profile mutation: ${JSON.stringify(install)}`)
        }
        const patch = readFileSync(patchPath, 'utf8')
        if (disabledInPatch(patch, 'cordis-mp')) {
          throw new Error('self-install refusal must not pre-disable the marketplace host')
        }
        console.log('E2E SELF-INSTALL REFUSAL PASS')
        return
      }

      if (install.status !== 200 || install.body?.pendingActivation !== true) {
        throw new Error(`install did not enter pending activation: ${JSON.stringify(install)}`)
      }
      const entryIds = assertPendingIds(install.body.pending?.entryIds)
      const patchAfterInstall = readFileSync(patchPath, 'utf8')
      console.log('patch after install:\n' + patchAfterInstall)
      if (!entryIds.every(id => disabledInPatch(patchAfterInstall, id))) {
        throw new Error('pre-disable row missing')
      }
      assertDumpConfig({
        result: spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 }),
        entryIds, disabled: true, label: 'pending before restart',
      })

      // Pending is durable state. Restart before activation and require the new
      // host to recover it before exposing mutation routes.
      await stopChild(activeWeb, 'first web host')
      const pendingWeb = await startWeb(webEnv, 'pending-recovery web host')
      activeWeb = pendingWeb.child
      const status = await request(pendingWeb.origin, '/cordis-mp/status')
      if (status.status !== 200 || !Array.isArray(status.body?.pending) || !status.body.pending.some(item => item?.slug === pluginSlug && item?.entryRevision === entryRevision)) {
        throw new Error(`pending activation did not survive restart: ${JSON.stringify(status)}`)
      }
      assertDumpConfig({
        result: spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 }),
        entryIds, disabled: true, label: 'pending after restart',
      })

      const restartAuth = await sessionAuth(pendingWeb.origin)
      const activate = await request(pendingWeb.origin, '/cordis-mp/activate', {
        method: 'POST', headers: restartAuth, body: JSON.stringify({ slug: pluginSlug }),
      })
      console.log('activate response', activate.status, activate.body)
      if (activate.status !== 200 || activate.body?.status !== 'ACTIVE') {
        throw new Error(`activate failed: ${JSON.stringify(activate)}`)
      }
      const patchAfterActivate = readFileSync(patchPath, 'utf8')
      console.log('patch after activate:\n' + patchAfterActivate)
      if (entryIds.some(id => disabledInPatch(patchAfterActivate, id))) {
        throw new Error('disable row still present after activate')
      }
      assertDumpConfig({
        result: spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 }),
        entryIds, disabled: false, label: 'active before restart',
      })

      await stopChild(activeWeb, 'pending-recovery web host')
      const restarted = await startWeb(webEnv, 'active-restart web host')
      activeWeb = restarted.child
      const activeStatus = await request(restarted.origin, '/cordis-mp/status')
      if (activeStatus.status !== 200 || !Array.isArray(activeStatus.body?.pending) || activeStatus.body.pending.some(item => item?.slug === pluginSlug)) {
        throw new Error(`activated plugin remained pending after restart: ${JSON.stringify(activeStatus)}`)
      }
      assertDumpConfig({
        result: spawnSync('dsh', ['--profile', 'web', '--dump-config'], { env, encoding: 'utf8', timeout: 60_000 }),
        entryIds, disabled: false, label: 'active after restart',
      })
      if (pluginRoute) {
        const market = await fetch(restarted.origin + pluginRoute)
        console.log(`${pluginSlug} after restart`, market.status)
        if (market.status !== 200) throw new Error(`plugin route failed after restart: ${pluginRoute} (${market.status})`)
      } else {
        console.log(`${pluginSlug} after restart: config and DSH readiness verified (no plugin HTTP route requested)`)
      }
      console.log('E2E INSTALL+PENDING-RECOVERY+ACTIVATE+RESTART PASS')
    } finally {
      await stopChild(activeWeb, 'web host cleanup')
    }
  } finally {
    await stopChild(fixtureChild, 'fixture cleanup')
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
