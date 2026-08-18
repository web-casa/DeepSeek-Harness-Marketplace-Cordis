// 从 registry tarball 下载并 inspectArtifact；保留 stagedPath 供后续使用。
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { inspectTarball, InspectError } from './inspect.mjs'

export class HttpArtifactInspector {
  constructor({ cacheDir = null, fetchImpl = fetch, maxBytes = 128 * 1024 * 1024 } = {}) {
    this.cacheDir = cacheDir; this.fetchImpl = fetchImpl; this.maxBytes = maxBytes
    if (cacheDir) mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  }
  async inspectArtifact(artifact) {
    if (!artifact?.tarball) throw new InspectError('BAD_ARTIFACT', 'artifact.tarball is required for inspection')
    const res = await this.fetchImpl(artifact.tarball, { redirect: 'error' })
    if (!res.ok) throw new InspectError('FETCH_FAILED', `tarball fetch failed: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > this.maxBytes) throw new InspectError('ARTIFACT_TOO_LARGE', `tarball exceeds ${this.maxBytes} bytes`)
    const dir = this.cacheDir || mkdtempSync(join(tmpdir(), 'cordis-artifact-'))
    const stagedPath = join(dir, `artifact-${randomBytes(6).toString('hex')}.tgz`)
    writeFileSync(stagedPath, buf, { mode: 0o600 })
    const inspected = await inspectTarball(stagedPath)
    return { ...inspected, stagedPath, bytes: buf.length }
  }
  cleanup(path) { try { if (existsSync(path)) rmSync(path, { force: true }) } catch {} }
}
