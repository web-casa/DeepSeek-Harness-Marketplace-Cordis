import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from 'tar'

export class InspectError extends Error { constructor(code, message){ super(message); this.code=code } }

const ID_RE = /^[A-Za-z0-9_.-]+$/
const BAD_TAR_PATH = /(^|\/)\.\.(\/|$)|^\/|\\/

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
  const bundlePatch = declaredBundlePatch(pkg)
  if (bundlePatch) { try { patch = readFileSync(join(dir, bundlePatch), 'utf8') } catch {} }
  return normalizeInspect(pkg, patch, bundlePatch)
}

export async function inspectTarball(file, { maxEntryBytes = 4 * 1024 * 1024, maxEntries = 4096 } = {}) {
  const manifestPath = 'package/package.json'
  const manifestEntries = await readTarEntries(file, new Set([manifestPath]), { maxEntryBytes, maxEntries })
  const pkgText = manifestEntries.get(manifestPath)
  if (!pkgText) throw new InspectError('BAD_MANIFEST', 'package/package.json not found in tarball')
  let pkg
  try { pkg = JSON.parse(pkgText) } catch { throw new InspectError('BAD_MANIFEST', 'package.json is invalid JSON') }
  const bundlePatch = declaredBundlePatch(pkg)
  let patchText = null
  if (bundlePatch) {
    const patchPath = `package/${bundlePatch}`
    patchText = (await readTarEntries(file, new Set([patchPath]), { maxEntryBytes, maxEntries })).get(patchPath) || null
  }
  return normalizeInspect(pkg, patchText, bundlePatch)
}

function declaredBundlePatch(pkg) {
  const declared = pkg?.dsh?.bundle?.patch
  if (declared === undefined || declared === null) return null
  if (typeof declared !== 'string') throw new InspectError('BAD_BUNDLE_PATCH', 'dsh.bundle.patch must be a relative file path')
  const segments = declared.trim().split('/')
  if (segments[0] === '.') segments.shift()
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    throw new InspectError('BAD_BUNDLE_PATCH', 'dsh.bundle.patch must be a safe relative file path')
  }
  const path = segments.join('/')
  if (Buffer.byteLength(path) > 1024) throw new InspectError('BAD_BUNDLE_PATCH', 'dsh.bundle.patch is too long')
  return path
}

async function readTarEntries(file, wantedPaths, { maxEntryBytes, maxEntries }) {
  const texts = new Map()
  const seen = new Set()
  let entries = 0
  let fail = null
  await t({
    file,
    onReadEntry(entry) {
      if (fail) { entry.resume(); return }
      try {
        entries++
        if (entries > maxEntries) throw new InspectError('TOO_MANY_ENTRIES', 'tar has too many entries')
        if (BAD_TAR_PATH.test(entry.path)) throw new InspectError('BAD_PATH', 'unsafe tar path: ' + entry.path)
        const size = Number(entry.size || 0)
        if (size > maxEntryBytes) throw new InspectError('ENTRY_TOO_LARGE', 'tar entry too large: ' + entry.path)
        if (!wantedPaths.has(entry.path)) return
        if (seen.has(entry.path)) throw new InspectError('DUPLICATE_ENTRY', 'duplicate tar entry: ' + entry.path)
        seen.add(entry.path)
      } catch (e) { fail = e; entry.resume(); return }
      const chunks = []
      let bytes = 0
      entry.on('data', c => {
        if (fail) return
        bytes += c.length
        chunks.push(c)
        if (bytes > maxEntryBytes) fail = new InspectError('ENTRY_TOO_LARGE', 'entry exceeded limit while reading')
      })
      entry.on('end', () => {
        if (fail) return
        texts.set(entry.path, Buffer.concat(chunks).toString('utf8'))
      })
    },
  })
  if (fail) throw fail
  return texts
}

function normalizeInspect(pkg, patchText, bundlePatch) {
  const dsh = pkg.dsh || {}
  const platforms = Array.isArray(dsh.platforms) ? dsh.platforms : ['unknown']
  const hasBundlePatch = bundlePatch !== null && patchText !== null
  const hasClient = dsh.client !== undefined
  return {
    packageName: typeof pkg.name === 'string' ? pkg.name : null,
    version: typeof pkg.version === 'string' ? pkg.version : null,
    entryIds: patchText ? parsePatchIds(patchText) : [],
    platforms,
    hasBundlePatch,
    hasClient,
    bundlePatch,
    patch: patchText,
  }
}
