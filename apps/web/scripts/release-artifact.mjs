// Build the standalone DSH artifact used for smoke tests and a future public
// registry release. The workspace package remains private; this script creates
// a self-contained candidate only and never publishes it.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const RELEASE_DSH_ENGINE = '>=0.1.0-rc.7 <0.2.0'
export const RELEASE_ARTIFACT_FILES = Object.freeze([
  'package.json',
  'README.md',
  'cordis.patch.yml',
  'dist/index.js',
  'dist/client.js',
  'data/registry-snapshot.json',
])

const EXACT_SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactPlatforms(value) {
  return Array.isArray(value) && value.length === 2 && new Set(value).size === 2 && value.includes('web') && value.includes('desktop')
}

/** Return a human-readable source-manifest problem, or null when it is safe to package. */
export function releaseManifestProblem(source) {
  if (!isRecord(source)) return 'package.json must be an object'
  if (source.private !== true) return 'workspace package must remain private; publishing uses only the generated candidate'
  if (typeof source.name !== 'string' || source.name.length === 0) return 'package name is required'
  if (typeof source.description !== 'string' || source.description.trim().length === 0) return 'package description is required'
  if (typeof source.version !== 'string' || !EXACT_SEMVER_RE.test(source.version)) return 'package version must be an exact semver'
  if (source.type !== 'module') return 'package type must be module'
  if (!isRecord(source.dsh)) return 'dsh metadata is required'
  if (!exactPlatforms(source.dsh.platforms)) return 'dsh.platforms must declare exactly web and desktop'
  if (!isRecord(source.dsh.engines) || source.dsh.engines.dsh !== RELEASE_DSH_ENGINE) {
    return `dsh.engines.dsh must be ${JSON.stringify(RELEASE_DSH_ENGINE)}`
  }
  if (!isRecord(source.dsh.bundle) || source.dsh.bundle.patch !== './cordis.patch.yml') {
    return 'dsh.bundle.patch must point to ./cordis.patch.yml'
  }
  if (!isRecord(source.dsh.client) || source.dsh.client.platform !== 'web') {
    return 'dsh.client.platform must remain web'
  }
  return null
}

/**
 * Convert the private workspace manifest into the manifest that would be
 * published. Keep this transformation narrow so workspace dependencies and
 * source-only scripts cannot leak into an installable artifact.
 */
export function createReleaseManifest(source) {
  const problem = releaseManifestProblem(source)
  if (problem) throw new Error(`cannot create Cordis release artifact: ${problem}`)
  const {
    dependencies: _dependencies,
    devDependencies: _devDependencies,
    scripts: _scripts,
    private: _private,
    main: _main,
    exports: _exports,
    files: _files,
    ...release
  } = source
  return {
    ...release,
    private: false,
    main: './dist/index.js',
    exports: {
      '.': './dist/index.js',
      './client': './dist/client.js',
      './package.json': './package.json',
    },
    files: [...RELEASE_ARTIFACT_FILES.filter((path) => path !== 'package.json')],
    dsh: structuredClone(source.dsh),
  }
}

/**
 * Create a standalone package tarball. It deliberately preserves the dist/
 * directory: the bundled host resolves ../data/registry-snapshot.json from
 * dist/index.js, so flattening the host entry breaks offline fallback.
 */
export function createReleaseArtifact(appDir) {
  const sourceManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  const manifest = createReleaseManifest(sourceManifest)
  const pack = mkdtempSync(join(tmpdir(), 'cordis-web-pack-'))
  const packageDir = join(pack, 'package')
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  mkdirSync(join(packageDir, 'data'), { recursive: true })

  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  copyFileSync(join(appDir, 'README.md'), join(packageDir, 'README.md'))
  copyFileSync(join(appDir, 'cordis.patch.yml'), join(packageDir, 'cordis.patch.yml'))
  copyFileSync(join(appDir, 'dist', 'index.js'), join(packageDir, 'dist', 'index.js'))
  copyFileSync(join(appDir, 'dist', 'client.js'), join(packageDir, 'dist', 'client.js'))
  copyFileSync(join(appDir, 'dist', 'data', 'registry-snapshot.json'), join(packageDir, 'data', 'registry-snapshot.json'))

  const out = join(pack, 'cordis-mp-web-release-candidate.tgz')
  execFileSync('tar', ['-czf', out, '-C', pack, 'package'])
  return out
}
