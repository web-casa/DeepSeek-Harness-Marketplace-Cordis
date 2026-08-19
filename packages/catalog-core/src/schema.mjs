// catalog-core 专用轻量 schema：与 docs/cordis-run-api-contract.md v4 对齐，
// 同时对桌面平铺旧格式和 page:u32 旧分页做兼容归一化。

const HASH_RE = /^sha(256|512)-[A-Za-z0-9+/=]+$/
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export class CatalogSchemaError extends Error {}

function isObject(x){ return x !== null && typeof x === 'object' && !Array.isArray(x) }

export function normalizeLocalized(value, fallback = '') {
  if (typeof value === 'string') return { zh: value, en: value }
  if (isObject(value)) return { zh: typeof value.zh === 'string' ? value.zh : fallback, en: typeof value.en === 'string' ? value.en : fallback }
  return { zh: fallback, en: fallback }
}

export function normalizeSource(item) {
  const source = isObject(item.source) ? item.source : null
  const flat = { packageName: item.npm ?? null, version: item.version ?? null, integrity: item.integrity ?? null }
  // Old flat fields are retained for display-only compatibility.  They do not
  // establish an install source: v4 mutations must have the complete nested
  // source evidence supplied by the catalog.
  const legacy = source === null
  return {
    type: source?.type ?? null,
    packageName: source?.packageName ?? (legacy ? flat.packageName : null),
    version: source?.version ?? (legacy ? flat.version : null),
    integrity: source?.integrity ?? (legacy ? flat.integrity : null),
    registry: source?.registry ?? (legacy ? item.registry ?? null : null),
    tarball: source?.tarball ?? (legacy ? item.tarball ?? null : null),
  }
}

export function normalizePage(body, perPage) {
  const page = body?.page
  if (Number.isInteger(page)) return { cursor: String(page), hasMore: false, limit: perPage ?? body?.per_page ?? 50 }
  if (isObject(page)) {
    const limit = Number.isInteger(page.limit) ? page.limit : Number.isInteger(page.per_page) ? page.per_page : perPage ?? 50
    const cursor = typeof page.cursor === 'string' ? page.cursor : (Number.isInteger(page.page) ? String(page.page) : null)
    return { cursor, hasMore: page.hasMore === true, limit }
  }
  return { cursor: null, hasMore: false, limit: perPage ?? 50 }
}

export function validateCatalog(body) {
  if (!isObject(body) || body.schemaVersion !== 1) throw new CatalogSchemaError('schemaVersion must be 1')
  if (typeof body.catalogRevision !== 'string') throw new CatalogSchemaError('catalogRevision required')
  if (!Array.isArray(body.items)) throw new CatalogSchemaError('items must be an array')
  const count = Number.isInteger(body.count) ? body.count : body.items.length
  const page = normalizePage(body, body.per_page)
  const categories = isObject(body.categories) ? body.categories : {}
  return { ...body, count, page, categories, items: body.items }
}

export function validateCatalogItem(item) {
  if (!isObject(item) || typeof item.slug !== 'string' || item.slug.length === 0) throw new CatalogSchemaError('item.slug required')
  const source = normalizeSource(item)
  return {
    slug: item.slug,
    name: typeof item.name === 'string' ? item.name : item.slug,
    description: normalizeLocalized(item.description, item.name ?? ''),
    category: typeof item.category === 'string' ? item.category : null,
    homepage: typeof item.homepage === 'string' ? item.homepage : null,
    platforms: Array.isArray(item.platforms) ? item.platforms.filter(x => typeof x === 'string') : ['unknown'],
    engines: isObject(item.engines) ? item.engines : {},
    stars: Number.isInteger(item.stars) ? item.stars : 0,
    blocked: item.blocked === true,
    deprecated: item.deprecated === true,
    replacementSlug: typeof item.replacementSlug === 'string' ? item.replacementSlug : null,
    entryRevision: typeof item.entryRevision === 'string' ? item.entryRevision : null,
    entryIds: Array.isArray(item.entryIds) ? item.entryIds.filter(x => typeof x === 'string') : [],
    installHint: typeof item.installHint === 'string' ? item.installHint : null,
    source,
  }
}

export function installability(item, platform = 'web') {
  const reasons = []
  const src = item?.source || {}
  if (src.type !== 'npm') reasons.push('non-npm-source')
  else {
    if (!src.packageName || !NPM_NAME_RE.test(src.packageName)) reasons.push('bad-package-name')
    if (typeof src.version !== 'string' || !/^\d+\.\d+\.\d+/.test(src.version)) reasons.push('bad-version')
    if (typeof src.integrity !== 'string' || !HASH_RE.test(src.integrity)) reasons.push('missing-integrity')
    if (!['https://registry.npmjs.org'].includes(src.registry)) reasons.push('registry-not-allowed')
    if (typeof src.tarball !== 'string' || src.tarball.length === 0) reasons.push('missing-tarball')
    else {
      try {
        const registry = new URL(src.registry)
        const tarball = new URL(src.tarball)
        if (tarball.protocol !== registry.protocol || tarball.hostname !== registry.hostname || tarball.port !== registry.port) reasons.push('tarball-origin-mismatch')
      }
      catch { reasons.push('bad-tarball-url') }
    }
  }
  const platforms = Array.isArray(item?.platforms) ? item.platforms : []
  if (!platforms.includes(platform)) reasons.push(`platform-${platforms.join('+')}`)
  if (item?.blocked) reasons.push('blocked')
  if (item?.deprecated) reasons.push('deprecated')
  if (typeof item?.entryRevision !== 'string' || item.entryRevision.length === 0) reasons.push('missing-entry-revision')
  if (typeof item?.engines?.dsh !== 'string' || !item.engines.dsh.startsWith('>=')) reasons.push('bad-engines-dsh')
  return { installable: reasons.length === 0, reasons, reason: reasons.join(',') }
}
