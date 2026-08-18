// install-core 第一版：fresh 复核 → installability → journal 事务 →
// PackageManagerPort 安装 → 回写 profile 文本 → 复核 → commit。
// 预禁用/激活门禁留待 M2b；本层不执行构建脚本。
import { InstallError } from './errors.mjs'

const TRACKED_FILES = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json']

export class InstallService {
  constructor({ catalog, journal, packageManager, activation = null }) {
    this.catalog = catalog
    this.journal = journal
    this.packageManager = packageManager
    this.activation = activation
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
      throw e
    }
    let activationStatus = null
    if (this.activation) {
      activationStatus = await this.activation.requestActivation({ slug, artifact }, signal)
    }
    return { status: 'COMMITTED', activationStatus, tx }
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
