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

  const item = { slug: 'demo', name: 'Demo', description: { zh: '中文简介', en: 'English description' }, platforms: ['web', 'desktop'], source: { packageName: 'demo', version: '1.0.0' }, engines: { dsh: '>=0.1.0' } }
  const itemHtml = renderToStaticMarkup(React.createElement(MarketItem, { item, pending: false, busy: false, onInstall() {}, onActivate() {}, onDetail() {} }))
  assert.match(itemHtml, /WEB/)
  assert.match(itemHtml, /DESKTOP/)
  assert.match(itemHtml, /详情/)

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
