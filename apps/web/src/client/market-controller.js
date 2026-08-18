// 市场 UI 的数据控制器：全部副作用收敛到 createMarketApi。
export function createMarketController(api) {
  return {
    async search({ q = '', platform = 'web', page = 1, perPage = 20 } = {}) {
      const body = await api.catalog({ q, platform, page, perPage })
      return { source: body.source, catalogRevision: body.catalogRevision, count: body.count, page: body.page, items: body.items }
    },
    async detail(slug) {
      const body = await api.detail(slug)
      return body.plugin
    },
    install(slug, entryRevision) { return api.install({ slug, entryRevision }) },
    uninstall(name) { return api.uninstall({ name }) },
    status() { return api.status() },
  }
}
