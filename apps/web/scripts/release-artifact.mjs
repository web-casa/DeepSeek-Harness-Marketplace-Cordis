// Build the standalone DSH artifact used for smoke tests and a future public
// registry release. The workspace package remains private; this script creates
// a self-contained candidate only and never publishes it.
import { execFileSync } from 'node:child_process'
import { copyFileSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const RELEASE_DSH_ENGINE = '>=0.1.0-rc.7 <0.2.0'
export const PUBLIC_RELEASE_PACKAGE_NAME = '@webcasa/deepseek-harness-marketplace'
export const PUBLIC_RELEASE_ARTIFACT_NAME = 'webcasa-deepseek-harness-marketplace-release-candidate.tgz'
export const PUBLIC_RELEASE_LICENSE_FILE = 'LICENSE'
export const MAX_PUBLIC_RELEASE_LICENSE_BYTES = 128 * 1024
export const RELEASE_ARTIFACT_FILES = Object.freeze([
  'package.json',
  'README.md',
  'cordis.patch.yml',
  'dist/index.js',
  'dist/client.js',
  'data/registry-snapshot.json',
])
export const PUBLIC_RELEASE_ARTIFACT_FILES = Object.freeze([
  ...RELEASE_ARTIFACT_FILES,
  PUBLIC_RELEASE_LICENSE_FILE,
])

const EXACT_SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactPlatforms(value) {
  return Array.isArray(value) && value.length === 2 && new Set(value).size === 2 && value.includes('web') && value.includes('desktop')
}

function publicLicenseDeclarationProblem(source) {
  if (typeof source.license !== 'string' || source.license.trim().length === 0) {
    return 'public release requires a non-empty package.json license declaration'
  }
  if (source.license.trim().toUpperCase() === 'UNLICENSED') {
    return 'public release must not declare license UNLICENSED'
  }
  return null
}

function publicPackageIdentityProblem(source) {
  if (source.name !== PUBLIC_RELEASE_PACKAGE_NAME) {
    return `public release package name must be ${JSON.stringify(PUBLIC_RELEASE_PACKAGE_NAME)}`
  }
  return null
}

function publicLicenseFileProblem(appDir) {
  const licensePath = join(appDir, PUBLIC_RELEASE_LICENSE_FILE)
  let metadata
  try {
    metadata = lstatSync(licensePath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return `public release requires a checked-in ${PUBLIC_RELEASE_LICENSE_FILE} file`
    }
    const message = error instanceof Error ? error.message : String(error)
    return `cannot inspect public release ${PUBLIC_RELEASE_LICENSE_FILE} file: ${message}`
  }
  if (!metadata.isFile()) {
    return `public release ${PUBLIC_RELEASE_LICENSE_FILE} must be a regular file, not a symlink or directory`
  }
  if (metadata.size === 0) return `public release ${PUBLIC_RELEASE_LICENSE_FILE} must not be empty`
  if (metadata.size > MAX_PUBLIC_RELEASE_LICENSE_BYTES) {
    return `public release ${PUBLIC_RELEASE_LICENSE_FILE} must not exceed ${MAX_PUBLIC_RELEASE_LICENSE_BYTES} bytes`
  }
  if (readFileSync(licensePath, 'utf8').trim().length === 0) {
    return `public release ${PUBLIC_RELEASE_LICENSE_FILE} must contain non-whitespace text`
  }
  return null
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

/** Return a human-readable public-release manifest problem, or null when legal metadata is explicit. */
export function publicReleaseManifestProblem(source) {
  return releaseManifestProblem(source) || publicPackageIdentityProblem(source) || publicLicenseDeclarationProblem(source)
}

/** Return a human-readable public-release artifact problem, or null when it is safe to create. */
export function publicReleaseArtifactProblem(appDir, source) {
  return publicReleaseManifestProblem(source) || publicLicenseFileProblem(appDir)
}

/**
 * Convert the private workspace manifest into the manifest that would be
 * published. Keep this transformation narrow so workspace dependencies and
 * source-only scripts cannot leak into an installable artifact.
 */
export function createReleaseManifest(source, { publicRelease = false } = {}) {
  const problem = publicRelease ? publicReleaseManifestProblem(source) : releaseManifestProblem(source)
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
    files: [...(publicRelease ? PUBLIC_RELEASE_ARTIFACT_FILES : RELEASE_ARTIFACT_FILES)
      .filter((path) => path !== 'package.json')],
    dsh: structuredClone(source.dsh),
  }
}

/**
 * Create a standalone package tarball. It deliberately preserves the dist/
 * directory: the bundled host resolves ../data/registry-snapshot.json from
 * dist/index.js, so flattening the host entry breaks offline fallback.
 */
export function createReleaseArtifact(appDir, { publicRelease = false } = {}) {
  const sourceManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  if (publicRelease) {
    const problem = publicReleaseArtifactProblem(appDir, sourceManifest)
    if (problem) throw new Error(`cannot create public Cordis release artifact: ${problem}`)
  }
  const manifest = createReleaseManifest(sourceManifest, { publicRelease })
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
  if (publicRelease) {
    copyFileSync(join(appDir, PUBLIC_RELEASE_LICENSE_FILE), join(packageDir, PUBLIC_RELEASE_LICENSE_FILE))
  }

  const out = join(pack, PUBLIC_RELEASE_ARTIFACT_NAME)
  execFileSync('tar', ['-czf', out, '-C', pack, 'package'])
  return out
}

/** Create the publication-capable candidate only after its legal metadata is explicit. */
export function createPublicReleaseArtifact(appDir) {
  return createReleaseArtifact(appDir, { publicRelease: true })
}
