// install-core 第一版：fresh 复核 → installability → journal 事务 →
// PackageManagerPort 安装 → 回写 profile 文本 → 复核 → commit。
// 预禁用/激活门禁留待 M2b；本层不执行构建脚本。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from '@cordis-mp/journal-core'
import { InstallError } from './errors.mjs'

const TRACKED_FILES = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json']

export class InstallService {
  constructor({ catalog, journal, packageManager, activation = null, inspect = null, pendingPath = null, lock = null }) {
    this.catalog = catalog
    this.journal = journal
    this.packageManager = packageManager
    this.activation = activation
    this.inspect = inspect
    this.pendingPath = pendingPath
    this.lock = lock
    if (!this.lock) throw new TypeError('InstallService requires a profile FileLock')
    if (this.journal?.lock !== this.lock) throw new TypeError('InstallService and Journal must share the profile FileLock')
    this.pending = new Map()
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
    const fresh = await this.catalog.fetchFresh(slug)
    if (confirmation.entryRevision && fresh.entryRevision !== confirmation.entryRevision) {
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
    // R1：安装前 INSPECT 解析 entryIds（tarball/目录）；catalog entryIds 作为兜底。
    let stagedPath = null
    if (this.inspect) {
      const inspected = await this.inspect.inspectArtifact(artifact)
      const inspectedIds = inspected?.entryIds
      artifact.entryIds = Array.isArray(inspectedIds) && inspectedIds.length > 0 ? inspectedIds : (Array.isArray(fresh.entryIds) ? fresh.entryIds : [])
      stagedPath = inspected?.stagedPath || null
    } else {
      artifact.entryIds = fresh.entryIds || []
    }
    try {
      return await this.#withProfileLock(async () => {
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
          await this.journal.commitFiles(tx)
        } catch (e) {
          if (e.code === 'FP_INJECTED') throw e
          if (disableApplied && disable?.entryIds?.length) { try { await this.activation.cancelDisable(disable.entryIds) } catch {} }
          try { await this.journal.recover() } catch {}
          throw e
        }
        const pending = { v: 1, slug, artifact, entryIds: disable?.entryIds || [], ownedDisables: disable?.ownedDisables || [], entryRevision: fresh.entryRevision, tx, createdAt: Date.now() }
        this.pending.set(slug, pending)
        await this.#persistPending()
        return { status: 'COMMITTED', pendingActivation: true, pending }
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
      let activationStatus = null
      if (pending.entryIds.length) activationStatus = await this.activation.activate(pending.entryIds, { ownedSet: pending.ownedDisables })
      this.pending.delete(slug)
      await this.#persistPending()
      return { status: 'ACTIVE', activationStatus }
    })
  }

  #pendingFile() { if (!this.pendingPath) return null; return join(this.pendingPath, 'pending-activation.json') }
  async #persistPending() {
    const p = this.#pendingFile(); if (!p) return
    const snapshot = { v: 1, items: [...this.pending.values()] }
    const tx = await this.journal.begin(['.cordis-mp/pending-activation.json'])
    try {
      await this.journal.writePresent(tx, '.cordis-mp/pending-activation.json', Buffer.from(JSON.stringify(snapshot)))
      await this.journal.commitFiles(tx)
    } catch (e) { try { await this.journal.recover() } catch {}; throw e }
  }
  async recoverPending() {
    const p = this.#pendingFile(); if (!p || !existsSync(p)) return 0
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      const list = data?.v === 1 ? (Array.isArray(data.items) ? data.items : data.slug ? [data] : []) : []
      for (const item of list) if (item?.slug) this.pending.set(item.slug, item)
      return list.length
    } catch { return 0 }
  }
  async uninstall({ packageName, signal } = {}) {
    return this.#withProfileLock(async () => {
      const tx = await this.journal.begin(TRACKED_FILES)
      try {
        const result = await this.packageManager.remove(packageName, signal)
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
