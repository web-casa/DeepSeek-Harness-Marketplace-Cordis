// dsh CLI 子进程 runner：参数数组、shell:false、超时、取消。
import { spawn } from 'node:child_process'

export class DshRunnerError extends Error { constructor(code, message){ super(message); this.code=code } }

export class DshRunner {
  constructor({ dshBin = 'dsh', dshHome = process.env.DSH_HOME, profile = 'web', timeoutMs = 15 * 60 * 1000, spawnImpl = spawn } = {}) {
    if (typeof spawnImpl !== 'function') throw new TypeError('DshRunner spawnImpl must be a function')
    this.dshBin = dshBin; this.dshHome = dshHome; this.profile = profile; this.timeoutMs = timeoutMs; this.spawnImpl = spawnImpl
    this.active = null
  }
  pluginArgs(profile) { return ['plugin', '--profile', profile ?? this.profile] }
  #env() {
    const env = { ...process.env, CI: 'true' }
    if (this.dshHome) env.DSH_HOME = this.dshHome
    return env
  }
  run(args, { signal } = {}) {
    if (this.active) return Promise.resolve({ exitCode: 409, timedOut: false, stdout: '', stderr: 'another dsh operation is already running', cancelled: false, busy: true })
    let child
    try {
      child = this.spawnImpl(this.dshBin, args, { env: this.#env(), stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' })
    } catch (err) {
      return Promise.resolve({ exitCode: 127, timedOut: false, stdout: '', stderr: String(err?.message || err), cancelled: false })
    }
    this.active = child
    let stdout = '', stderr = '', timedOut = false, cancelled = false
    const timer = setTimeout(() => { timedOut = true; this.cancel() }, this.timeoutMs)
    child.stdout?.on('data', d => stdout = (stdout + d.toString()).slice(-256 * 1024))
    child.stderr?.on('data', d => stderr = (stderr + d.toString()).slice(-64 * 1024))
    const onAbort = () => { cancelled = true; this.cancel() }
    return new Promise(resolve => {
      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (this.active === child) this.active = null
        resolve(result)
      }
      child.on('error', err => {
        finish({ exitCode: 127, timedOut, stdout, stderr: `${stderr}\n${err.message}`, cancelled })
      })
      child.on('close', code => {
        finish({ exitCode: code, timedOut, stdout, stderr, cancelled })
      })
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
  cancel() {
    const child = this.active
    if (!child) return false
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }) } catch { child.kill() }
    } else {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() }
    }
    return true
  }
  async probe() {
    const r = await this.run(['--version'], { signal: AbortSignal.timeout(10_000) })
    return r.exitCode === 0 && !r.timedOut
  }
}
