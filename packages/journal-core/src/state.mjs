import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'

export const sha256 = data => 'sha256:' + createHash('sha256').update(data).digest('hex')
export function fileState(path) {
  if (!existsSync(path)) return { exists: false, hash: null }
  return { exists: true, hash: sha256(readFileSync(path)) }
}
export function targetKey(rel) { return createHash('sha256').update(rel).digest('hex') }
export function modeOf(path) { try { return (statSync(path).mode & 0o777).toString(8).padStart(3, '0') } catch { return null } }
export function fingerprint(states) {
  const entries = Object.entries(states).sort(([a], [b]) => a.localeCompare(b))
  return sha256(Buffer.from(JSON.stringify(entries), 'utf8'))
}
