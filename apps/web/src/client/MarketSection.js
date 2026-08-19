// settings.section 市场页组件：无 JSX，直接 React.createElement，便于无构建使用。
import React from 'react'
import { installability } from '@cordis-mp/catalog-core'

const h = React.createElement
const PAGE_SIZE = 12

const styles = {
  root: { color: '#15251e', background: '#f4f0e8', border: '1px solid #c9c3b5', borderRadius: 14, padding: 20, fontFamily: 'ui-serif, Georgia, serif', boxShadow: '0 16px 36px rgba(21, 37, 30, 0.09)' },
  eyebrow: { color: '#5b6d63', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.12em', textTransform: 'uppercase' },
  heading: { margin: '4px 0 14px', fontSize: 26, lineHeight: 1.1, letterSpacing: '-0.035em' },
  searchRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  input: { flex: '1 1 220px', minWidth: 0, border: '1px solid #a8b1a7', borderRadius: 8, background: '#fffdf8', color: '#15251e', padding: '10px 12px', font: 'inherit' },
  primaryButton: { border: 0, borderRadius: 8, background: '#176b4a', color: '#fffdf8', padding: '10px 14px', font: 'inherit', cursor: 'pointer' },
  quietButton: { border: '1px solid #a8b1a7', borderRadius: 8, background: 'transparent', color: '#1c4031', padding: '8px 11px', font: 'inherit', cursor: 'pointer' },
  count: { marginLeft: 'auto', color: '#5b6d63', fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  list: { listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gap: 9 },
  card: { contentVisibility: 'auto', containIntrinsicSize: '0 144px', border: '1px solid #d8d1c3', borderRadius: 10, background: '#fffdf8', padding: 14, display: 'grid', gap: 12 },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  name: { fontSize: 17, lineHeight: 1.15, fontWeight: 700 },
  description: { marginTop: 5, color: '#526259', fontSize: 14, lineHeight: 1.45 },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9 },
  badge: { borderRadius: 999, padding: '3px 7px', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.06em', fontWeight: 700 },
  actions: { display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid #d8d1c3', fontSize: 13 },
  error: { marginTop: 14, padding: 12, border: '1px solid #b54e3a', borderRadius: 9, color: '#722d21', background: '#fff4ee', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(17, 28, 23, 0.56)' },
  dialog: { width: 'min(760px, 100%)', maxHeight: 'min(760px, calc(100vh - 36px))', overflow: 'auto', borderRadius: 14, border: '1px solid #d8d1c3', background: '#fffdf8', color: '#15251e', padding: 20, boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)' },
  dialogHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  screenshots: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 16 },
  screenshot: { width: '100%', borderRadius: 8, border: '1px solid #d8d1c3', background: '#e7e2d8', aspectRatio: '16 / 9', objectFit: 'cover' },
}

function errorInfo(error) {
  return {
    message: error?.message || '请求失败，请稍后重试。',
    code: error?.code || null,
    status: Number.isInteger(error?.status) ? error.status : null,
    requestId: error?.requestId || null,
    retryAfter: error?.retryAfter ?? null,
  }
}

function externalUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

function screenshotUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'cdn.cordis.run' ? url.href : null
  } catch { return null }
}

function canInstall(item) {
  return installability(item, 'web').installable
}

export function PlatformBadges({ platforms = [] }) {
  const labels = platforms.length ? platforms : ['unknown']
  return h('div', { className: 'cordis-mp-platforms', style: styles.badgeRow }, labels.map(platform => {
    const tone = platform === 'web'
      ? { background: '#d5eee2', color: '#176b4a' }
      : platform === 'desktop'
        ? { background: '#dbe6f7', color: '#244f84' }
        : { background: '#ebe7de', color: '#62625d' }
    return h('span', { key: platform, className: `cordis-mp-platform-badge cordis-mp-platform-${platform}`, style: { ...styles.badge, ...tone } }, platform.toUpperCase())
  }))
}

export function ErrorPanel({ error, onDismiss }) {
  if (!error) return null
  const fields = [
    ['代码', error.code],
    ['HTTP', error.status],
    ['Request ID', error.requestId],
    ['重试秒数', error.retryAfter],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
  return h('section', { className: 'cordis-mp-error', role: 'alert', style: styles.error },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
      h('strong', null, error.message),
      onDismiss ? h('button', { type: 'button', onClick: onDismiss, style: { ...styles.quietButton, padding: '2px 7px', border: 0 } }, '关闭') : null,
    ),
    fields.length ? h('details', { style: { marginTop: 8 } },
      h('summary', { style: { cursor: 'pointer' } }, '错误详情'),
      h('dl', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: '8px 0 0' } }, fields.flatMap(([label, value]) => [h('dt', { key: `${label}-label` }, label), h('dd', { key: `${label}-value`, style: { margin: 0, overflowWrap: 'anywhere' } }, String(value))])),
    ) : null,
  )
}

