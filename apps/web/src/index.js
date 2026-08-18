// @cordis-mp/web host：DSH Web 插件入口。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogClient } from '@cordis-mp/catalog-core'
import { mountCatalogRoutes, mountMutationRoutes } from '@cordis-mp/web-harness'
import { DshRunner, DshPackageManagerPort } from '@cordis-mp/dsh-runner'
import { Journal } from '@cordis-mp/journal-core'
import { InstallService } from '@cordis-mp/install-core'

export const name = 'cordis-mp'
export const inject = ['webServer']

function loadSnapshot() {
  try { return JSON.parse(readFileSync(new URL('../data/registry-snapshot.json', import.meta.url), 'utf8')) }
  catch { return null }
}

function profileDir() {
  if (process.env.CORDIS_MP_PROFILE_DIR) return process.env.CORDIS_MP_PROFILE_DIR
  const home = process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
  return join(home, 'profiles', process.env.CORDIS_MP_PROFILE || 'web')
}

export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    const base = (process.env.CORDIS_RUN_API || 'https://cordis.run/api/v1').replace(/\/+$/, '')
    const catalog = new CatalogClient({ baseUrl: base, snapshot: loadSnapshot() })
    const dir = profileDir()
    const runner = new DshRunner({ dshHome: process.env.DSH_HOME, profile: process.env.CORDIS_MP_PROFILE || 'web' })
    const packageManager = new DshPackageManagerPort({ runner, profileDir: dir })
    const journal = new Journal({ journalRoot: join(dir, '.cordis-mp'), profileRoot: dir })
    const installService = new InstallService({ catalog, journal, packageManager })
    hostCtx.effect(() => {
      const a = mountCatalogRoutes(webServer, catalog)
      const b = mountMutationRoutes(webServer, { installService, platform: 'web' })
      return () => { a(); b() }
    }, 'cordis-mp: http routes')
  })
}
