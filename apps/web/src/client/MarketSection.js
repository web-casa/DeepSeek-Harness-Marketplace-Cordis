// settings.section 市场页组件：无 JSX，直接 React.createElement，便于无构建使用。
import React from 'react'

export function MarketSection({ close, controller }) {
  const [q, setQ] = React.useState('')
  const [items, setItems] = React.useState([])
  const [count, setCount] = React.useState(0)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [busySlug, setBusySlug] = React.useState(null)
  const [pendingSlug, setPendingSlug] = React.useState(null)

  async function load(value = q) {
    setLoading(true); setError(null)
    try {
      const res = await controller.search({ q: value, platform: 'web' })
      setItems(res.items); setCount(res.count)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  React.useEffect(() => { load('') }, [])

  async function install(item) {
    if (globalThis.confirm && !globalThis.confirm(`确认安装插件 ${item.name}？安装后默认禁用，需手动启用。`)) return
    setBusySlug(item.slug)
    try { await controller.install(item.slug, item.entryRevision); setPendingSlug(item.slug) } catch (e) { setError(e.message) } finally { setBusySlug(null) }
  }
  async function activate(item) {
    setBusySlug(item.slug)
    try { await controller.activate(item.slug); setPendingSlug(null) } catch (e) { setError(e.message) } finally { setBusySlug(null) }
  }

  return React.createElement('div', { className: 'cordis-mp-market', 'data-testid': 'cordis-mp-market' },
    React.createElement('div', { className: 'cordis-mp-market-head' },
      React.createElement('input', { value: q, placeholder: '搜索插件', onChange: e => setQ(e.target.value), onKeyDown: e => { if (e.key === 'Enter') load() } }),
      React.createElement('button', { onClick: () => load(), disabled: loading }, loading ? '加载中…' : '搜索'),
      React.createElement('span', { className: 'cordis-mp-count' }, String(count)),
    ),
    error ? React.createElement('div', { className: 'cordis-mp-error' }, error) : null,
    React.createElement('ul', { className: 'cordis-mp-list' },
      (items || []).map(item => React.createElement('li', { key: item.slug, className: 'cordis-mp-item' },
        React.createElement('div', { className: 'cordis-mp-item-main' },
          React.createElement('span', { className: 'cordis-mp-name' }, item.name),
          React.createElement('span', { className: 'cordis-mp-desc' }, item.description?.zh || ''),
          React.createElement('span', { className: 'cordis-mp-platforms' }, (item.platforms || []).join('/')),
        ),
        pendingSlug === item.slug
          ? React.createElement('button', { disabled: busySlug === item.slug, onClick: () => activate(item) }, busySlug === item.slug ? '启用中…' : '启用')
          : React.createElement('button', { disabled: busySlug === item.slug, onClick: () => install(item) }, busySlug === item.slug ? '安装中…' : '安装'),
      )),
    ),
  )
}