export function Pagination({ page, pageNumber, hasPrevious, loading, onPrevious, onNext }) {
  return h('nav', { className: 'cordis-mp-pagination', 'aria-label': '市场分页', style: styles.pagination },
    h('button', { type: 'button', disabled: loading || !hasPrevious, onClick: onPrevious, style: styles.quietButton }, '上一页'),
    h('span', { className: 'cordis-mp-page-status', style: { color: '#5b6d63' } }, `第 ${pageNumber} 页 · 每页 ${page?.limit || PAGE_SIZE} 个`),
    h('button', { type: 'button', disabled: loading || !page?.hasMore || typeof page?.cursor !== 'string', onClick: onNext, style: styles.quietButton }, '下一页'),
  )
}

export function MarketItem({ item, pending, busy, onInstall, onActivate, onDetail }) {
  const installable = canInstall(item)
  const description = item.description?.zh || item.description?.en || '暂无简介'
  return h('li', { className: 'cordis-mp-item', style: { ...styles.card, opacity: installable ? 1 : 0.7 } },
    h('div', { style: styles.cardTop },
      h('div', null,
        h('div', { className: 'cordis-mp-name', style: styles.name }, item.name),
        h('div', { className: 'cordis-mp-desc', style: styles.description }, description),
        h(PlatformBadges, { platforms: item.platforms }),
      ),
      h('div', { style: styles.actions },
        h('button', { type: 'button', onClick: () => onDetail(item), style: styles.quietButton }, '详情'),
        pending
          ? h('button', { type: 'button', disabled: busy, onClick: () => onActivate(item), style: styles.primaryButton }, busy ? '启用中…' : '启用')
          : h('button', { type: 'button', disabled: busy || !installable, onClick: () => onInstall(item), style: styles.primaryButton }, item.blocked ? '已阻止' : item.deprecated ? '已弃用' : busy ? '安装中…' : '安装'),
      ),
    ),
  )
}

export function DetailDialog({ item, loading, error, onClose }) {
  if (!item && !loading && !error) return null
  const homepage = externalUrl(item?.homepage)
  const description = item?.description?.zh || item?.description?.en || '正在获取插件详情…'
  const screenshots = Array.isArray(item?.screenshots)
    ? item.screenshots.map(screenshotUrl).filter(Boolean)
    : []
  return h('div', { className: 'cordis-mp-detail-overlay', style: styles.overlay },
    h('section', { className: 'cordis-mp-detail-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': item?.name || '插件详情', style: styles.dialog },
      h('div', { style: styles.dialogHead },
        h('div', null,
          h('div', { style: styles.eyebrow }, item?.slug || '插件详情'),
          h('h2', { style: { ...styles.heading, marginBottom: 4 } }, item?.name || '加载中…'),
          h(PlatformBadges, { platforms: item?.platforms || [] }),
        ),
        h('button', { type: 'button', onClick: onClose, style: styles.quietButton, 'aria-label': '关闭详情' }, '关闭'),
      ),
      error ? h(ErrorPanel, { error }) : null,
      loading ? h('p', { style: { color: '#5b6d63' } }, '正在加载详情…') : h('div', null,
        h('p', { style: { ...styles.description, marginTop: 14 } }, description),
        item?.description?.en && item.description.en !== description ? h('p', { style: { ...styles.description, fontStyle: 'italic' } }, item.description.en) : null,
        h('dl', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: '14px 0 0', fontSize: 13 } },
          h('dt', null, '来源'), h('dd', { style: { margin: 0 } }, item?.source?.packageName || '—'),
          h('dt', null, '版本'), h('dd', { style: { margin: 0 } }, item?.source?.version || '—'),
          h('dt', null, '引擎'), h('dd', { style: { margin: 0 } }, item?.engines?.dsh || '—'),
          h('dt', null, '状态'), h('dd', { style: { margin: 0 } }, item?.blocked ? '已阻止' : item?.deprecated ? '已弃用' : '可浏览'),
        ),
        homepage ? h('p', { style: { marginTop: 14 } }, h('a', { href: homepage, target: '_blank', rel: 'noreferrer', style: { color: '#176b4a' } }, '访问项目主页 ↗')) : null,
        screenshots.length ? h('div', { className: 'cordis-mp-screenshots', style: styles.screenshots }, screenshots.map((url, index) => h('img', { key: url, src: url, alt: `${item?.name || '插件'} 截图 ${index + 1}`, referrerPolicy: 'no-referrer', loading: 'lazy', style: styles.screenshot }))) : h('p', { style: { ...styles.description, marginTop: 16 } }, '该插件暂未提供截图。'),
      ),
    ),
  )
}

