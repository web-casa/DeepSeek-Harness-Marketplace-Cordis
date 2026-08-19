import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshPackageManagerPort } from '../src/index.js'

const INTEGRITY = 'sha512-expected-integrity'

function lockfile({ key = 'demo@1.0.0', integrity = INTEGRITY, nested = false } = {}) {
  const resolution = nested
    ? `    resolution:\n      integrity: '${integrity}'`
    : `    resolution: {integrity: ${integrity}}`
  return `lockfileVersion: '9.0'\n\npackages:\n\n  ${key}:\n${resolution}\n\nsnapshots:\n\n  ${key}: {}\n`
}

function setup({ packageName = 'demo', version = '1.0.0', lock = lockfile() } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), 'dshpm-'))
  writeFileSync(join(profileDir, 'package.json'), '{"dependencies":{}}')
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), lock)
  mkdirSync(join(profileDir, 'node_modules', packageName), { recursive: true })
  writeFileSync(join(profileDir, 'node_modules', packageName, 'package.json'), JSON.stringify({ name: packageName, version }))
  let calls = []
  const runner = {
    pluginArgs: () => ['plugin', '--profile', 'web'],
    async run(args) { calls.push(args); return { exitCode: 0, timedOut: false, stdout: '', stderr: '', cancelled: false } },
  }
  const pm = new DshPackageManagerPort({ runner, profileDir })
  return { pm, runner, calls, profileDir }
}

test('install returns profile files and verify reads node_modules', async () => {
  const { pm, calls } = setup()
  const artifact = { packageName: 'demo', version: '1.0.0', integrity: INTEGRITY, tarball: null, registry: 'https://registry.npmjs.org' }
  const res = await pm.installVerifiedArtifact(artifact)
  assert.equal(res.exitCode, 0)
  assert.ok(res.profileFiles['package.json'])
  assert.ok(res.profileFiles['pnpm-lock.yaml'])
  assert.deepEqual(calls[0], ['plugin', '--profile', 'web', 'add', '--ignore-scripts', '--', 'demo@1.0.0'])
  assert.equal(await pm.verifyInstalled(artifact), true)
})

test('verifyInstalled rejects a missing or mismatched pnpm lockfile integrity', async () => {
  const artifact = { packageName: 'demo', version: '1.0.0', integrity: INTEGRITY }
  const mismatch = setup({ lock: lockfile({ integrity: 'sha512-wrong-integrity' }) })
  assert.equal(await mismatch.pm.verifyInstalled(artifact), false)

  const missing = setup({ lock: lockfile({ key: 'other@1.0.0' }) })
  assert.equal(await missing.pm.verifyInstalled(artifact), false)

  const absent = setup()
  rmSync(join(absent.profileDir, 'pnpm-lock.yaml'))
  assert.equal(await absent.pm.verifyInstalled(artifact), false)
})

test('verifyInstalled accepts quoted peer-suffixed v9 records with nested resolution', async () => {
  const artifact = { packageName: '@scope/demo', version: '1.0.0', integrity: INTEGRITY }
  const { pm } = setup({
    packageName: artifact.packageName,
    lock: lockfile({ key: "'@scope/demo@1.0.0(peer@2.0.0)'", nested: true }),
  })
  assert.equal(await pm.verifyInstalled(artifact), true)
})

test('verifyInstalled rejects an integrity field outside the resolution mapping', async () => {
  const artifact = { packageName: 'demo', version: '1.0.0', integrity: INTEGRITY }
  const lock = `lockfileVersion: '9.0'\n\npackages:\n\n  demo@1.0.0:\n    resolution:\n      tarball: https://registry.npmjs.org/demo/-/demo-1.0.0.tgz\n    dependencies:\n      integrity: ${INTEGRITY}\n\nsnapshots:\n\n  demo@1.0.0: {}\n`
  const { pm } = setup({ lock })
  assert.equal(await pm.verifyInstalled(artifact), false)
})

test('install failure returns no profile files', async () => {
  const { pm } = setup()
  pm.runner.run = async () => ({ exitCode: 1, timedOut: false, stdout: '', stderr: 'boom', cancelled: false })
  const res = await pm.installVerifiedArtifact({ packageName: 'demo', version: '1.0.0' })
  assert.equal(res.exitCode, 1)
  assert.deepEqual(res.profileFiles, {})
})

test('remove returns profile files', async () => {
  const { pm, calls } = setup()
  const res = await pm.remove('demo')
  assert.equal(res.exitCode, 0)
  assert.ok(res.profileFiles['package.json'])
  assert.deepEqual(calls[0], ['plugin', '--profile', 'web', 'remove', '--', 'demo'])
})
