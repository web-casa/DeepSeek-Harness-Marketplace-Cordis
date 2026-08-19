import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileLock, Journal } from '@cordis-mp/journal-core'
import { installability } from '@cordis-mp/catalog-core'
import { InstallService } from '../src/index.js'

function setup({ blocked = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'install-'))
  const profile = join(base, 'profile'); const journalRoot = join(base, 'meta')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{"old":true}')
  const fresh = {
    slug: 'p', name: 'p', entryRevision: 'rev-1',
    description: { zh: 'P', en: 'P' }, category: 'c', homepage: null,
    platforms: ['web'], engines: { dsh: '>=0.1.0-rc.6 <0.2.0' }, stars: 0,
    blocked, deprecated: false, replacementSlug: null, installHint: null,
    source: { type: 'npm', packageName: 'p', version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: 'https://registry.npmjs.org/p/-/p-1.0.0.tgz' },
    versions: [], screenshots: [],
  }
  const catalog = {
    async fetchFresh() { return fresh },
    installability: item => installability(item, 'web'),
  }
  const newPkg = Buffer.from('{"new":true}')
  const packageManager = {
    async installVerifiedArtifact(artifact) { this.artifact = artifact; writeFileSync(join(profile, 'package.json'), newPkg); return { exitCode: 0, stderr: '', profileFiles: { 'package.json': newPkg } } },
    async verifyInstalled() { return true },
    async remove() { writeFileSync(join(profile, 'package.json'), '{}'); return { exitCode: 0, profileFiles: { 'package.json': Buffer.from('{}') } } },
  }
  const lock = new FileLock(journalRoot)
  const journal = new Journal({ journalRoot, profileRoot: profile, lock })
  const pendingPath = join(profile, '.cordis-mp')
  const inspect = {
    async inspectArtifact(artifact) {
      return { packageName: artifact.packageName, version: artifact.version, hasBundlePatch: true, entryIds: ['p'] }
    },
  }
  const service = new InstallService({ catalog, journal, packageManager, inspect, pendingPath, lock })
  return { base, profile, journalRoot, lock, journal, service, catalog, packageManager, fresh, inspect, pendingPath }
}

test('successful install commits profile file transaction', async () => {
  const c = setup()
  const out = await c.service.install({ slug: 'p', platform: 'web', confirmation: { entryRevision: 'rev-1' } })
  assert.equal(out.status, 'COMMITTED')
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"new":true}')
  assert.ok(c.packageManager.artifact.integrity.startsWith('sha512-'))
})

test('install holds the profile lock through package mutation and releases it', async () => {
  const c = setup()
  c.packageManager.installVerifiedArtifact = async artifact => {
    assert.throws(() => new FileLock(c.journalRoot).acquire('mutation'), e => e?.code === 'LOCK_BUSY')
    writeFileSync(join(c.profile, 'package.json'), '{"new":true}')
    return { exitCode: 0, stderr: '', profileFiles: { 'package.json': Buffer.from('{"new":true}') } }
  }
  await c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  const next = new FileLock(c.journalRoot)
  next.acquire('mutation')
  next.release()
})

test('a busy profile lock is reported without starting a package mutation', async () => {
  const c = setup()
  const external = new FileLock(c.journalRoot)
  external.acquire('recovery')
  let called = false
  c.packageManager.installVerifiedArtifact = async () => { called = true; return { exitCode: 0, profileFiles: {} } }
  try {
    await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'MUTATION_BUSY')
  } finally {
    external.release()
  }
  assert.equal(called, false)
})

test('InstallService refuses a missing or mismatched profile lock', () => {
  const c = setup()
  assert.throws(() => new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, pendingPath: c.pendingPath }), /requires a profile FileLock/)
  assert.throws(() => new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, pendingPath: c.pendingPath, lock: new FileLock(c.journalRoot) }), /must share the profile FileLock/)
  assert.throws(() => new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, pendingPath: c.pendingPath, lock: c.lock }), /requires an integrity artifact inspector/)
  assert.throws(() => new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, lock: c.lock }), /requires a durable pending activation path/)
  assert.throws(() => new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, pendingPath: c.profile, lock: c.lock }), /must be the profile .cordis-mp directory/)
})

test('stale confirmation is rejected before package manager runs', async () => {
  const c = setup()
  let called = false
  c.packageManager.installVerifiedArtifact = async () => { called = true }
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'old' } }), e => e.code === 'STALE_CONFIRMATION')
  assert.equal(called, false)
})

