// 安装路径：fresh 复核 → integrity inspect → journal transaction →
// pre-disable → PackageManagerPort 安装 → lockfile 复核 → durable pending →
// 用户显式 activate。本层不执行构建脚本。
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { withFileLock } from '@cordis-mp/journal-core'
import { InstallError } from './errors.mjs'

const TRACKED_FILES = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json', '.cordis-mp/pending-activation.json']
const PENDING_RELATIVE_PATH = '.cordis-mp/pending-activation.json'

function sameArtifactSource(left, right) {
  return ['packageName', 'version', 'integrity', 'tarball', 'registry'].every(key => left?.[key] === right?.[key])
}

function validPendingRecord(item) {
  const artifact = item?.artifact
  const packageFields = ['packageName', 'version', 'integrity', 'tarball', 'registry']
  return item
    && typeof item.slug === 'string' && item.slug.length > 0
    && (item.platform === undefined || item.platform === 'web' || item.platform === 'desktop')
    && typeof item.entryRevision === 'string' && item.entryRevision.length > 0
    && Array.isArray(item.entryIds) && item.entryIds.every(id => typeof id === 'string' && id.length > 0)
    && (item.ownedDisables === undefined || (Array.isArray(item.ownedDisables) && item.ownedDisables.every(id => typeof id === 'string' && id.length > 0)))
    && packageFields.every(field => typeof artifact?.[field] === 'string' && artifact[field].length > 0)
}

export class InstallService {
  constructor({ catalog, journal, packageManager, activation = null, inspect = null, pendingPath = null, lock = null, selfPackageName = null, selfEntryIds = [] }) {
    this.catalog = catalog
    this.journal = journal
    this.packageManager = packageManager
    this.activation = activation
    this.inspect = inspect
    this.pendingPath = pendingPath
    this.lock = lock
    if (selfPackageName !== null && (typeof selfPackageName !== 'string' || selfPackageName.trim().length === 0)) {
      throw new TypeError('InstallService selfPackageName must be a non-empty package name or null')
    }
    if (!Array.isArray(selfEntryIds) || selfEntryIds.some(id => typeof id !== 'string' || id.trim().length === 0)) {
      throw new TypeError('InstallService selfEntryIds must be an array of non-empty entry ids')
    }
    if (!inspect || typeof inspect.inspectArtifact !== 'function') {
      throw new TypeError('InstallService requires an integrity artifact inspector')
    }
    if (typeof pendingPath !== 'string' || pendingPath.trim().length === 0) {
      throw new TypeError('InstallService requires a durable pending activation path')
    }
    if (typeof this.journal?.profile !== 'string' || resolve(pendingPath) !== resolve(this.journal.profile, '.cordis-mp')) {
      throw new TypeError('InstallService pending activation path must be the profile .cordis-mp directory')
    }
    this.selfPackageName = selfPackageName?.trim() || null
    this.selfEntryIds = [...new Set(selfEntryIds.map(id => id.trim()))]
    if (!this.lock) throw new TypeError('InstallService requires a profile FileLock')
    if (this.journal?.lock !== this.lock) throw new TypeError('InstallService and Journal must share the profile FileLock')
    this.pending = new Map()
  }

