// 生成可独立 dsh plugin add 的 smoke / registry release-candidate tarball。
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createReleaseArtifact } from './release-artifact.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
console.log(createReleaseArtifact(app))
