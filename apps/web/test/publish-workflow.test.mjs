import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workflowPath = fileURLToPath(new URL('../../../.github/workflows/publish.yml', import.meta.url))
const PINNED_DSH_INSTALL = 'npm install --global --ignore-scripts @deepseek-ai/dsh@0.1.0-rc.7'

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