  #assertNotMarketplaceHost(artifact) {
    if (this.selfPackageName && artifact?.packageName === this.selfPackageName) {
      throw new InstallError('SELF_INSTALL_FORBIDDEN', 'the marketplace host cannot install its own package')
    }
    if (Array.isArray(artifact?.entryIds) && artifact.entryIds.some(id => this.selfEntryIds.includes(id))) {
      throw new InstallError('HOST_ENTRY_CONFLICT', 'a plugin bundle cannot replace the marketplace host entry')
    }
  }

  async #withProfileLock(operation) {
    try {
      return await withFileLock(this.lock, 'mutation', operation)
    } catch (e) {
      if (e?.code === 'LOCK_BUSY') throw new InstallError('MUTATION_BUSY', 'another profile mutation or recovery is in progress')
      if (e?.code === 'LOCK_FENCED') throw new InstallError('MUTATION_FENCED', 'profile mutation lease was lost; no further writes were attempted')
      throw e
    }
  }

  async install({ slug, platform = 'web', confirmation = {}, signal } = {}) {
    // 1. 安装前强制 fresh 复核（绕过缓存）
    if (typeof confirmation.entryRevision !== 'string' || confirmation.entryRevision.length === 0) {
      throw new InstallError('CONFIRMATION_REQUIRED', 'catalog entry revision confirmation is required')
    }
    let fresh
    try {
      fresh = await this.catalog.fetchFresh(slug)
    } catch {
      throw new InstallError('CATALOG_RECHECK_FAILED', 'catalog must be reachable before installation')
    }
    if (fresh.entryRevision !== confirmation.entryRevision) {
      throw new InstallError('STALE_CONFIRMATION', 'catalog entry changed; please review again')
    }
    const decision = this.catalog.installability(fresh, platform)
    if (!decision.installable) throw new InstallError('NOT_INSTALLABLE', decision.reason)
    const artifact = {
      packageName: fresh.source.packageName,
      version: fresh.source.version,
      integrity: fresh.source.integrity,
      tarball: fresh.source.tarball,
      registry: fresh.source.registry,
    }
    this.#assertNotMarketplaceHost(artifact)
    let stagedPath = null
    try {
      // 只信任完整性检查所见工件的 entry ids；目录返回的 advisory
      // entryIds 绝不能驱动对用户补丁层的禁用写入。
      let inspected
      try {
        inspected = await this.inspect.inspectArtifact(artifact)
      } catch (e) {
        const diagnostic = typeof e?.code === 'string' && e.code.length > 0 ? e.code : 'FAILED'
        throw new InstallError('INSPECT_FAILED', 'artifact inspection failed: ' + diagnostic)
      }
      stagedPath = typeof inspected?.stagedPath === 'string' ? inspected.stagedPath : null
      if (inspected?.packageName !== artifact.packageName || inspected?.version !== artifact.version || inspected?.hasBundlePatch !== true) {
        throw new InstallError('INSPECT_MISMATCH', 'inspected package identity or DSH bundle does not match the catalog artifact')
      }
      artifact.entryIds = Array.isArray(inspected.entryIds) ? inspected.entryIds : []
      this.#assertNotMarketplaceHost(artifact)
      return await this.#withProfileLock(async () => {
        if (this.pending.has(slug)) throw new InstallError('PENDING_ACTIVATION_EXISTS', 'plugin already awaits explicit activation: ' + slug)
        const tx = await this.journal.begin(TRACKED_FILES)
        let disable = null
        let disableApplied = false
        try {
          if (this.activation) {
            disable = await this.activation.prepareDisable({ slug, artifact })
            disable.ownedDisables = []
            if (disable?.entryIds?.length) {
              await this.activation.preDisable(disable.entryIds)
              disableApplied = true
              disable.ownedDisables = this.activation.ownedDisables || []
            }
          }
          const result = await this.packageManager.installVerifiedArtifact(artifact, signal)
          if (result.exitCode !== 0) throw new InstallError('INSTALL_FAILED', result.stderr || `exit ${result.exitCode}`)
          for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
            await this.journal.adoptExternal(tx, rel, bytes)
          }
          const verified = await this.packageManager.verifyInstalled(artifact)
          if (!verified) throw new InstallError('VERIFY_FAILED', 'installed package does not match verified artifact')
          const pending = {
            v: 1,
            slug,
            platform,
            artifact,
            entryIds: disable?.entryIds || [],
            ownedDisables: disable?.ownedDisables || [],
            entryRevision: fresh.entryRevision,
            tx,
            createdAt: Date.now(),
          }
          await this.#persistPendingInTransaction(tx, pending)
          await this.journal.commitFiles(tx)
          this.pending.set(slug, pending)
          return { status: 'COMMITTED', pendingActivation: true, pending }
        } catch (e) {
          if (e.code === 'FP_INJECTED') throw e
          if (disableApplied && disable?.entryIds?.length) { try { await this.activation.cancelDisable(disable.entryIds) } catch {} }
          try { await this.journal.recover() } catch {}
          throw e
        }
      })
    } finally {
      if (stagedPath) { try { this.inspect.cleanup?.(stagedPath) } catch {} }
    }
  }

  async activate({ slug, signal } = {}) {
    return this.#withProfileLock(async () => {
      const pending = this.pending.get(slug)
      if (!pending) throw new InstallError('NO_PENDING_ACTIVATION', 'no pending activation for slug: ' + slug)
      if (!this.activation) throw new InstallError('NO_ACTIVATION_PORT', 'activation port is not configured')
      let fresh
      try {
        fresh = await this.catalog.fetchFresh(slug)
      } catch {
        throw new InstallError('CATALOG_RECHECK_FAILED', 'catalog must be reachable before activation')
      }
      const decision = this.catalog.installability(fresh, pending.platform || 'web')
      if (!decision.installable) throw new InstallError('NOT_INSTALLABLE', decision.reason)
      if (fresh.entryRevision !== pending.entryRevision || !sameArtifactSource(fresh.source, pending.artifact)) {
        throw new InstallError('STALE_CONFIRMATION', 'catalog entry changed; reinstall after reviewing the latest revision')
      }
      this.#assertNotMarketplaceHost({ ...pending.artifact, entryIds: pending.entryIds })
      let verified = false
      try { verified = await this.packageManager.verifyInstalled(pending.artifact) } catch {}
      if (!verified) throw new InstallError('VERIFY_FAILED', 'installed package no longer matches the verified artifact')
      let activationStatus = null
      if (pending.entryIds.length) activationStatus = await this.activation.activate(pending.entryIds, { ownedSet: pending.ownedDisables })
      this.pending.delete(slug)
      try {
        await this.#persistPending()
      } catch (e) {
        this.pending.set(slug, pending)
        throw e
      }
      return { status: 'ACTIVE', activationStatus }
    })
  }

  #pendingFile() { return join(this.pendingPath, 'pending-activation.json') }
  async #persistPendingInTransaction(tx, pending) {
    const snapshot = { v: 1, items: [...this.pending.values(), pending] }
    await this.journal.writePresent(tx, PENDING_RELATIVE_PATH, Buffer.from(JSON.stringify(snapshot)))
  }
  async #persistPending() {
    const snapshot = { v: 1, items: [...this.pending.values()] }
    const tx = await this.journal.begin([PENDING_RELATIVE_PATH])
    try {
      await this.journal.writePresent(tx, PENDING_RELATIVE_PATH, Buffer.from(JSON.stringify(snapshot)))
      await this.journal.commitFiles(tx)
    } catch (e) { try { await this.journal.recover() } catch {}; throw e }
  }
  pendingStatus() {
    return [...this.pending.values()].map(({ slug, entryRevision, createdAt }) => ({ slug, entryRevision, createdAt }))
  }
  async recoverPending() {
    const p = this.#pendingFile(); if (!existsSync(p)) return 0
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      const list = data?.v === 1 ? (Array.isArray(data.items) ? data.items : data.slug ? [data] : null) : null
      const slugs = new Set(list?.map(item => item?.slug))
      if (!list || list.some(item => !validPendingRecord(item)) || slugs.size !== list.length) {
        throw new Error('pending activation state has an invalid schema')
      }
      this.pending.clear()
      for (const item of list) {
        this.pending.set(item.slug, {
          ...item,
          platform: item.platform || 'web',
          ownedDisables: item.ownedDisables || [],
        })
      }
      return list.length
    } catch {
      throw new InstallError('PENDING_STATE_INVALID', 'pending activation state is invalid; recovery is required before mutations')
    }
  }
  async uninstall({ packageName, signal } = {}) {
    if (typeof packageName !== 'string' || packageName.trim().length === 0) throw new InstallError('BAD_PACKAGE_NAME', 'package name is required')
    const normalizedPackageName = packageName.trim()
    if (this.selfPackageName && normalizedPackageName === this.selfPackageName) {
      throw new InstallError('SELF_UNINSTALL_FORBIDDEN', 'the marketplace host cannot uninstall its own package')
    }
    return this.#withProfileLock(async () => {
      if ([...this.pending.values()].some(pending => pending.artifact.packageName === normalizedPackageName)) {
        throw new InstallError('PENDING_ACTIVATION_EXISTS', 'plugin awaits explicit activation and cannot be uninstalled yet: ' + normalizedPackageName)
      }
      const tx = await this.journal.begin(TRACKED_FILES)
      try {
        const result = await this.packageManager.remove(normalizedPackageName, signal)
        if (result.exitCode !== 0) throw new InstallError('REMOVE_FAILED', result.stderr || `exit ${result.exitCode}`)
        for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
          await this.journal.adoptExternal(tx, rel, bytes)
        }
        await this.journal.commitFiles(tx)
      } catch (e) {
        if (e.code === 'FP_INJECTED') throw e
        try { await this.journal.recover() } catch {}
        throw e
      }
      return { status: 'COMMITTED', tx }
    })
  }
}
