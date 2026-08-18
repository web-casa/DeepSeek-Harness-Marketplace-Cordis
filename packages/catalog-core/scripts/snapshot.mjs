// 从 CORDIS_RUN_API 拉取 /plugins 并生成内置快照。
// 用法：CORDIS_RUN_API=http://127.0.0.1:<port>/api/v1 node scripts/snapshot.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { validateCatalog } from '../src/schema.mjs'

const base = (process.env.CORDIS_RUN_API || 'https://cordis.run/api/v1').replace(/\/+$/, '')
const res = await fetch(`${base}/plugins`, { headers: { accept: 'application/json' }, redirect: 'error' })
if (!res.ok) throw new Error(`snapshot fetch failed: HTTP ${res.status}`)
const body = validateCatalog(JSON.parse(await res.text()))
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'registry-snapshot.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ ...body, snapshotGeneratedAt: new Date().toISOString(), sourceUrl: `${base}/plugins` }, null, 2) + '\n')
console.log(`snapshot written: ${out}`)
