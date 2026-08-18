// 从 registry tarball 流式下载并 inspectArtifact；校验 catalog integrity。
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { inspectTarball, InspectError } from './inspect.mjs'

export class HttpArtifactInspector {
  constructor({ cacheDir = null, fetchImpl = fetch, maxBytes = 128 * 1024 * 1024 } = {}) {
    this.cacheDir = cacheDir; this.fetchImpl = fetchImpl; this.maxBytes = maxBytes
    if (cacheDir) mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  }
  async inspectArtifact(artifact) {
    if (!artifact?.tarball) throw new InspectError('BAD_ARTIFACT', 'artifact.tarball is required for inspection')
    if (typeof artifact.integrity !== 'string' || !artifact.integrity.startsWith('sha512-')) throw new InspectError('BAD_ARTIFACT', 'artifact.integrity (sha512) is required')
    const res = await this.fetchImpl(artifact.tarball, { redirect: 'error' })
    if (!res.ok) throw new InspectError('FETCH_FAILED', `tarball fetch failed: HTTP ${res.status}`)
    const dir = this.cacheDir || mkdtempSync(join(tmpdir(), 'cordis-artifact-'))
    const stagedPath = join(dir, `artifact-${randomBytes(6).toString('hex')}.tgz`)
    const hash = createHash('sha512')
    let bytes = 0
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      const out = createWriteStream(stagedPath, { mode: 0o600 })
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > this.maxBytes) throw new InspectError('ARTIFACT_TOO_LARGE', `tarball exceeds ${this.maxBytes} bytes`)
          hash.update(value)
          if (!out.write(value)) await new Promise(r => out.once('drain', r))
        }
      } finally { reader.releaseLock?.() }
      out.end()
      await new Promise((resolve, reject) => { out.once('finish', resolve); out.once('error', reject) })
    } else {
      const buf = Buffer.from(await res.arrayBuffer())
      bytes = buf.length
      if (bytes > this.maxBytes) throw new InspectError('ARTIFACT_TOO_LARGE', `tarball exceeds ${this.maxBytes} bytes`)
      hash.update(buf); writeFileSync(stagedPath, buf, { mode: 0o600 })
    }
    const actual = 'sha512-' + hash.digest('base64')
    if (actual !== artifact.integrity) {
      try { rmSync(stagedPath, { force: true }) } catch {}
      throw new InspectError('INTEGRITY_MISMATCH', `tarball sha512 does not match catalog integrity`)
    }
    const inspected = await inspectTarball(stagedPath)
    return { ...inspected, stagedPath, bytes }
  }
  cleanup(path) { try { if (existsSync(path)) rmSync(path, { force: true }) } catch {} }
}