export function MarketSection({ controller }) {
  const [query, setQuery] = React.useState('')
  const [activeQuery, setActiveQuery] = React.useState('')
  const [items, setItems] = React.useState([])
  const [count, setCount] = React.useState(0)
  const [page, setPage] = React.useState({ cursor: null, hasMore: false, limit: PAGE_SIZE })
  const [currentCursor, setCurrentCursor] = React.useState(null)
  const [cursorHistory, setCursorHistory] = React.useState([])
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [busySlug, setBusySlug] = React.useState(null)
  const [pendingBySlug, setPendingBySlug] = React.useState({})
  const [detail, setDetail] = React.useState(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState(null)
  const listRequestId = React.useRef(0)
  const detailRequestId = React.useRef(0)

  const load = React.useCallback(async ({ nextQuery, cursor = null, history = [] }) => {
    const requestId = ++listRequestId.current
    setLoading(true); setError(null)
    try {
      const result = await controller.search({ q: nextQuery, platform: 'web', cursor, limit: PAGE_SIZE })
      if (requestId !== listRequestId.current) return
      setItems(Array.isArray(result.items) ? result.items : [])
      setCount(Number.isInteger(result.count) ? result.count : 0)
      setPage(result.page || { cursor: null, hasMore: false, limit: PAGE_SIZE })
      setCurrentCursor(cursor)
      setCursorHistory(history)
      setActiveQuery(nextQuery)
    } catch (nextError) {
      if (requestId === listRequestId.current) setError(errorInfo(nextError))
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }, [controller])

  React.useEffect(() => { void load({ nextQuery: '', cursor: null, history: [] }) }, [load])
  React.useEffect(() => {
    if (typeof controller.status !== 'function') return undefined
    let active = true
    void controller.status().then(status => {
      if (!active) return
      const pending = Array.isArray(status?.pending) ? status.pending : []
      const recovered = Object.fromEntries(pending
        .map(item => typeof item === 'string' ? item : item?.slug)
        .filter(slug => typeof slug === 'string' && slug.length > 0)
        .map(slug => [slug, true]))
      setPendingBySlug(previous => ({ ...previous, ...recovered }))
    }).catch(nextError => {
      if (active) setError(errorInfo(nextError))
    })
    return () => { active = false }
  }, [controller])

  function search() { void load({ nextQuery: query, cursor: null, history: [] }) }
  function nextPage() {
    if (page.hasMore && typeof page.cursor === 'string') void load({ nextQuery: activeQuery, cursor: page.cursor, history: [...cursorHistory, currentCursor] })
  }
  function previousPage() {
    if (!cursorHistory.length) return
    const previousCursor = cursorHistory[cursorHistory.length - 1]
    void load({ nextQuery: activeQuery, cursor: previousCursor, history: cursorHistory.slice(0, -1) })
  }
  async function install(item) {
    if (!canInstall(item)) return
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`确认安装插件 ${item.name}？安装后默认禁用，需手动启用。`)) return
    setBusySlug(item.slug); setError(null)
    try {
      await controller.install(item.slug, item.entryRevision)
      setPendingBySlug(previous => ({ ...previous, [item.slug]: true }))
    } catch (nextError) { setError(errorInfo(nextError)) } finally { setBusySlug(null) }
  }
  async function activate(item) {
    setBusySlug(item.slug); setError(null)
    try {
      await controller.activate(item.slug)
      setPendingBySlug(previous => { const next = { ...previous }; delete next[item.slug]; return next })
    } catch (nextError) { setError(errorInfo(nextError)) } finally { setBusySlug(null) }
  }
  async function openDetail(item) {
    const requestId = ++detailRequestId.current
    setDetail(item); setDetailLoading(true); setDetailError(null)
    try {
      const result = await controller.detail(item.slug)
      if (requestId === detailRequestId.current) setDetail(result)
    } catch (nextError) {
      if (requestId === detailRequestId.current) setDetailError(errorInfo(nextError))
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false)
    }
  }

  return h('div', { className: 'cordis-mp-market', 'data-testid': 'cordis-mp-market', style: styles.root },
    h('div', { className: 'cordis-mp-market-head' },
      h('div', { style: styles.eyebrow }, 'Cordis.run / Web'),
      h('h1', { style: styles.heading }, '插件市场'),
      h('div', { style: styles.searchRow },
        h('input', { value: query, placeholder: '搜索插件名称或 slug', 'aria-label': '搜索插件', onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === 'Enter') search() }, style: styles.input }),
        h('button', { type: 'button', onClick: search, disabled: loading, style: styles.primaryButton }, loading ? '加载中…' : '搜索'),
        h('span', { className: 'cordis-mp-count', style: styles.count, 'aria-live': 'polite' }, `${count} 个结果`),
      ),
    ),
    h(ErrorPanel, { error, onDismiss: () => setError(null) }),
    h('ul', { className: 'cordis-mp-list', style: styles.list }, items.map(item => h(MarketItem, { key: item.slug, item, pending: pendingBySlug[item.slug] === true, busy: busySlug !== null, onInstall: install, onActivate: activate, onDetail: openDetail }))),
    !loading && items.length === 0 ? h('p', { style: { ...styles.description, textAlign: 'center', padding: '22px 0' } }, activeQuery ? '没有匹配的插件。' : '暂无可展示的 Web 插件。') : null,
    h(Pagination, { page, pageNumber: cursorHistory.length + 1, hasPrevious: cursorHistory.length > 0, loading, onPrevious: previousPage, onNext: nextPage }),
    h(DetailDialog, { item: detail, loading: detailLoading, error: detailError, onClose: () => { detailRequestId.current++; setDetail(null); setDetailError(null) } }),
  )
}
