const LOCAL_PLUGIN_ROUTE = '/dsh-market/registry'

function assertPluginRoute(route) {
  if (route === null) return null
  if (!/^\/(?!\/)[^\r\n]*$/.test(route)) {
    throw new Error(`CORDIS_E2E_PLUGIN_ROUTE must be an absolute local path or empty: ${JSON.stringify(route)}`)
  }
  return route
}

/**
 * Keep fixture route proof while allowing a real independent plugin to prove
 * activation through its declared DSH entry ids and a successful restart.
 */
export function resolveDshE2EOptions({ api, pluginRoute } = {}) {
  const normalizedApi = typeof api === 'string' ? api.trim() : ''
  const requestedApi = normalizedApi ? normalizedApi.replace(/\/+$/, '') : null
  const resolvedPluginRoute = pluginRoute === undefined
    ? (requestedApi ? null : LOCAL_PLUGIN_ROUTE)
    : (pluginRoute || null)
  return { requestedApi, pluginRoute: assertPluginRoute(resolvedPluginRoute) }
}
