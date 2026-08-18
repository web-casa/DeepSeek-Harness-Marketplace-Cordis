// @cordis-mp/web host：DSH Web 插件入口。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogClient } from '@cordis-mp/catalog-core'
import { mountCatalogRoutes, mountMutationRoutes, mountSessionRoute, MutationGuard } from '@cordis-mp/web-harness'
import { DshRunner, DshPackageManagerPort, DshActivationPort } from '@cordis-mp/dsh-runner'
import { Journal } from '@cordis-mp/journal-core'
import { InstallService } from '@cordis-mp/install-core'
import { HttpArtifactInspector } from '@cordis-mp/inspect-core'

export const name = 'cordis-mp'
export const inject = ['webServer']

function loadSnapshot() {
  try { return JSON.parse(readFileSync(new URL('../data/registry-snapshot.json', import.meta.url), 'utf8')) }
  catch { return null }
}

export function createRuntime({ dir = null, baseUrl = null, dshHome = null, profile = null } = {}) {
  const resolvedDir = dir || (() => {
    if (process.env.CORDIS_MP_PROFILE_DIR) return process.env.CORDIS_MP_PROFILE_DIR
    const home = dshHome || process.env.DSH_HOME || join(process.env.HOME || '.', '.dsh')
    return join(home, 'profiles', profile || process.env.CORDIS_MP_PROFILE || 'web')
  })()
  const base = (baseUrl || process.env.CORDIS_RUN_API || 'https://cordis.run/api/v1').replace(/\/+$/, '')
  const catalog = new CatalogClient({ baseUrl: base, snapshot: loadSnapshot() })
  const runner = new DshRunner({ dshHome: dshHome ?? process.env.DSH_HOME, profile: profile ?? process.env.CORDIS_MP_PROFILE ?? 'web' })
  const packageManager = new DshPackageManagerPort({ runner, profileDir: resolvedDir })
  const journal = new Journal({ journalRoot: join(resolvedDir, '.cordis-mp'), profileRoot: resolvedDir })
  const activation = new DshActivationPort({ patchPath: join(resolvedDir, 'cordis.patch.yml') })
  const inspect = new HttpArtifactInspector({ cacheDir: join(resolvedDir, '.cordis-mp', 'artifacts') })
  const installService = new InstallService({ catalog, journal, packageManager, activation, inspect, pendingPath: join(resolvedDir, '.cordis-mp') })
  return { dir: resolvedDir, base, catalog, journal, packageManager, activation, inspect, installService }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    const { installService, catalog } = createRuntime()
    const guard = new MutationGuard()
    hostCtx.effect(() => {
      const a = mountCatalogRoutes(webServer, catalog)
      const b = mountMutationRoutes(webServer, { installService, platform: 'web', guard })
      const c = mountSessionRoute(webServer, guard)
      return () => { a(); b(); c() }
    }, 'cordis-mp: http routes')
  })
}
