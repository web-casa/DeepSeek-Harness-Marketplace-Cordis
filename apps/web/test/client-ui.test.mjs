import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMarketController } from '../src/client/market-controller.js'

test('controller search delegates and normalizes body', async () => {
  const api = { async catalog(p) { return { source: 'network', catalogRevision: 'r', count: 1, page: { cursor: '1', hasMore: false, limit: 20 }, items: [{ slug: 'a' }], got: p } }, async detail() {}, install() {}, uninstall() {}, status() {} }
  const c = createMarketController(api)
  const res = await c.search({ q: 'x', platform: 'desktop' })
  assert.equal(res.items[0].slug, 'a')
  assert.equal(res.source, 'network')
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
  const { MarketSection } = await import('../src/client/MarketSection.js')
  const controller = { async search() { return { items: [], count: 0 } } }
  const html = renderToStaticMarkup(React.createElement(MarketSection, { controller, close() {} }))
  assert.match(html, /data-testid="cordis-mp-market"/)
  assert.match(html, /搜索插件/)
  assert.match(html, /搜索/)
})
