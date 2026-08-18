// PackageManagerPort 的 dsh 适配：install/remove/verify + profile 文本回写。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TRACKED = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json']

export class DshPackageManagerPort {
  constructor({ runner, profileDir, platform = 'web' }) {
    this.runner = runner; this.profileDir = profileDir; this.platform = platform
  }
  #spec(artifact) { return `${artifact.packageName}@${artifact.version}` }
  #profileFiles() {
    const files = {}
    for (const rel of TRACKED) {
      const p = join(this.profileDir, rel)
      if (existsSync(p)) files[rel] = readFileSync(p)
    }
    return files
  }
  async installVerifiedArtifact(artifact, signal) {
    const result = await this.runner.run([...this.runner.pluginArgs(), 'add', this.#spec(artifact), '--ignore-scripts'], { signal })
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} }
  }
  async remove(packageName, signal) {
    const result = await this.runner.run([...this.runner.pluginArgs(), 'remove', packageName], { signal })
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} }
  }
  async verifyInstalled(artifact) {
    const p = join(this.profileDir, 'node_modules', artifact.packageName, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(p, 'utf8'))
      return manifest.name === artifact.packageName && manifest.version === artifact.version
    } catch { return false }
  }
}
