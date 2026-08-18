import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, existsSync, appendFileSync, readFileSync, chmodSync, linkSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'

export function fsyncDir(dir) {
  let fd
  try { fd = openSync(dir, 'r') } catch { return }
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
export function atomicFile(path, content, { mode = 0o600, exclusive = false } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString('hex')}`)
  const fd = openSync(tmp, 'wx', mode)
  try { writeFileSync(fd, content) } finally { closeSync(fd) }
  // chmod 后再 fsync，保证 mode 元数据 durable（v7 顺序）
  chmodSync(tmp, mode)
  const fd2 = openSync(tmp, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  if (exclusive) {
    // link(tmp, path) 是原子 create-exclusive；成功后删除 tmp
    try { linkSync(tmp, path) } catch (e) { try { unlinkSync(tmp) } catch {}; throw e }
    try { unlinkSync(tmp) } catch {}
  } else {
    renameSync(tmp, path)
  }
  fsyncDir(dirname(path))
}
export function appendRecord(path, line) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const fd = openSync(path, 'a', 0o600)
  try { writeFileSync(fd, line + '\n') } finally { closeSync(fd) }
  const fd2 = openSync(path, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  fsyncDir(dirname(path))
}
export function marker(path) { atomicFile(path, '', { exclusive: true }) }
export function replaceTarget(path, data, mode = 0o600) {
  const tmp = join(dirname(path), `.tmp-target-${randomBytes(6).toString('hex')}`)
  const fd = openSync(tmp, 'wx', mode)
  try { writeFileSync(fd, data) } finally { closeSync(fd) }
  chmodSync(tmp, mode)
  const fd2 = openSync(tmp, 'r'); try { fsyncSync(fd2) } finally { closeSync(fd2) }
  renameSync(tmp, path)
  fsyncDir(dirname(path))
}
export function unlinkTargetDurable(path) {
  unlinkSync(path)
  fsyncDir(dirname(path))
}
export function readJsonIfExists(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
export { randomBytes }
