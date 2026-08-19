import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createPublicReleaseArtifact,
  MAX_PUBLIC_RELEASE_LICENSE_BYTES,
  PUBLIC_RELEASE_ARTIFACT_FILES,
  RELEASE_ARTIFACT_FILES,
  RELEASE_DSH_ENGINE,
  publicReleaseArtifactProblem,
  publicReleaseManifestProblem,
  releaseManifestProblem,
} from '../scripts/release-artifact.mjs'

const app = dirname(fileURLToPath(import.meta.url))
const root = join(app, '..', '..', '..')
const buildScript = join(app, '..', 'scripts', 'build.mjs')
const packScript = join(app, '..', 'scripts', 'pack-smoke.mjs')
const publicReleaseCheckScript = join(root, 'scripts', 'public-release-check.mjs')

function packCandidate() {
  execFileSync(process.execPath, [buildScript], { stdio: 'pipe' })
  return execFileSync(process.execPath, [packScript], { encoding: 'utf8' }).trim()
}

test('release candidate packer fails closed when private source metadata loses an installation gate', () => {
  const sourceManifest = JSON.parse(readFileSync(join(app, '..', 'package.json'), 'utf8'))
  const missingDesktop = structuredClone(sourceManifest)
  missingDesktop.dsh.platforms = ['web']
  assert.match(releaseManifestProblem(missingDesktop) ?? '', /exactly web and desktop/)

  const incompatibleEngine = structuredClone(sourceManifest)
  incompatibleEngine.dsh.engines.dsh = '>=0.2.0'
  assert.match(releaseManifestProblem(incompatibleEngine) ?? '', /dsh\.engines\.dsh/)

  const accidentallyPublicSource = structuredClone(sourceManifest)
  accidentallyPublicSource.private = false
  assert.match(releaseManifestProblem(accidentallyPublicSource) ?? '', /must remain private/)
})

test('public release gate validates the owner-approved source and still rejects missing legal metadata', () => {
  const sourceManifest = JSON.parse(readFileSync(join(app, '..', 'package.json'), 'utf8'))
  assert.equal(releaseManifestProblem(sourceManifest), null)
  assert.equal(publicReleaseManifestProblem(sourceManifest), null)
  assert.equal(publicReleaseArtifactProblem(join(app, '..'), sourceManifest), null)
  assert.match(readFileSync(join(app, '..', 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 www\.Web\.Casa/)

  const missingDeclaration = structuredClone(sourceManifest)
  delete missingDeclaration.license
  assert.match(publicReleaseManifestProblem(missingDeclaration) ?? '', /license declaration/)

  const unlicensed = structuredClone(sourceManifest)
  unlicensed.license = 'UNLICENSED'
  assert.match(publicReleaseManifestProblem(unlicensed) ?? '', /must not declare license UNLICENSED/)

  const artifactless = mkdtempSync(join(tmpdir(), 'cordis-public-release-artifactless-'))
  try {
    assert.match(publicReleaseArtifactProblem(artifactless, sourceManifest) ?? '', /checked-in LICENSE file/)
  } finally {
    rmSync(artifactless, { recursive: true, force: true })
  }
})

test('public release candidate includes the declared bounded LICENSE artifact', () => {
  const sourceManifest = JSON.parse(readFileSync(join(app, '..', 'package.json'), 'utf8'))
  const compliantManifest = structuredClone(sourceManifest)
  compliantManifest.license = 'MIT'
  const fixture = mkdtempSync(join(tmpdir(), 'cordis-public-release-fixture-'))
  let artifactDir = null
  let unpack = null
  try {
    writeFileSync(join(fixture, 'package.json'), JSON.stringify(compliantManifest, null, 2) + '\n')
    writeFileSync(join(fixture, 'README.md'), '# fixture\n')
    writeFileSync(join(fixture, 'cordis.patch.yml'), '- insert: []\n')
    writeFileSync(join(fixture, 'LICENSE'), '')
    assert.match(publicReleaseArtifactProblem(fixture, compliantManifest) ?? '', /LICENSE must not be empty/)
    writeFileSync(join(fixture, 'LICENSE'), Buffer.alloc(MAX_PUBLIC_RELEASE_LICENSE_BYTES + 1, 0x61))
    assert.match(publicReleaseArtifactProblem(fixture, compliantManifest) ?? '', /must not exceed/)
    writeFileSync(join(fixture, 'LICENSE'), 'MIT fixture license\n')
    mkdirSync(join(fixture, 'dist', 'data'), { recursive: true })
    writeFileSync(join(fixture, 'dist', 'index.js'), 'export {}\n')
    writeFileSync(join(fixture, 'dist', 'client.js'), 'export {}\n')
    writeFileSync(join(fixture, 'dist', 'data', 'registry-snapshot.json'), '{}\n')

    assert.equal(publicReleaseArtifactProblem(fixture, compliantManifest), null)
    const artifact = createPublicReleaseArtifact(fixture)
    artifactDir = dirname(artifact)
    const listing = execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' }).trim().split('\n')
    for (const path of PUBLIC_RELEASE_ARTIFACT_FILES) {
      assert.ok(listing.includes(`package/${path}`), `missing public artifact ${path}`)
    }
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', artifact, 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(manifest.license, 'MIT')
    assert.deepEqual(manifest.files, PUBLIC_RELEASE_ARTIFACT_FILES.filter((path) => path !== 'package.json'))

    unpack = mkdtempSync(join(tmpdir(), 'cordis-public-release-pack-'))
    execFileSync('tar', ['-xzf', artifact, '-C', unpack])
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const packed = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--offline', '--json'], {
      cwd: join(unpack, 'package'),
      encoding: 'utf8',
    }))
    const packedFiles = new Set(packed[0].files.map((file) => file.path))
    for (const path of PUBLIC_RELEASE_ARTIFACT_FILES) {
      assert.ok(packedFiles.has(path), `npm pack omitted public artifact ${path}`)
    }
  } finally {
    if (unpack) rmSync(unpack, { recursive: true, force: true })
    if (artifactDir) rmSync(artifactDir, { recursive: true, force: true })
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('public release check emits a GitHub Actions artifact output only after validation', () => {
  execFileSync(process.execPath, [buildScript], { stdio: 'pipe' })
  const outputDir = mkdtempSync(join(tmpdir(), 'cordis-public-release-output-'))
  const output = join(outputDir, 'github-output')
  let artifactDir = null
  try {
    const result = spawnSync(process.execPath, [publicReleaseCheckScript], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
    assert.equal(result.status, 0, result.stderr)
    const ready = JSON.parse(result.stdout)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.package, '@cordis-mp/web@0.1.0')
    artifactDir = dirname(ready.artifact)
    assert.equal(basename(ready.artifact), 'cordis-mp-web-release-candidate.tgz')
    assert.ok(artifactDir.startsWith(join(tmpdir(), 'cordis-web-pack-')))
    const outputs = new Map(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s)))
    assert.equal(outputs.get('artifact'), ready.artifact)
    assert.equal(outputs.get('package'), ready.package)
  } finally {
    if (artifactDir) rmSync(artifactDir, { recursive: true, force: true })
    rmSync(outputDir, { recursive: true, force: true })
  }
})

