// esbuild bundle：host（platform node）+ client（platform browser，react 外置）。
import { build } from 'esbuild'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(app, 'dist'), { recursive: true })
mkdirSync(join(app, 'dist', 'data'), { recursive: true })
await build({
  entryPoints: [join(app, 'src/index.js')],
  outfile: join(app, 'dist/index.js'),
  bundle: true, platform: 'node', format: 'esm',
  packages: 'bundle', // 工作区包全部打进 host
})
await build({
  entryPoints: [join(app, 'src/client/index.js')],
  outfile: join(app, 'dist/client.js'),
  bundle: true, platform: 'browser', format: 'esm',
  external: ['react', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings'],
})
copyFileSync(join(app, '..', '..', 'packages', 'catalog-core', 'data', 'registry-snapshot.json'), join(app, 'dist', 'data', 'registry-snapshot.json'))
console.log('built dist/index.js and dist/client.js')