test('missing confirmation is rejected before the fresh catalog lookup', async () => {
  const c = setup()
  let fetched = false
  c.catalog.fetchFresh = async () => { fetched = true; throw new Error('must not fetch') }
  await assert.rejects(() => c.service.install({ slug: 'p' }), e => e.code === 'CONFIRMATION_REQUIRED')
  assert.equal(fetched, false)
})

test('unreachable fresh catalog fails closed before inspection or mutation', async () => {
  const c = setup()
  let inspected = false
  let installed = false
  c.catalog.fetchFresh = async () => { throw new Error('offline') }
  c.inspect.inspectArtifact = async () => { inspected = true; throw new Error('must not inspect') }
  c.packageManager.installVerifiedArtifact = async () => { installed = true; return { exitCode: 0, profileFiles: {} } }
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'CATALOG_RECHECK_FAILED')
  assert.equal(inspected, false)
  assert.equal(installed, false)
})

test('artifact inspection failures are fail-closed install diagnostics', async () => {
  const c = setup()
  let installed = false
  c.inspect.inspectArtifact = async () => { throw Object.assign(new Error('integrity mismatch'), { code: 'INTEGRITY_MISMATCH' }) }
  c.packageManager.installVerifiedArtifact = async () => { installed = true; return { exitCode: 0, profileFiles: {} } }
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'INSPECT_FAILED' && /INTEGRITY_MISMATCH/.test(e.message))
  assert.equal(installed, false)
})

test('inspection identity mismatch is cleaned and rejects before journal or package mutation', async () => {
  const c = setup()
  let cleaned = false
  let journalStarted = false
  let installed = false
  c.inspect.inspectArtifact = async () => ({ packageName: 'other', version: '1.0.0', hasBundlePatch: true, entryIds: ['p'], stagedPath: '/tmp/mismatch-artifact' })
  c.inspect.cleanup = path => { assert.equal(path, '/tmp/mismatch-artifact'); cleaned = true }
  c.journal.begin = async () => { journalStarted = true; throw new Error('journal must not start') }
  c.packageManager.installVerifiedArtifact = async () => { installed = true; return { exitCode: 0, profileFiles: {} } }
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'INSPECT_MISMATCH')
  assert.equal(cleaned, true)
  assert.equal(journalStarted, false)
  assert.equal(installed, false)
})

test('blocked entry is not installable', async () => {
  const c = setup({ blocked: true })
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'NOT_INSTALLABLE' && /blocked/.test(e.message))
})

test('marketplace host rejects its own package before inspect, pre-disable, journal, or package mutation', async () => {
  const c = setup()
  let inspected = false
  let journalStarted = false
  let prepared = false
  let disabled = false
  let installed = false
  const activation = {
    async prepareDisable() { prepared = true; return { entryIds: ['p'] } },
    async preDisable() { disabled = true },
    async cancelDisable() {},
    async activate() {},
  }
  const inspect = { async inspectArtifact() { inspected = true; return { packageName: 'p', version: '1.0.0', hasBundlePatch: true, entryIds: ['p'] } } }
  c.journal.begin = async () => { journalStarted = true; throw new Error('journal must not start') }
  const service = new InstallService({
    catalog: c.catalog,
    journal: c.journal,
    packageManager: {
      ...c.packageManager,
      async installVerifiedArtifact() { installed = true; return { exitCode: 0, profileFiles: {} } },
    },
    activation,
    inspect,
    pendingPath: c.pendingPath,
    lock: c.lock,
    selfPackageName: 'p',
  })

  await assert.rejects(
    () => service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }),
    error => error.code === 'SELF_INSTALL_FORBIDDEN',
  )
  assert.equal(inspected, false)
  assert.equal(journalStarted, false)
  assert.equal(prepared, false)
  assert.equal(disabled, false)
  assert.equal(installed, false)
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"old":true}')
})

