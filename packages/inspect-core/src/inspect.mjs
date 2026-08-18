import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from 'tar'

export class InspectError extends Error { constructor(code, message){ super(message); this.code=code } }

const ID_RE = /^[A-Za-z0-9_.-]+$/

export function parsePatchIds(text) {
  const ids = []
  const seen = new Set()
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*- id: ([A-Za-z0-9_.-]+)\s*$/.exec(line)
    if (m && !seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]) }
  }
  return ids
}

export function inspectDir(dir) {
  let pkg, patch = null
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { throw new InspectError('BAD_MANIFEST', 'package.json missing or invalid') }
  try { patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8') } catch {}
  const dsh = pkg.dsh || {}
  return normalizeInspect(pkg, patch)
}

export async function inspectTarball(file, { maxEntryBytes = 4 * 1024 * 1024, maxEntries = 4096 } = {}) {
  let pkgText = null, patchText = null, entries = 0, fail = null
  const badPath = /(^|\/)\.\.(\/|$)|^\/|\\/
  await t({
    file,
    onReadEntry(entry) {
      if (fail) return
      try {
        entries++
        if (entries > maxEntries) { fail = new InspectError('TOO_MANY_ENTRIES', 'tar has too many entries'); return }
        if (badPath.test(entry.path)) { fail = new InspectError('BAD_PATH', 'unsafe tar path: ' + entry.path); return }
        const size = Number(entry.size || 0)
        if (size > maxEntryBytes) { fail = new InspectError('ENTRY_TOO_LARGE', 'tar entry too large: ' + entry.path); return }
      } catch (e) { fail = e; return }
      const wanted = entry.path === 'package/package.json' || entry.path === 'package/cordis.patch.yml'
      if (!wanted) return
      const chunks = []
      entry.on('data', c => {
        if (fail) return
        chunks.push(c)
        if (chunks.reduce((n, b) => n + b.length, 0) > maxEntryBytes) fail = new InspectError('ENTRY_TOO_LARGE', 'entry exceeded limit while reading')
      })
      entry.on('end', () => {
        if (fail) return
        const text = Buffer.concat(chunks).toString('utf8')
        if (entry.path === 'package/package.json') pkgText = text
        else patchText = text
      })
    },
  })
  if (fail) throw fail
  if (!pkgText) throw new InspectError('BAD_MANIFEST', 'package/package.json not found in tarball')
  let pkg
  try { pkg = JSON.parse(pkgText) } catch { throw new InspectError('BAD_MANIFEST', 'package.json is invalid JSON') }
  return normalizeInspect(pkg, patchText)
}

function normalizeInspect(pkg, patchText) {
  const dsh = pkg.dsh || {}
  const platforms = Array.isArray(dsh.platforms) ? dsh.platforms : ['unknown']
  const hasBundlePatch = typeof dsh.bundle?.patch === 'string'
  const hasClient = dsh.client !== undefined
  return {
    packageName: typeof pkg.name === 'string' ? pkg.name : null,
    version: typeof pkg.version === 'string' ? pkg.version : null,
    entryIds: patchText ? parsePatchIds(patchText) : [],
    platforms,
    hasBundlePatch,
    hasClient,
    patch: patchText,
  }
}
