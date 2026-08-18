import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Journal } from '@cordis-mp/journal-core'
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
    source: { type: 'npm', packageName: 'p', version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: null },
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
  const journal = new Journal({ journalRoot, profileRoot: profile })
  const service = new InstallService({ catalog, journal, packageManager, pendingPath: join(profile, '.cordis-mp') })
  return { base, profile, journalRoot, journal, service, catalog, packageManager, fresh }
}

test('successful install commits profile file transaction', async () => {
  const c = setup()
  const out = await c.service.install({ slug: 'p', platform: 'web', confirmation: { entryRevision: 'rev-1' } })
  assert.equal(out.status, 'COMMITTED')
  assert.equal(readFileSync(join(c.profile, 'package.json'), 'utf8'), '{"new":true}')
  assert.ok(c.packageManager.artifact.integrity.startsWith('sha512-'))
})

test('stale confirmation is rejected before package manager runs', async () => {
  const c = setup()
  let called = false
  c.packageManager.installVerifiedArtifact = async () => { called = true }
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'old' } }), e => e.code === 'STALE_CONFIRMATION')
  assert.equal(called, false)
})

test('blocked entry is not installable', async () => {
  const c = setup({ blocked: true })
  await assert.rejects(() => c.service.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } }), e => e.code === 'NOT_INSTALLABLE' && /blocked/.test(e.message))
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

test('M2b: pre-disable happens before install; activation is pending', async () => {
  const c = setup()
  const order = []
  c.packageManager.installVerifiedArtifact = async () => { order.push('install'); return { exitCode: 0, profileFiles: { 'package.json': Buffer.from('{"new":true}') } } }
  const activation = {
    async prepareDisable() { order.push('prepare'); return { entryIds: ['entry-1'] } },
    async preDisable() { order.push('pre-disable') },
    async cancelDisable() { order.push('cancel') },
    async activate() { order.push('activate'); return { status: 'ACTIVE' } },
  }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation })
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
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation })
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
  const inspect = { async inspectArtifact() { return { entryIds: ['inspect-entry'] } } }
  const svc = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, inspect })
  await svc.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  assert.deepEqual(seen, ['inspect-entry'])
})

test('R2: pending activation survives service restart', async () => {
  const c = setup()
  const activation = { async prepareDisable() { return { entryIds: [] } }, async preDisable() {}, async cancelDisable() {}, async activate() { return { status: 'ACTIVE' } } }
  const svc1 = new InstallService({ catalog: c.catalog, journal: c.journal, packageManager: c.packageManager, activation, pendingPath: join(c.profile, '.cordis-mp') })
  await svc1.install({ slug: 'p', confirmation: { entryRevision: 'rev-1' } })
  // 模拟进程重启
  const journal2 = new Journal({ journalRoot: c.journalRoot, profileRoot: c.profile })
  const svc2 = new InstallService({ catalog: c.catalog, journal: journal2, packageManager: c.packageManager, activation, pendingPath: join(c.profile, '.cordis-mp') })
  assert.equal(await svc2.recoverPending(), 1)
  assert.equal((await svc2.activate({ slug: 'p' })).status, 'ACTIVE')
  assert.deepEqual(JSON.parse(readFileSync(join(c.profile, '.cordis-mp', 'pending-activation.json'), 'utf8')), { v: 1, items: [] })
})