test('a foreign bundle cannot pre-disable the marketplace host entry and its staged artifact is cleaned', async () => {
  const c = setup()
  c.fresh.source.packageName = 'foreign-package'
  let inspected = false
  let cleaned = false
  let journalStarted = false
  let prepared = false
  let disabled = false
  let installed = false
  c.journal.begin = async () => { journalStarted = true; throw new Error('journal must not start') }
  const activation = {
    async prepareDisable() { prepared = true; return { entryIds: ['cordis-mp'] } },
    async preDisable() { disabled = true },
    async cancelDisable() {},
    async activate() {},
  }
  const inspect = {
    async inspectArtifact() { inspected = true; return { packageName: 'foreign-package', version: '1.0.0', hasBundlePatch: true, entryIds: ['cordis-mp'], stagedPath: '/tmp/foreign-artifact' } },
    cleanup(path) { assert.equal(path, '/tmp/foreign-artifact'); cleaned = true },
  }
  const service = new InstallService({
    catalog: c.catalog,
    journal: c.journal,
    packageManager: {
      ...c.packageManager,
      async installVerifiedArtifact() { installed = true; return { exitCode: 0, profileFiles: {} } },
    },
    activation,
    inspect,
    pendingPath: c.pendingPath,
    lock: c.lock,
    selfPackageName: '@webcasa/web',
    selfEntryIds: ['cordis-mp'],
  })

  await assert.rejects(
    () => service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }),
    error => error.code === 'HOST_ENTRY_CONFLICT',
  )
  assert.equal(inspected, true)
  assert.equal(cleaned, true)
  assert.equal(journalStarted, false)
  assert.equal(prepared, false)
  assert.equal(disabled, false)
  assert.equal(installed, false)
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"old":true}')
})

test('package manager failure leaves profile unchanged', async () => {
  const c = setup()
  c.packageManager.installVerifiedArtifact = async () => ({ exitCode: 1, stderr: 'boom' })
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'INSTALL_FAILED')
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"old":true}')
})

test('verify failure rolls back written profile files', async () => {
  const c = setup()
  c.packageManager.verifyInstalled = async () => false
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'VERIFY_FAILED')
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"old":true}')
})

test('pending activation is written in the install transaction, not a second transaction', async () => {
  const c = setup()
  let began = 0
  const begin = c.journal.begin.bind(c.journal)
  c.journal.begin = async targets => { began++; return begin(targets) }
  await c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  assert.equal(began, 1)
  const pending = JSON.parse(readFileSync(join(c.pendingPath, 'pending-activation.json'), 'utf8'))
  assert.equal(pending.v, 1)
  assert.equal(pending.items.length, 1)
  assert.equal(pending.items[0].slug, 'p')
})

test('M2b: pre-disable happens before install; activation is pending', async () => {
  const c = setup()
  const order = []
  c.packageManager.installVerifiedArtifact = async () => { order.push('install'); writeFileSync(join(c.profile, 'package.json'), '{"new":true}'); return { exitCode: 0, profileFiles: { 'package.json': Buffer.from('{"new":true}') } } }
  const activation = {
    async prepareDisable() { order.push('prepare'); return { entryIds: ['entry-1'] } },
    async preDisable() { order.push('pre-disable') },
    async cancelDisable() { order.push('cancel') },
    async activate() { order.push('activate'); return { status: 'ACTIVE' } },
  }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  const out = await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  assert.equal(out.pendingActivation, true)
  assert.deepEqual(order.slice(0, 3), ['prepare', 'pre-disable', 'install'])
  const act = await svc.activate({ slug: 'p' })
  assert.equal(act.status, 'ACTIVE')
  assert.equal(order.includes('activate'), true)
})

test('M2b: failed install cancels pre-disable', async () => {
  const c = setup()
  c.packageManager.installVerifiedArtifact = async () => ({ exitCode: 1, stderr: 'boom' })
  let cancelled = false
  const activation = {
    async prepareDisable() { return { entryIds: ['entry-1'] } },
    async preDisable() {},
    async cancelDisable() { cancelled = true },
    async activate() {},
  }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  await assert.rejects(() => svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'INSTALL_FAILED')
  assert.equal(cancelled, true)
})

test('activate without pending is rejected', async () => {
  const c = setup()
  await assert.rejects(() => c.service.activate({ slug: 'nope' }), e => e.code === 'NO_PENDING_ACTIVATION')
})

test('R1: inspect provides entryIds to pre-disable', async () => {
  const c = setup()
  let seen
  const activation = {
    async prepareDisable({ artifact }) { seen = artifact.entryIds; return { entryIds: artifact.entryIds } },
    async preDisable() {}, async cancelDisable() {}, async activate() {},
  }
  const inspect = { async inspectArtifact() { return { packageName: 'p', version: '1.0.0', hasBundlePatch: true, entryIds: ['inspect-entry'] } } }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect, pendingPath: c.pendingPath, lock: c.lock })
  await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  assert.deepEqual(seen, ['inspect-entry'])
})