test('release candidate has strict DSH metadata and retains the snapshot-relative layout', async () => {
  const sourceManifest = JSON.parse(readFileSync(join(app, '..', 'package.json'), 'utf8'))
  assert.equal(releaseManifestProblem(sourceManifest), null)

  const tarball = packCandidate()
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
  for (const path of RELEASE_ARTIFACT_FILES) assert.ok(listing.includes(`package/${path}`), `missing ${path}`)
  assert.equal(listing.includes('package/index.js'), false, 'host must not be flattened away from ../data')

  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(manifest.private, false)
  assert.equal(manifest.main, './dist/index.js')
  assert.deepEqual(manifest.exports, {
    '.': './dist/index.js',
    './client': './dist/client.js',
    './package.json': './package.json',
  })
  assert.deepEqual(manifest.dsh.platforms, ['web', 'desktop'])
  assert.equal(manifest.dsh.engines.dsh, RELEASE_DSH_ENGINE)
  assert.deepEqual(manifest.dependencies, undefined)
  assert.deepEqual(manifest.devDependencies, undefined)
  assert.deepEqual(manifest.scripts, undefined)

  const extractRoot = mkdtempSync(join(tmpdir(), 'cordis-release-artifact-test-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', extractRoot])
    const extracted = join(extractRoot, 'package')
    const { createRuntime } = await import(pathToFileURL(join(extracted, 'dist', 'index.js')).href)
    const runtime = createRuntime({
      dir: join(extractRoot, 'profile'),
      // Connection refusal forces the artifact to use its packaged snapshot.
      baseUrl: 'http://127.0.0.1:1/api/v1',
    })
    const catalog = await runtime.catalog.list({ platform: 'web' })
    assert.equal(catalog.source, 'snapshot')
    assert.ok(catalog.items.some((item) => item.slug === 'dsh-market'))
  } finally {
    rmSync(extractRoot, { recursive: true, force: true })
  }
})
