// Non-mutating deployment gate for docs/cordis-run-api-contract.md v4.
// Usage: CORDIS_RUN_API=https://cordis.run/api/v1 node scripts/cordis-run-contract-probe.mjs

const base = process.env.CORDIS_RUN_API?.replace(/\/+$/, '')
const timeoutMs = Number(process.env.CORDIS_RUN_PROBE_TIMEOUT_MS || 15_000)

function assert(condition, message) { if (!condition) throw new Error(message) }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

async function request(path, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'GET', redirect: 'error', headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) }
    catch { throw new Error(`${path} returned non-JSON body (HTTP ${response.status}, content-type ${response.headers.get('content-type') || 'missing'})`) }
  }
  return { response, body }
}

function assertEntry(item, label) {
  assert(isObject(item), `${label} must be an object`)
  assert(typeof item.slug === 'string' && item.slug.length > 0, `${label}.slug is required`)
  assert(isObject(item.description) && typeof item.description.zh === 'string' && typeof item.description.en === 'string', `${label}.description must be {zh,en}`)
  assert(isObject(item.source), `${label}.source is required`)
  assert(item.source.type === 'npm', `${label}.source.type must be npm`)
  assert(typeof item.source.packageName === 'string' && typeof item.source.version === 'string', `${label}.source packageName/version are required`)
  assert(typeof item.source.integrity === 'string' && item.source.integrity.startsWith('sha512-'), `${label}.source.integrity must be sha512`)
  const registry = new URL(item.source.registry)
  const tarball = new URL(item.source.tarball)
  assert(registry.protocol === 'https:' && tarball.protocol === 'https:' && registry.hostname === tarball.hostname, `${label}.source registry/tarball host policy failed`)
  assert(Array.isArray(item.platforms) && item.platforms.length > 0, `${label}.platforms is required`)
}

function assertList(body, label) {
  assert(isObject(body) && body.schemaVersion === 1, `${label}.schemaVersion must be 1`)
  assert(typeof body.catalogRevision === 'string', `${label}.catalogRevision is required`)
  assert(Number.isInteger(body.count) && body.count >= 0, `${label}.count must be a non-negative integer`)
  assert(isObject(body.page) && typeof body.page.hasMore === 'boolean' && Number.isInteger(body.page.limit), `${label}.page must contain cursor/hasMore/limit`)
  assert(body.page.cursor === null || typeof body.page.cursor === 'string', `${label}.page.cursor must be string|null`)
  assert(isObject(body.categories), `${label}.categories must be an object`)
  assert(Array.isArray(body.items), `${label}.items must be an array`)
  for (const item of body.items) assertEntry(item, `${label}.items[]`)
}

async function checkedList(query) {
  const path = `/plugins?${new URLSearchParams(query)}`
  const result = await request(path)
  assert(result.response.status === 200, `${path} returned HTTP ${result.response.status}`)
  assert((result.response.headers.get('content-type') || '').includes('application/json'), `${path} did not declare JSON`)
  assertList(result.body, path)
  return { path, ...result }
}

async function run() {
  assert(base, 'CORDIS_RUN_API is required; refusing to guess a deployment target')
  const all = await checkedList({ limit: '1' })
  await checkedList({ platform: 'web', limit: '1' })
  await checkedList({ platform: 'desktop', limit: '1' })
  const etag = all.response.headers.get('etag')
  assert(etag, 'list response is missing ETag')
  const cached = await fetch(`${base}${all.path}`, { method: 'GET', redirect: 'error', headers: { accept: 'application/json', 'if-none-match': etag }, signal: AbortSignal.timeout(timeoutMs) })
  assert(cached.status === 304, `conditional list request returned HTTP ${cached.status}, expected 304`)

  if (all.body.page.hasMore) {
    assert(typeof all.body.page.cursor === 'string' && all.body.page.cursor.length > 0, 'hasMore=true requires a usable cursor')
    await checkedList({ cursor: all.body.page.cursor, limit: String(all.body.page.limit) })
  }

  const slug = process.env.CORDIS_RUN_PROBE_SLUG || all.body.items[0]?.slug
  assert(slug, 'list is empty; set CORDIS_RUN_PROBE_SLUG to a known public item')
  const detail = await request(`/plugins/${encodeURIComponent(slug)}`)
  assert(detail.response.status === 200, `detail ${slug} returned HTTP ${detail.response.status}`)
  assert((detail.response.headers.get('content-type') || '').includes('application/json'), 'detail did not declare JSON')
  assertEntry(detail.body, 'detail')
  assert(Array.isArray(detail.body.screenshots) && detail.body.screenshots.every(url => /^https:\/\/cdn\.cordis\.run\//.test(url)), 'detail screenshots must use https://cdn.cordis.run/')
  assert(Array.isArray(detail.body.versions), 'detail.versions must be an array')

  const missing = await request('/plugins/__cordis_mp_contract_missing__')
  assert(missing.response.status === 404 && isObject(missing.body?.error) && typeof missing.body.error.code === 'string' && typeof missing.body.error.message === 'string', 'missing detail must return JSON {error:{code,message}} with HTTP 404')
  console.log(JSON.stringify({ ok: true, base, slug, etag, count: all.body.count }))
}

run().catch(error => { console.error(`cordis.run contract probe failed: ${error.message}`); process.exitCode = 1 })
