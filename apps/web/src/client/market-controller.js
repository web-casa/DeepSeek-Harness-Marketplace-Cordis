// 市场 UI 的数据控制器：全部副作用收敛到 createMarketApi。
export function createMarketController(api) {
  return {
    async search({ q = '', platform = 'web', cursor = undefined, limit = 20, page = undefined, perPage = undefined } = {}) {
      const params = { q, platform }
      if (page !== undefined || perPage !== undefined) {
        params.page = page ?? 1
        params.perPage = perPage ?? limit
      } else {
        params.cursor = cursor
        params.limit = limit
      }
      const body = await api.catalog(params)
      return { source: body.source, catalogRevision: body.catalogRevision, count: body.count, page: body.page, categories: body.categories, items: body.items }
    },
    async detail(slug) {
      const body = await api.detail(slug)
      return body.plugin
    },
    install(slug, entryRevision) { return api.install({ slug, entryRevision }) },
    activate(slug) { return api.activate({ slug }) },
    uninstall(name) { return api.uninstall({ name }) },
    status() { return api.status() },
  }
}
