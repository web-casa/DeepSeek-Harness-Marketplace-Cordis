// Public-release gate: validates a candidate locally. It never contacts the npm
// registry, GitHub, a database, or a deployment target, and it never publishes or tags.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicReleaseArtifact,
  PUBLIC_RELEASE_ARTIFACT_FILES,
} from '../apps/web/scripts/release-artifact.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'apps', 'web')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function fail(message) {
  console.error(`PUBLIC RELEASE BLOCKED: ${message}`)
  process.exitCode = 1
}

function npmPackedFiles(candidateDir) {
  const result = spawnSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--offline', '--json'], {
    cwd: candidateDir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })
  if (result.error) throw new Error(`npm pack could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`npm pack failed (${result.status}): ${result.stderr.trim()}`)
  let entries
  try {
    entries = JSON.parse(result.stdout)
  } catch {
    throw new Error('npm pack did not return JSON')
  }
  if (!Array.isArray(entries) || entries.length !== 1 || !entries[0] || !Array.isArray(entries[0].files)) {
    throw new Error('npm pack did not return exactly one candidate file list')
  }
  return new Set(entries[0].files.map((file) => file.path))
}

try {
  const artifact = createPublicReleaseArtifact(appDir)
  const archiveFiles = new Set(execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' }).trim().split('\n'))
  for (const path of PUBLIC_RELEASE_ARTIFACT_FILES) {
    if (!archiveFiles.has(`package/${path}`)) throw new Error(`public candidate archive omits ${path}`)
  }

  const unpack = mkdtempSync(join(tmpdir(), 'cordis-public-release-check-'))
  let manifest
  try {
    execFileSync('tar', ['-xzf', artifact, '-C', unpack])
    const candidateDir = join(unpack, 'package')
    manifest = JSON.parse(readFileSync(join(candidateDir, 'package.json'), 'utf8'))
    if (manifest.private !== false) throw new Error('public candidate manifest must set private=false')
    if (typeof manifest.license !== 'string' || manifest.license.trim().length === 0) {
      throw new Error('public candidate manifest omits its license declaration')
    }
    if (manifest.license.trim().toUpperCase() === 'UNLICENSED') {
      throw new Error('public candidate manifest must not declare license UNLICENSED')
    }
    if (manifest.dependencies !== undefined || manifest.devDependencies !== undefined || manifest.scripts !== undefined) {
      throw new Error('public candidate leaked workspace dependencies, development dependencies, or scripts')
    }
    const packedFiles = npmPackedFiles(candidateDir)
    for (const path of PUBLIC_RELEASE_ARTIFACT_FILES) {
      if (!packedFiles.has(path)) throw new Error(`npm pack omits ${path}`)
    }
  } finally {
    rmSync(unpack, { recursive: true, force: true })
  }

  console.log(JSON.stringify({
    status: 'ready',
    package: `${manifest.name}@${manifest.version}`,
    license: manifest.license,
    artifact,
  }, null, 2))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
