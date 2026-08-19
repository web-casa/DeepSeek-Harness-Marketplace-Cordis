import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  RELEASE_ARTIFACT_FILES,
  RELEASE_DSH_ENGINE,
  releaseManifestProblem,
} from '../scripts/release-artifact.mjs'

const app = dirname(fileURLToPath(import.meta.url))
const buildScript = join(app, '..', 'scripts', 'build.mjs')
const packScript = join(app, '..', 'scripts', 'pack-smoke.mjs')

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
