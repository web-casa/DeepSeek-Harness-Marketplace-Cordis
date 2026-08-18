import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DshPackageManagerPort } from '../src/index.js'

function setup() {
  const profileDir = mkdtempSync(join(tmpdir(), 'dshpm-'))
  writeFileSync(join(profileDir, 'package.json'), '{"dependencies":{}}')
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfile: 1\n')
  mkdirSync(join(profileDir, 'node_modules', 'demo'), { recursive: true })
  writeFileSync(join(profileDir, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
  let calls = []
  const runner = {
    pluginArgs: () => ['plugin', '--profile', 'web'],
    async run(args) { calls.push(args); return { exitCode: 0, timedOut: false, stdout: '', stderr: '', cancelled: false } },
  }
  const pm = new DshPackageManagerPort({ runner, profileDir })
  return { pm, runner, calls }
}

test('install returns profile files and verify reads node_modules', async () => {
  const { pm, calls } = setup()
  const artifact = { packageName: 'demo', version: '1.0.0', integrity: 'sha512-AAAA', tarball: null, registry: 'https://registry.npmjs.org' }
  const res = await pm.installVerifiedArtifact(artifact)
  assert.equal(res.exitCode, 0)
  assert.ok(res.profileFiles['package.json'])
  assert.ok(res.profileFiles['pnpm-lock.yaml'])
  assert.deepEqual(calls[0], ['plugin', '--profile', 'web', 'add', 'demo@1.0.0', '--ignore-scripts'])
  assert.equal(await pm.verifyInstalled(artifact), true)
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
  assert.equal(calls[0][4], 'demo')
})
