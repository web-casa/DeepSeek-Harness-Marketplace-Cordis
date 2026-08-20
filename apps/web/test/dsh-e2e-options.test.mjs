import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDshE2EOptions } from '../../../scripts/lib/dsh-e2e-options.mjs'

test('fixture E2E keeps its explicit local plugin route', () => {
  assert.deepEqual(resolveDshE2EOptions(), {
    requestedApi: null,
    pluginRoute: '/dsh-market/registry',
  })
})

test('external E2E uses config and restart evidence without inventing a plugin route', () => {
  assert.deepEqual(resolveDshE2EOptions({ api: 'https://cordis.run/api/v1/' }), {
    requestedApi: 'https://cordis.run/api/v1',
    pluginRoute: null,
  })
  assert.equal(resolveDshE2EOptions({ api: ' https://cordis.run/api/v1/ ' }).requestedApi, 'https://cordis.run/api/v1')
  assert.equal(resolveDshE2EOptions({ api: 'https://cordis.run/api/v1', pluginRoute: '' }).pluginRoute, null)
})

test('explicit route is constrained to a local absolute path', () => {
  assert.equal(resolveDshE2EOptions({ pluginRoute: '/plugin/health' }).pluginRoute, '/plugin/health')
  assert.throws(() => resolveDshE2EOptions({ pluginRoute: 'https://example.test/plugin' }), /absolute local path/)
  assert.throws(() => resolveDshE2EOptions({ pluginRoute: '//example.test/plugin' }), /absolute local path/)
})
