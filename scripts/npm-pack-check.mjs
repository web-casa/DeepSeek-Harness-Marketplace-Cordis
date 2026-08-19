// 发布前 npm pack 预检：只使用 npm 的 dry-run，不执行依赖或包脚本，也不写入 tarball。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

for (const relativeDir of packageDirs) {
  const cwd = resolve(root, relativeDir)
  const manifest = manifestAt(cwd)
  const result = spawnSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  })
  check(result.error === undefined, `${relativeDir}: npm pack could not start: ${result.error?.message || 'unknown error'}`)
  check(result.status === 0, `${relativeDir}: npm pack failed (${result.status}): ${result.stderr.trim()}`)
  let packed = []
  try { packed = JSON.parse(result.stdout) } catch { failures.push(`${relativeDir}: npm pack did not return JSON`) }
  const entry = packed[0]
  check(packed.length === 1 && entry, `${relativeDir}: expected exactly one pack result`)
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

console.log(JSON.stringify({ version: rootManifest.version, packages: report }, null, 2))
if (failures.length) {
  for (const failure of failures) console.error(`PACK CHECK FAIL: ${failure}`)
  process.exitCode = 1
}
