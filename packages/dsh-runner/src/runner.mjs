// dsh CLI 子进程 runner：参数数组、shell:false、超时、取消。
import { spawn } from 'node:child_process'

export class DshRunnerError extends Error { constructor(code, message){ super(message); this.code=code } }

export class DshRunner {
  constructor({ dshBin = 'dsh', dshHome = process.env.DSH_HOME, profile = 'web', timeoutMs = 15 * 60 * 1000 } = {}) {
    this.dshBin = dshBin; this.dshHome = dshHome; this.profile = profile; this.timeoutMs = timeoutMs
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
    const child = spawn(this.dshBin, args, { env: this.#env(), stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' })
    this.active = child
    let stdout = '', stderr = '', timedOut = false, cancelled = false
    const timer = setTimeout(() => { timedOut = true; this.cancel() }, this.timeoutMs)
    child.stdout?.on('data', d => stdout = (stdout + d.toString()).slice(-256 * 1024))
    child.stderr?.on('data', d => stderr = (stderr + d.toString()).slice(-64 * 1024))
    const onAbort = () => { cancelled = true; this.cancel() }
    signal?.addEventListener('abort', onAbort, { once: true })
    return new Promise(resolve => {
      child.on('error', err => {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.active = null
        resolve({ exitCode: 127, timedOut, stdout, stderr: `${stderr}\n${err.message}`, cancelled })
      })
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.active = null
        resolve({ exitCode: code, timedOut, stdout, stderr, cancelled })
      })
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
