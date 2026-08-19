import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMarketController } from '../src/client/market-controller.js'

test('controller search delegates and normalizes body', async () => {
  let params
  const api = { async catalog(p) { params = p; return { source: 'network', catalogRevision: 'r', count: 1, page: { cursor: 'opaque', hasMore: false, limit: 20 }, items: [{ slug: 'a' }], got: p } }, async detail() {}, install() {}, uninstall() {}, status() {} }
  const c = createMarketController(api)
  const res = await c.search({ q: 'x', platform: 'desktop', cursor: 'opaque', limit: 10 })
  assert.equal(res.items[0].slug, 'a')
  assert.equal(res.source, 'network')
  assert.deepEqual(params, { q: 'x', platform: 'desktop', cursor: 'opaque', limit: 10 })
})

test('apply registers settings section when slots exist', async () => {
  const regs = []
  const ctx = {
    slots: {
      inject(name, fn) { regs.push([name, fn()]) },
      register(opt) { return opt },
    },
  }
  const { apply } = await import('../src/client/index.js')
  apply(ctx)
  assert.equal(regs.length, 1)
  assert.equal(regs[0][0], 'settings.section')
  const registration = regs[0][1]
  assert.equal(registration.id, 'cordis-mp-market')
  assert.equal(registration.order, 25)
  assert.equal(registration.label(), '插件市场')
})

test('MarketLanding communicates the controlled lifecycle and catalog state', async () => {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MarketLanding } = await import('../src/client/MarketSection.js')

  const ready = renderToStaticMarkup(React.createElement(MarketLanding, {
    count: 6, loaded: true, loading: false, hasQuery: false, onBrowse() {},
  }))
  assert.match(ready, /为 Harness 建立可控的插件目录/)
  assert.match(ready, /6/)
  assert.match(ready, /个可见 Web 条目/)
  assert.match(ready, /Inspect/)
  assert.match(ready, /Pre-disable/)
  assert.match(ready, /Verify/)
  assert.match(ready, /默认不运行，直到你确认/)
  assert.match(ready, /浏览目录/)

  const retry = renderToStaticMarkup(React.createElement(MarketLanding, {
    count: 6, loaded: true, loading: false, error: { message: 'catalog unavailable' }, onBrowse() {},
  }))
  assert.match(retry, /目录需要重试/)
  assert.match(retry, /仍保留已载入条目/)
})

test('MarketSection renders search/list chrome', async () => {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MarketSection, MarketItem, DetailDialog, ErrorPanel, Pagination } = await import('../src/client/MarketSection.js')
  const controller = { async search() { return { items: [], count: 0 } } }
  const html = renderToStaticMarkup(React.createElement(MarketSection, { controller, close() {} }))
  assert.match(html, /data-testid="cordis-mp-market"/)
  assert.match(html, /搜索插件名称或 slug/)
  assert.match(html, /搜索/)
  assert.match(html, /第 1 页/)

  const item = {
    slug: 'demo', name: 'Demo', entryRevision: 'demo-rev-1', description: { zh: '中文简介', en: 'English description' }, platforms: ['web', 'desktop'],
    source: { type: 'npm', packageName: 'demo', version: '1.0.0', integrity: 'sha512-AAAA', registry: 'https://registry.npmjs.org', tarball: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz' },
    engines: { dsh: '>=0.1.0' },
  }
  const itemHtml = renderToStaticMarkup(React.createElement(MarketItem, { item, pending: false, busy: false, onInstall() {}, onActivate() {}, onDetail() {} }))
  assert.match(itemHtml, /WEB/)
  assert.match(itemHtml, /DESKTOP/)
  assert.match(itemHtml, /详情/)
  assert.match(itemHtml, /安装/)

  const browseOnlyHtml = renderToStaticMarkup(React.createElement(MarketItem, { item: { ...item, platforms: ['unknown'] }, pending: false, busy: false, onInstall() {}, onActivate() {}, onDetail() {} }))
  assert.match(browseOnlyHtml, /disabled=""/)

  const detailHtml = renderToStaticMarkup(React.createElement(DetailDialog, { item: { ...item, homepage: 'http://homepage.example/demo', screenshots: ['https://cdn.cordis.run/screenshots/demo/1.webp', 'https://untrusted.example/demo.webp'] }, loading: false, error: null, onClose() {} }))
  assert.match(detailHtml, /cdn\.cordis\.run/)
  assert.doesNotMatch(detailHtml, /untrusted\.example/)
  assert.doesNotMatch(detailHtml, /homepage\.example/)
  assert.match(detailHtml, /referrerpolicy="no-referrer"|referrerPolicy="no-referrer"/)
  const errorHtml = renderToStaticMarkup(React.createElement(ErrorPanel, { error: { message: '失败', code: 'BAD', status: 502, requestId: 'req-1' } }))
  assert.match(errorHtml, /错误详情/)
  assert.match(errorHtml, /req-1/)
  const paginationHtml = renderToStaticMarkup(React.createElement(Pagination, { page: { cursor: 'opaque', hasMore: true, limit: 12 }, pageNumber: 2, hasPrevious: true, loading: false, onPrevious() {}, onNext() {} }))
  assert.match(paginationHtml, /上一页/)
  assert.match(paginationHtml, /下一页/)
})
