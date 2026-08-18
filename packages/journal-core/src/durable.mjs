import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, existsSync, appendFileSync, readFileSync, chmodSync, linkSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { failpoint } from './failpoints.mjs'

let fsyncWarning = false
export function durabilityTier() { return process.platform === 'win32' ? 'BEST_EFFORT' : 'FULL' }
export function fsyncDir(dir) {
  try {
    const fd = openSync(dir, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  } catch (e) {
    // Windows 目录句柄语义差异：FULL 降级为 BEST_EFFORT，仅告警一次。
    if (process.platform === 'win32' && ['EISDIR','EPERM','EINVAL','ENOTSUP'].includes(e.code)) {
      if (!fsyncWarning) { console.warn('[journal-core] dir fsync unavailable on win32; durability tier=BEST_EFFORT'); fsyncWarning = true }
      return
    }
    throw e
  }
}
export function atomicFile(path, content, { mode = 0o600, exclusive = false } = {}) {
  failpoint('atomicFile:before', { path, exclusive })

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString('hex')}`)
  const fd = openSync(tmp, 'wx', mode)
  try { writeFileSync(fd, content) } finally { closeSync(fd) }
  // chmod 后再 fsync，保证 mode 元数据 durable（v7 顺序）
  chmodSync(tmp, mode)
  const fd2 = openSync(tmp, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  failpoint('atomicFile:after-write', { path, exclusive })
  if (exclusive) {
    // link(tmp, path) 是原子 create-exclusive；成功后删除 tmp
    try { linkSync(tmp, path) } catch (e) { try { unlinkSync(tmp) } catch {}; throw e }
    try { unlinkSync(tmp) } catch {}
    failpoint('atomicFile:after-publish', { path, exclusive })
  } else {
    renameSync(tmp, path)
    failpoint('atomicFile:after-publish', { path, exclusive })
  }
  failpoint('atomicFile:before-dirfsync', { path, exclusive })
  fsyncDir(dirname(path))
  failpoint('atomicFile:after-dirfsync', { path, exclusive })
}
export function appendRecord(path, line) {
  failpoint('appendRecord:before', { path })

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const fd = openSync(path, 'a', 0o600)
  try { writeFileSync(fd, line + '\n') } finally { closeSync(fd) }
  failpoint('appendRecord:after-write', { path })
  const fd2 = openSync(path, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  failpoint('appendRecord:before-dirfsync', { path })
  fsyncDir(dirname(path))
  failpoint('appendRecord:after-dirfsync', { path })
}
export function marker(path) { failpoint('marker:before', { path }); atomicFile(path, '', { exclusive: true }); failpoint('marker:after', { path }) }
export function replaceTarget(path, data, mode = 0o600) {
  failpoint('replaceTarget:before', { path })

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = join(dirname(path), `.tmp-target-${randomBytes(6).toString('hex')}`)
  const fd = openSync(tmp, 'wx', mode)
  try { writeFileSync(fd, data) } finally { closeSync(fd) }
  failpoint('replaceTarget:after-write', { path })
  chmodSync(tmp, mode)
  const fd2 = openSync(tmp, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  failpoint('replaceTarget:before-rename', { path })
  renameSync(tmp, path)
  failpoint('replaceTarget:after-rename', { path })
  fsyncDir(dirname(path))
  failpoint('replaceTarget:after-dirfsync', { path })
}
export function unlinkTargetDurable(path) {
  failpoint('unlinkTarget:before', { path })

  unlinkSync(path)
  failpoint('unlinkTarget:after-unlink', { path })
  fsyncDir(dirname(path))
  failpoint('unlinkTarget:after-dirfsync', { path })
}
export function readJsonIfExists(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
export { randomBytes }

export function tombstone(kind, dir) {
  failpoint('tombstone:before', { kind, dir })

  if (!existsSync(dir)) return
  // 统一 trash 根目录：<root>/trash
  const trashRoot = join(dirname(dirname(dir)), 'trash')
  mkdirSync(trashRoot, { recursive: true, mode: 0o700 })
  const target = join(trashRoot, `${kind}-${basename(dir)}-${randomBytes(6).toString('hex')}`)
  renameSync(dir, target)
  failpoint('tombstone:after-rename', { kind, dir, target })
  fsyncDir(dirname(dir))
  failpoint('tombstone:after-src-fsync', { kind, dir, target })
  fsyncDir(trashRoot)
  failpoint('tombstone:after-dirfsync', { kind, dir, target })
  rmSync(target, { recursive: true, force: true })
}

export function sweepTrash(root, { olderThanMs = 60 * 60 * 1000 } = {}){
  const trashRoot = join(root, 'trash')
  if (!existsSync(trashRoot)) return
  for (const name of readdirSync(trashRoot)) {
    const p = join(trashRoot, name)
    try {
      if (Date.now() - statSync(p).mtimeMs < olderThanMs) continue // 保留新鲜残骸供断链恢复
      rmSync(p, { recursive: true, force: true })
    } catch {}
  }
}