test('R1: only inspected entryIds can pre-disable the user patch layer', async () => {
  const c = setup()
  c.fresh.entryIds = ['catalog-only']
  let seen
  const activation = {
    async prepareDisable({ artifact }) { seen = artifact.entryIds; return { entryIds: artifact.entryIds } },
    async preDisable() { throw new Error('no inspected ids means no pre-disable write') },
    async cancelDisable() {}, async activate() {},
  }
  c.inspect.inspectArtifact = async artifact => ({ packageName: artifact.packageName, version: artifact.version, hasBundlePatch: true, entryIds: [] })
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  const out = await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  assert.deepEqual(seen, [])
  assert.deepEqual(out.pending.entryIds, [])
})

test('activate fails closed when the fresh catalog now blocks the pending artifact', async () => {
  const c = setup()
  let activated = false
  const activation = {
    async prepareDisable() { return { entryIds: ['p'] } }, async preDisable() {}, async cancelDisable() {},
    async activate() { activated = true },
  }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  c.fresh.blocked = true
  await assert.rejects(() => svc.activate({ slug: 'p' }), e => e.code === 'NOT_INSTALLABLE' && /blocked/.test(e.message))
  assert.equal(activated, false)
  assert.equal(svc.pendingStatus().length, 1)
})

test('activate rechecks revision and installed lockfile proof before enabling', async () => {
  const c = setup()
  let activated = false
  const activation = {
    async prepareDisable() { return { entryIds: ['p'] } }, async preDisable() {}, async cancelDisable() {},
    async activate() { activated = true },
  }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  c.fresh.entryRevision = 'rev-2'
  await assert.rejects(() => svc.activate({ slug: 'p' }), e => e.code === 'STALE_CONFIRMATION')
  c.fresh.entryRevision = 'rev-1'
  c.packageManager.verifyInstalled = async () => false
  await assert.rejects(() => svc.activate({ slug: 'p' }), e => e.code === 'VERIFY_FAILED')
  assert.equal(activated, false)
  assert.equal(svc.pendingStatus().length, 1)
})

test('activate fails closed when the fresh catalog cannot be reached', async () => {
  const c = setup()
  const activation = { async prepareDisable() { return { entryIds: [] } }, async preDisable() {}, async cancelDisable() {}, async activate() { throw new Error('must not activate') } }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  c.catalog.fetchFresh = async () => { throw new Error('offline') }
  await assert.rejects(() => svc.activate({ slug: 'p' }), e => e.code === 'CATALOG_RECHECK_FAILED')
  assert.equal(svc.pendingStatus().length, 1)
})

test('R2: pending activation survives service restart', async () => {
  const c = setup()
  const activation = { async prepareDisable() { return { entryIds: [] } }, async preDisable() {}, async cancelDisable() {}, async activate() { return { status: 'ACTIVE' } } }
  const svc1 = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: join(c.profile, '.cordis-mp'), lock: c.lock })
  await svc1.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  // 模拟进程重启
  const lock2 = new FileLock(c.journalRoot)
  const journal2 = new Journal({ journalRoot: c.journalRoot, profileRoot: c.profile, lock: lock2 })
  const svc2 = new InstallService({ catalog: c.catalog, journal: journal2, packageManager: c.packageManager, activation, inspect: c.inspect, pendingPath: join(c.profile, '.cordis-mp'), lock: lock2 })
  assert.equal(await svc2.recoverPending(), 1)
  assert.equal((await svc2.activate({ slug: 'p' })).status, 'ACTIVE')
  assert.deepEqual(JSON.parse(readFileSync(join(c.profile, '.cordis-mp', 'pending-activation.json'), 'utf8')), { v: 1, items: [] })
})

test('corrupt pending activation state fails closed instead of losing its recovery record', async () => {
  const c = setup()
  mkdirSync(c.pendingPath, { recursive: true })
  writeFileSync(join(c.pendingPath, 'pending-activation.json'), '{not json')
  const replacement = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock })
  await assert.rejects(() => replacement.recoverPending(), e => e.code === 'PENDING_STATE_INVALID')
})

test('marketplace host and pending packages cannot be uninstalled', async () => {
  const c = setup()
  let removed = false
  c.packageManager.remove = async () => { removed = true; return { exitCode: 0, profileFiles: {} } }
  const host = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, inspect: c.inspect, pendingPath: c.pendingPath, lock: c.lock, selfPackageName: 'p' })
  await assert.rejects(() => host.uninstall({ packageName: 'p' }), e => e.code === 'SELF_UNINSTALL_FORBIDDEN')
  assert.equal(removed, false)

  await c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  await assert.rejects(() => c.service.uninstall({ packageName: 'p' }), e => e.code === 'PENDING_ACTIVATION_EXISTS')
  assert.equal(removed, false)
})
