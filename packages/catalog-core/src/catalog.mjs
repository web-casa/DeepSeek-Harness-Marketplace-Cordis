// cordis.run CatalogClient：列表/详情/ETag 缓存/快照兜底/fresh 复核。
import { CatalogSchemaError, installability, normalizeLocalized, validateCatalog, validateCatalogItem } from './schema.mjs'

export class CatalogError extends Error {
  constructor(code, message, { status = 0, requestId = null, retryAfter = null } = {}) {
    super(message); this.code = code; this.status = status; this.requestId = requestId; this.retryAfter = retryAfter
  }
}

const DEFAULT_BASE = 'https://cordis.run/api/v1'

function boundedPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(100, parsed) : fallback
}

function isContractScreenshot(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'cdn.cordis.run'
  } catch { return false }
}

export class CatalogClient {
  constructor({ baseUrl = DEFAULT_BASE, fetchImpl = fetch, snapshot = null, cacheTtlMs = 60_000, staleIfErrorMs = 24 * 60 * 60 * 1000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
    this.snapshot = snapshot ? validateCatalog(snapshot) : null
    this.cacheTtlMs = cacheTtlMs
    this.staleIfErrorMs = staleIfErrorMs
    this.cache = new Map()
  }

  #cacheKey(path) { return `${this.baseUrl}${path}` }
  #cached(key) {
    const hit = this.cache.get(key)
    if (!hit) return null
    if (Date.now() - hit.at > this.cacheTtlMs && Date.now() - hit.at > this.staleIfErrorMs) return null
    return hit
  }

  async #request(path, { fresh = false, catalog = true } = {}) {
    const key = this.#cacheKey(path)
    const hit = this.cache.get(key)
    const headers = { accept: 'application/json' }
    if (fresh) headers['cache-control'] = 'no-cache'
    else if (hit?.etag) headers['if-none-match'] = hit.etag
    let res
    try {
      res = await this.fetchImpl(key, { method: 'GET', headers, redirect: 'error' })
    } catch (e) {
      if (fresh) throw new CatalogError('NETWORK', 'fresh catalog request failed')
      const stale = this.#cached(key)
      if (stale) return { ...stale, source: 'stale-cache' }
      if (this.snapshot) return { source: 'snapshot', ...this.#snapshotFor(path) }
      throw new CatalogError('NETWORK', `catalog request failed: ${e.message}`)
    }
    if (res.status === 304) {
      // A fresh review deliberately does not send an ETag.  Accepting a 304
      // here would turn a cache entry into authorization for an install or
      // activation decision, so fail closed even if a broken intermediary
      // emits one.
      if (fresh) throw new CatalogError('NO_FRESH_RESPONSE', 'server returned 304 for a fresh catalog request', { status: 304 })
      const cached = hit
      if (cached) return { ...cached, source: 'cache' }
      throw new CatalogError('NO_CACHE', 'server returned 304 but no cache entry exists', { status: 304 })
    }
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch {
      throw new CatalogError('BAD_JSON', 'catalog response was not JSON', { status: res.status })
    }
    if (!res.ok) {
      const e = body?.error || {}
      throw new CatalogError(e.code || 'HTTP_ERROR', e.message || `HTTP ${res.status}`, { status: res.status, requestId: e.requestId, retryAfter: e.retryAfter })
    }
    let normalizedBody = body
    if (catalog) normalizedBody = validateCatalog(body)
    const entry = { data: normalizedBody, etag: res.headers?.get?.('etag') || null, at: Date.now(), source: 'network' }
    this.cache.set(key, entry)
    return entry
  }

  #snapshotFor(path) {
    const url = new URL(path, 'http://x')
    const q = url.searchParams
    let items = (this.snapshot.items || []).map(validateCatalogItem)
    const platform = q.get('platform'); if (platform) items = items.filter(i => i.platforms.includes(platform))
    const term = (q.get('q') || '').toLowerCase(); if (term) items = items.filter(i => i.slug.toLowerCase().includes(term) || i.name.toLowerCase().includes(term))
    const page = boundedPositiveInt(q.get('page') || q.get('cursor') || '1', 1)
    const perPage = boundedPositiveInt(q.get('per_page') || q.get('limit') || '50', 50)
    const start = (page - 1) * perPage
    return { data: { ...this.snapshot, count: items.length, page: { cursor: String(page), hasMore: start + perPage < items.length, limit: perPage }, items: items.slice(start, start + perPage) } }
  }

  async list(options = {}) {
    const qs = new URLSearchParams()
    for (const k of ['q','category','platform','sort','order']) if (options[k] !== undefined && options[k] !== null && options[k] !== '') qs.set(k, options[k])
    if (options.page !== undefined && options.page !== null) qs.set('page', String(options.page))
    if (options.perPage !== undefined && options.perPage !== null) qs.set('per_page', String(options.perPage))
    if (options.cursor !== undefined && options.cursor !== null && options.cursor !== '') qs.set('cursor', String(options.cursor))
    if (options.limit !== undefined && options.limit !== null) qs.set('limit', String(options.limit))
    const res = await this.#request(`/plugins?${qs}`)
    return { source: res.source, catalogRevision: res.data.catalogRevision, count: res.data.count, page: res.data.page, categories: res.data.categories, items: res.data.items.map(validateCatalogItem) }
  }

  async detail(slug, { fresh = false } = {}) {
    if (typeof slug !== 'string' || !slug) throw new CatalogError('BAD_SLUG', 'slug is required')
    const res = await this.#request(`/plugins/${encodeURIComponent(slug)}`, { fresh, catalog: false })
    const item = Array.isArray(res.data.items) ? res.data.items.find(i => i.slug === slug) : res.data
    if (!item) throw new CatalogError('BAD_DETAIL', 'detail response has no matching item')
    const normalized = validateCatalogItem(item)
    return {
      ...normalized,
      source: normalized.source,
      catalogRevision: res.data.catalogRevision ?? null,
      versions: Array.isArray(res.data.versions) ? res.data.versions : [],
      screenshots: Array.isArray(res.data.screenshots) ? res.data.screenshots.filter(isContractScreenshot) : [],
    }
  }

  async fetchFresh(slug) { return this.detail(slug, { fresh: true }) }

  installability(item, platform = 'web') { return installability(item, platform) }
}

export { installability, normalizeLocalized }
