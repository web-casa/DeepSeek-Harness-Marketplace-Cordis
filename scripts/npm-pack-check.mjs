// 发布前 npm pack 预检：只使用 npm 的 dry-run，不执行依赖或包脚本，也不写入 tarball。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createReleaseArtifact, RELEASE_ARTIFACT_FILES } from '../apps/web/scripts/release-artifact.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageDirs = [
  'packages/catalog-core',
  'packages/dsh-runner',
  'packages/inspect-core',
  'packages/install-core',
  'packages/journal-core',
  'packages/web-harness',
  'apps/web',
]
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const rootManifest = manifestAt(root)
const failures = []
const report = []

function manifestAt(dir) {
  return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
}

function check(condition, message) {
  if (!condition) failures.push(message)
}

function packDryRun(cwd, label) {
  const result = spawnSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })
  check(result.error === undefined, `${label}: npm pack could not start: ${result.error?.message || 'unknown error'}`)
  check(result.status === 0, `${label}: npm pack failed (${result.status}): ${result.stderr.trim()}`)
  let packed = []
  try { packed = JSON.parse(result.stdout) } catch { failures.push(`${label}: npm pack did not return JSON`) }
  const entry = packed[0]
  check(packed.length === 1 && entry, `${label}: expected exactly one pack result`)
  return entry
}

for (const relativeDir of packageDirs) {
  const cwd = resolve(root, relativeDir)
  const manifest = manifestAt(cwd)
  const entry = packDryRun(cwd, relativeDir)
  if (!entry) continue
  check(entry.name === manifest.name, `${relativeDir}: packed name differs from manifest`)
  check(entry.version === manifest.version, `${relativeDir}: packed version differs from manifest`)
  check(manifest.version === rootManifest.version, `${relativeDir}: version ${manifest.version} differs from root ${rootManifest.version}`)
  check(Array.isArray(entry.files) && entry.files.length > 0, `${relativeDir}: tarball would be empty`)
  check(entry.files.every(file => !file.path.startsWith('node_modules/') && !file.path.startsWith('.git/')), `${relativeDir}: tarball includes an ignored implementation directory`)
  const workspaceDependencies = Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
    .map(([name]) => name)
  report.push({
    package: entry.id,
    private: manifest.private === true,
    entryCount: entry.entryCount,
    size: entry.size,
    integrity: entry.integrity,
    workspaceDependencies,
  })
}

// The raw workspace package remains intentionally private and contains
// workspace:* dependencies. Validate the generated release candidate too, so
// an eventual npm publish uses the exact standalone layout that DSH smoke/E2E
// exercise rather than the raw workspace manifest.
const webApp = resolve(root, 'apps/web')
const build = spawnSync(process.execPath, [resolve(webApp, 'scripts/build.mjs')], {
  encoding: 'utf8',
  timeout: 60_000,
})
check(build.error === undefined, `apps/web release candidate: build could not start: ${build.error?.message || 'unknown error'}`)
check(build.status === 0, `apps/web release candidate: build failed (${build.status}): ${build.stderr.trim()}`)
if (build.status === 0) {
  const unpack = mkdtempSync(join(tmpdir(), 'cordis-npm-pack-check-'))
  try {
    const artifact = createReleaseArtifact(webApp)
    const extract = spawnSync('tar', ['-xzf', artifact, '-C', unpack], { encoding: 'utf8', timeout: 60_000 })
    check(extract.error === undefined, `apps/web release candidate: tar extract could not start: ${extract.error?.message || 'unknown error'}`)
    check(extract.status === 0, `apps/web release candidate: tar extract failed (${extract.status}): ${extract.stderr.trim()}`)
    if (extract.status === 0) {
      const candidateDir = join(unpack, 'package')
      const manifest = manifestAt(candidateDir)
      const entry = packDryRun(candidateDir, 'apps/web release candidate')
      if (entry) {
        check(manifest.private === false, 'apps/web release candidate: manifest must be publishable while source workspace stays private')
        check(entry.name === manifest.name, 'apps/web release candidate: packed name differs from manifest')
        check(entry.version === manifest.version, 'apps/web release candidate: packed version differs from manifest')
        check(manifest.version === rootManifest.version, `apps/web release candidate: version ${manifest.version} differs from root ${rootManifest.version}`)
        const paths = new Set(entry.files.map(file => file.path))
        for (const path of RELEASE_ARTIFACT_FILES) {
          check(paths.has(path), `apps/web release candidate: npm pack omits ${path}`)
        }
        check(!paths.has('index.js'), 'apps/web release candidate: host entry must remain dist/index.js for snapshot fallback')
        check(manifest.dependencies === undefined && manifest.devDependencies === undefined, 'apps/web release candidate: workspace dependencies leaked into package')
        report.push({
          package: entry.id,
          private: false,
          releaseCandidate: true,
          entryCount: entry.entryCount,
          size: entry.size,
          localPackIntegrity: entry.integrity,
          workspaceDependencies: [],
        })
      }
    }
  } finally {
    rmSync(unpack, { recursive: true, force: true })
  }
}

console.log(JSON.stringify({ version: rootManifest.version, packages: report }, null, 2))
if (failures.length) {
  for (const failure of failures) console.error(`PACK CHECK FAIL: ${failure}`)
  process.exitCode = 1
}
