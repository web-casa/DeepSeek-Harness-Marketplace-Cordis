// 生成可独立 dsh plugin add 的 smoke tarball：去 workspace 依赖、只含 dist。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
const pack = mkdtempSync(join(tmpdir(), 'cordis-web-pack-'))
const pkgDir = join(pack, 'package')
mkdirSync(pkgDir, { recursive: true })
const smokePkg = { ...pkg, dependencies: {}, devDependencies: {}, scripts: {}, main: 'dist/index.js', exports: { '.': './dist/index.js', './client': './dist/client.js', './package.json': './package.json' } }
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(smokePkg, null, 2) + '\n')
copyFileSync(join(app, 'cordis.patch.yml'), join(pkgDir, 'cordis.patch.yml'))
copyFileSync(join(app, 'dist/index.js'), join(pkgDir, 'index.js'))
copyFileSync(join(app, 'dist/client.js'), join(pkgDir, 'client.js'))
mkdirSync(join(pkgDir, 'data'), { recursive: true })
copyFileSync(join(app, 'dist/data/registry-snapshot.json'), join(pkgDir, 'data/registry-snapshot.json'))
// 修正 package.json paths：main 是 dist/index.js，但我们 flatten 到根
smokePkg.main = 'index.js'; smokePkg.exports = { '.': './index.js', './client': './client.js', './package.json': './package.json' }
writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(smokePkg, null, 2) + '\n')
const out = join(pack, 'cordis-mp-web-smoke.tgz')
execFileSync('tar', ['-czf', out, '-C', pack, 'package'])
console.log(out)
