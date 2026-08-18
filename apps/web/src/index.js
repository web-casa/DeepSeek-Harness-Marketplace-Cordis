// @cordis-mp/web host：DSH Web 插件入口。
// 只挂载只读市场路由；mutation 路由待 install-core 接入。
import { readFileSync } from 'node:fs'
import { CatalogClient } from '@cordis-mp/catalog-core'
import { mountCatalogRoutes } from '@cordis-mp/web-harness'

export const name = 'cordis-mp'
export const inject = ['webServer']

function loadSnapshot() {
  try {
    return JSON.parse(readFileSync(new URL('../data/registry-snapshot.json', import.meta.url), 'utf8'))
  } catch { return null }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    const base = (process.env.CORDIS_RUN_API || 'https://cordis.run/api/v1').replace(/\/+$/, '')
    const client = new CatalogClient({ baseUrl: base, snapshot: loadSnapshot() })
    hostCtx.effect(() => mountCatalogRoutes(webServer, client), 'cordis-mp: catalog routes')
  })
}
