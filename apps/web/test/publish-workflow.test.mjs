import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workflowPath = fileURLToPath(new URL('../../../.github/workflows/publish.yml', import.meta.url))
const PINNED_DSH_INSTALL = 'npm install --global --ignore-scripts @deepseek-ai/dsh@0.1.0-rc.7'
const NODE_24_CHECKOUT = 'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0'
const NODE_24_SETUP_NODE = 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0'
const PUBLIC_RELEASE = '@webcasa/deepseek-harness-marketplace@0.1.1'
const PUBLIC_ARTIFACT = 'webcasa-deepseek-harness-marketplace-release-candidate.tgz'

test('publish validation provisions the pinned DSH CLI before DSH smoke and E2E', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const install = workflow.indexOf(PINNED_DSH_INSTALL)
  const version = workflow.indexOf('      - name: Record DSH CLI version', install)
  const smoke = workflow.indexOf('      - name: Run DSH smoke')
  const e2e = workflow.indexOf('      - name: Run DSH install/activate/restart E2E')

  assert.ok(install >= 0, 'publish validation must install the pinned DSH CLI')
  assert.ok(version > install, 'publish validation must record the installed DSH version')
  assert.ok(smoke > version, 'DSH smoke must run only after the CLI is provisioned')
  assert.ok(e2e > smoke, 'DSH E2E must run after DSH smoke')
})

test('publish workflow uses the Node 24-compatible pinned GitHub Actions runtime', () => {
  const workflow = readFileSync(workflowPath, 'utf8')

  assert.ok(workflow.includes(NODE_24_CHECKOUT), 'publish validation must pin actions/checkout v5')
  assert.equal(
    workflow.split(NODE_24_SETUP_NODE).length - 1,
    2,
    'validation and trusted-publish jobs must pin actions/setup-node v5',
  )
  assert.ok(!workflow.includes('actions/checkout@11d5960a326750d5838078e36cf38b85af677262'), 'Node 20 checkout pin must not return')
  assert.ok(!workflow.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'), 'Node 20 setup-node pin must not return')
})

test('publish job remains behind the npm environment and OIDC identity gate', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const publish = workflow.slice(workflow.indexOf('\n  publish:'))

  assert.match(publish, /^    environment: npm$/m, 'public publication must require the npm deployment environment')
  assert.match(publish, /^      id-token: write$/m, 'public publication must use OIDC instead of an npm token')
  assert.match(publish, /^        run: npm publish .* --provenance --ignore-scripts$/m, 'publication must retain provenance and disable scripts')
  assert.ok(workflow.includes(`default: '${PUBLIC_RELEASE}'`), 'manual release default must match the approved public package')
  assert.match(publish, new RegExp(`npm publish release-artifact/${PUBLIC_ARTIFACT.replaceAll('.', '\\.')}`), 'publish job must use the reviewed artifact name')
  assert.doesNotMatch(
    publish,
    /^\s*(?:NODE_AUTH_TOKEN|NPM_TOKEN):/m,
    'publish job must not accept a long-lived npm token',
  )
})
