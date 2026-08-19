// PackageManagerPort 的 dsh 适配：install/remove/verify + profile 文本回写。
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TRACKED = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', '.cordis-mp/state.json']
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024

function unquoteYamlScalar(value) {
  const text = String(value || '').trim()
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text) } catch { return text.slice(1, -1) }
  }
  return text
}

function isArtifactPackageKey(key, artifact) {
  const id = `${artifact.packageName}@${artifact.version}`
  return key === id || key === `/${id}` || key.startsWith(`${id}(`) || key.startsWith(`/${id}(`)
}

function inlineIntegrity(resolution) {
  const match = /(?:^|,)\s*integrity:\s*([^,}]+)/.exec(resolution)
  return match ? unquoteYamlScalar(match[1]) : null
}

/**
 * Read only the pnpm `packages` records relevant to this exact artifact.
 * pnpm v9 writes inline `resolution` maps; v6/v7 and peer-suffixed keys are
 * accepted as well. Anything not recognized is intentionally a failed proof.
 */
function pnpmLockRecords(lockfile, artifact) {
  let inPackages = false
  let current = null
  const records = []
  const finish = () => { if (current) records.push(current); current = null }

  for (const line of lockfile.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages:\s*(?:#.*)?$/.test(line)) inPackages = true
      continue
    }
    if (/^[^\s#]/.test(line)) break

    // Exactly two spaces: nested `resolution:` keys must never start a record.
    const entry = /^ {2}([^\s].*?):\s*(?:#.*)?$/.exec(line)
    if (entry) {
      finish()
      const key = unquoteYamlScalar(entry[1])
      if (isArtifactPackageKey(key, artifact)) current = { integrity: null, resolutionIndent: null }
      continue
    }
    if (!current) continue

    const flowResolution = /^ {4}resolution:\s*\{(.*)\}\s*(?:#.*)?$/.exec(line)
    if (flowResolution) {
      current.integrity = inlineIntegrity(flowResolution[1])
      current.resolutionIndent = null
      continue
    }
    if (/^ {4}resolution:\s*(?:#.*)?$/.test(line)) {
      current.resolutionIndent = 4
      continue
    }
    // A later mapping at the same indentation is no longer part of
    // `resolution`.  In particular, an unrelated `dependencies.integrity`
    // must never be accepted as the lock proof for this artifact.
    if (/^ {4}[^\s].*?:\s*(?:#.*)?$/.test(line)) {
      current.resolutionIndent = null
      continue
    }
    if (current.resolutionIndent === 4) {
      const nestedIntegrity = /^ {6}integrity:\s*(.*?)\s*(?:#.*)?$/.exec(line)
      if (nestedIntegrity) current.integrity = unquoteYamlScalar(nestedIntegrity[1])
    }
  }
  finish()
  return records
}

function lockfileIntegrityMatches(lockPath, artifact) {
  if (typeof artifact?.integrity !== 'string' || artifact.integrity.length === 0) return false
  try {
    const stat = lstatSync(lockPath)
    if (!stat.isFile() || stat.size > MAX_LOCKFILE_BYTES) return false
    const records = pnpmLockRecords(readFileSync(lockPath, 'utf8'), artifact)
    return records.length > 0 && records.every(record => record.integrity === artifact.integrity)
  } catch { return false }
}

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
    // dsh forwards these arguments verbatim to pnpm.  Keep the package spec
    // after `--` so a valid npm name beginning with a dash cannot be parsed as
    // a pnpm option.
    const result = await this.runner.run([...this.runner.pluginArgs(), 'add', '--ignore-scripts', '--', this.#spec(artifact)], { signal })
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} }
  }
  async remove(packageName, signal) {
    const result = await this.runner.run([...this.runner.pluginArgs(), 'remove', '--', packageName], { signal })
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} }
  }
  async verifyInstalled(artifact) {
    const p = join(this.profileDir, 'node_modules', artifact.packageName, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(p, 'utf8'))
      if (manifest.name !== artifact.packageName || manifest.version !== artifact.version) return false
      return lockfileIntegrityMatches(join(this.profileDir, 'pnpm-lock.yaml'), artifact)
    } catch { return false }
  }
}
