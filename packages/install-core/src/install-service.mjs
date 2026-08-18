// install-core 第一版：fresh 复核 → installability → journal 事务 →
// PackageManagerPort 安装 → 回写 profile 文本 → 复核 → commit。
// 预禁用/激活门禁留待 M2b；本层不执行构建脚本。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { InstallError } from './errors.mjs'

const TRACKED_FILES = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json']

export class InstallService {
  constructor({ catalog, journal, packageManager, activation = null, inspect = null, pendingPath = null }) {
    this.catalog = catalog
    this.journal = journal
    this.packageManager = packageManager
    this.activation = activation
    this.inspect = inspect
    this.pendingPath = pendingPath
    this.pending = new Map()
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
    if (this.inspect) {
      const inspected = await this.inspect.inspectArtifact(artifact)
      artifact.entryIds = inspected?.entryIds || fresh.entryIds || []
    } else {
      artifact.entryIds = fresh.entryIds || []
    }
    // M2b：PRE_DISABLE 在安装前执行；失败时撤销。
    let disable = null
    if (this.activation) {
      disable = await this.activation.prepareDisable({ slug, artifact })
      if (disable?.entryIds?.length) await this.activation.preDisable(disable.entryIds)
    }
    const tx = await this.journal.begin(TRACKED_FILES)
    try {
      const result = await this.packageManager.installVerifiedArtifact(artifact, signal)
      if (result.exitCode !== 0) throw new InstallError('INSTALL_FAILED', result.stderr || `exit ${result.exitCode}`)
      for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
        await this.journal.writePresent(tx, rel, bytes)
      }
      const verified = await this.packageManager.verifyInstalled(artifact)
      if (!verified) throw new InstallError('VERIFY_FAILED', 'installed package does not match verified artifact')
      await this.journal.commitFiles(tx)
    } catch (e) {
      if (e.code === 'FP_INJECTED') throw e
      try { await this.journal.recover() } catch {}
      if (disable?.entryIds?.length) { try { await this.activation.cancelDisable(disable.entryIds) } catch {} }
      throw e
    }
    const pending = { v: 1, slug, artifact, entryIds: disable?.entryIds || [], entryRevision: fresh.entryRevision, tx, createdAt: Date.now() }
    this.pending.set(slug, pending)
    await this.#persistPending(pending)
    return { status: 'COMMITTED', pendingActivation: true, pending }
  }

  async activate({ slug, signal } = {}) {
    const pending = this.pending.get(slug)
    if (!pending) throw new InstallError('NO_PENDING_ACTIVATION', 'no pending activation for slug: ' + slug)
    if (!this.activation) throw new InstallError('NO_ACTIVATION_PORT', 'activation port is not configured')
    let activationStatus = null
    if (pending.entryIds.length) activationStatus = await this.activation.activate(pending.entryIds, signal)
    this.pending.delete(slug)
    await this.#persistPending({})
    return { status: 'ACTIVE', activationStatus }
  }

  #pendingFile() { if (!this.pendingPath) return null; return join(this.pendingPath, 'pending-activation.json') }
  async #persistPending(pending) {
    const p = this.#pendingFile(); if (!p) return
    const tx = await this.journal.begin(['.cordis-mp/pending-activation.json'])
    try {
      await this.journal.writePresent(tx, '.cordis-mp/pending-activation.json', Buffer.from(JSON.stringify(pending)))
      await this.journal.commitFiles(tx)
    } catch (e) { try { await this.journal.recover() } catch {}; throw e }
  }
  async recoverPending() {
    const p = this.#pendingFile(); if (!p || !existsSync(p)) return 0
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'))
      const list = data?.v === 1 && data?.slug ? [data] : []
      for (const item of list) this.pending.set(item.slug, item)
      return list.length
    } catch { return 0 }
  }
  async uninstall({ packageName, signal } = {}) {
    const tx = await this.journal.begin(TRACKED_FILES)
    try {
      const result = await this.packageManager.remove(packageName, signal)
      if (result.exitCode !== 0) throw new InstallError('REMOVE_FAILED', result.stderr || `exit ${result.exitCode}`)
      for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
        await this.journal.writePresent(tx, rel, bytes)
      }
      await this.journal.commitFiles(tx)
    } catch (e) {
      if (e.code === 'FP_INJECTED') throw e
      try { await this.journal.recover() } catch {}
      throw e
    }
    return { status: 'COMMITTED', tx }
  }
}
