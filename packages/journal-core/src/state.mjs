import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'

export const sha256 = data => 'sha256:' + createHash('sha256').update(data).digest('hex')
export function fileState(path) {
  if (!existsSync(path)) return { exists: false, hash: null }
  return { exists: true, hash: sha256(readFileSync(path)) }
}
export function targetKey(rel) { return createHash('sha256').update(rel).digest('hex') }
export function modeOf(path) { try { return (statSync(path).mode & 0o777).toString(8).padStart(3, '0') } catch { return null } }

// canonicalJson：键按字典序、无空白；fingerprint 输入必须是 object 而不是数组
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
}
export function fingerprint(states) {
  return sha256(Buffer.from(canonicalJson(states), 'utf8'))
}
