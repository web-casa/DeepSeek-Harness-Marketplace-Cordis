// DshActivationPort：用户补丁层 cordis.patch.yml 的禁用/启用读写。
// 行级文本操作，避免 YAML 重排破坏注释与 !!js 表达式。
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const ROW_ID_RE = /^[A-Za-z0-9_.-]+$/

export class DshActivationPort {
  constructor({ patchPath }) { this.patchPath = patchPath; this.owned = new Set() }
  get ownedDisables() { return [...this.owned] }
  #text() { try { return readFileSync(this.patchPath, 'utf8') } catch { return '[]\n' } }
  #save(text) {
    const dir = dirname(this.patchPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = join(dir, `.cordis.patch.${randomBytes(6).toString('hex')}`)
    const fd = openSync(tmp, 'wx', 0o600)
    try { writeFileSync(fd, text) } finally { closeSync(fd) }
    const r = openSync(tmp, 'r'); try { fsyncSync(r) } finally { closeSync(r) }
    renameSync(tmp, this.patchPath)
    const d = openSync(dir, 'r'); try { fsyncSync(d) } finally { closeSync(d) }
  }
  readState() {
    const lines = this.#text().split(/\r?\n/)
    const disables = []; const forced = []; const inserts = []
    let inInsert = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (/^- insert:\s*$/.test(line)) { inInsert = true; continue }
      if (/^- /.test(line)) inInsert = false
      if (inInsert) {
        const m = /^ {4}- id: ([A-Za-z0-9_.-]+)/.exec(line)
        if (m) inserts.push(m[1])
        continue
      }
      const row = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(line)
      if (!row) continue
      const next = lines[i + 1] ?? ''
      if (/^ {2}disabled: true\s*$/.test(next)) disables.push(row[1])
      else if (/^ {2}disabled: false\s*$/.test(next)) forced.push(row[1])
    }
    return { disables, forced, inserts }
  }
  preDisable(entryIds) {
    const ids = [...new Set(entryIds)].filter(id => ROW_ID_RE.test(id))
    if (ids.length === 0) return 0
    let text = this.#text().replace(/\n?$/, '\n')
    const lines = text.split('\n')
    const emptyIdx = lines.findIndex(l => /^\s*\[\]\s*$/.test(l))
    if (emptyIdx !== -1) lines.splice(emptyIdx, 1)
    let changed = 0
    for (const id of ids) {
      let found = false
      for (let i = 0; i < lines.length - 1; i++) {
        const m = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(lines[i])
        if (!m || m[1] !== id) continue
        found = true
        if (/^ {2}disabled: true\s*$/.test(lines[i + 1] ?? '')) break
        if (/^ {2}disabled: false\s*$/.test(lines[i + 1] ?? '')) { lines[i + 1] = '  disabled: true'; changed++; this.owned.add(id) }
        break
      }
      if (!found) { lines.push(`- id: ${id}`, '  disabled: true'); changed++; this.owned.add(id) }
    }
    if (changed > 0) this.#save(lines.join('\n'))
    return changed
  }
  activate(entryIds, { ownedOnly = false, ownedSet = null } = {}) {
    let ids = new Set(entryIds.filter(id => ROW_ID_RE.test(id)))
    if (ownedOnly) ids = new Set([...ids].filter(id => this.owned.has(id)))
    if (Array.isArray(ownedSet)) ids = new Set([...ids].filter(id => ownedSet.includes(id)))
    if (ids.size === 0) return 0
    const lines = this.#text().split('\n')
    const out = []
    let removed = 0
    for (let i = 0; i < lines.length; i++) {
      const m = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(lines[i])
      if (m && ids.has(m[1]) && /^ {2}disabled: true\s*$/.test(lines[i + 1] ?? '')) { i++; removed++; this.owned.delete(m[1]); continue }
      out.push(lines[i])
    }
    if (removed > 0) {
      const hasRows = out.some(l => /^\s*- /.test(l))
      if (!hasRows) {
        let idx = 0
        while (idx < out.length && (out[idx].trim() === '' || out[idx].trim().startsWith('#'))) idx++
        out.splice(idx, 0, '[]')
      }
      this.#save(out.join('\n'))
    }
    return removed
  }
  async prepareDisable({ artifact }) { return { entryIds: artifact?.entryIds || [] } }
  async cancelDisable(entryIds) { return this.activate(entryIds, { ownedOnly: true }) }
}
