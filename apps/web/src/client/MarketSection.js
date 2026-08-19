// settings.section 市场页组件：无 JSX，直接 React.createElement，便于无构建使用。
import React from 'react'
import { installability } from '@cordis-mp/catalog-core'

const h = React.createElement
const PAGE_SIZE = 12
const DISPLAY_FONT = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif"
const BODY_FONT = "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
const MONO_FONT = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"

const INSTALL_PATH = [
  ['01', 'Inspect', '校验包与完整性'],
  ['02', 'Pre-disable', '先停用旧入口'],
  ['03', 'Install', '写入受控事务'],
  ['04', 'Verify', '复核 lockfile'],
  ['05', 'Pending', '默认保持禁用'],
  ['06', 'Activate', '由你明确启用'],
]

const styles = {
  root: {
    position: 'relative',
    isolation: 'isolate',
    overflow: 'hidden',
    color: '#10271d',
    background: '#e9e3d7',
    border: '1px solid #b6ad9d',
    borderRadius: 18,
    fontFamily: BODY_FONT,
    boxShadow: '0 26px 70px rgba(20, 37, 28, 0.15)',
  },
  hero: {
    position: 'relative',
    overflow: 'hidden',
    padding: 'clamp(26px, 5vw, 58px)',
    backgroundColor: '#f7f0e3',
    backgroundImage: 'linear-gradient(115deg, rgba(247, 240, 227, 0.97) 0%, rgba(247, 240, 227, 0.92) 53%, rgba(222, 230, 212, 0.88) 100%), repeating-linear-gradient(90deg, rgba(20, 56, 40, 0.055) 0, rgba(20, 56, 40, 0.055) 1px, transparent 1px, transparent 10px)',
  },
  heroGrid: { position: 'relative', display: 'flex', alignItems: 'stretch', gap: 'clamp(22px, 4vw, 58px)', flexWrap: 'wrap' },
  heroCopy: { flex: '1 1 460px', minWidth: 0, maxWidth: 740 },
  eyebrow: { color: '#42604e', fontSize: 10, fontFamily: MONO_FONT, letterSpacing: '0.16em', lineHeight: 1.4, textTransform: 'uppercase', fontWeight: 700 },
  heading: { margin: '10px 0 0', color: '#10271d', fontSize: 'clamp(34px, 5.5vw, 68px)', lineHeight: 0.96, letterSpacing: '-0.055em', fontFamily: DISPLAY_FONT, fontWeight: 600, maxWidth: '10.5ch' },
  deck: { maxWidth: 600, margin: '19px 0 0', color: '#40584b', fontSize: 'clamp(15px, 1.8vw, 18px)', lineHeight: 1.65, letterSpacing: '-0.01em' },
  heroActions: { display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap', marginTop: 27 },
  primaryButton: { border: '1px solid #144931', borderRadius: 999, background: '#176b4a', color: '#fffdf7', padding: '10px 16px', font: '700 13px ' + BODY_FONT, cursor: 'pointer', boxShadow: '0 8px 18px rgba(23, 107, 74, 0.23)' },
  quietButton: { border: '1px solid #9aab9e', borderRadius: 999, background: 'rgba(255, 253, 247, 0.55)', color: '#1a4a35', padding: '8px 12px', font: '600 13px ' + BODY_FONT, cursor: 'pointer' },
  heroNote: { color: '#637569', fontSize: 12, lineHeight: 1.5, maxWidth: 290 },
  statusCard: { flex: '1 1 270px', minWidth: 250, maxWidth: 330, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 32, padding: 22, border: '1px solid #285a43', borderRadius: 14, color: '#eaf2e8', background: '#123b2b', boxShadow: 'inset 0 1px rgba(255,255,255,0.12), 0 16px 30px rgba(14, 49, 35, 0.2)' },
  statusKicker: { color: '#a9d5bd', fontSize: 10, fontFamily: MONO_FONT, letterSpacing: '0.14em', textTransform: 'uppercase' },
  statusMetric: { marginTop: 10, color: '#fffdf7', fontFamily: DISPLAY_FONT, fontSize: 44, lineHeight: 0.9, letterSpacing: '-0.06em' },
  statusLabel: { marginTop: 7, color: '#d1e1d4', fontSize: 13, lineHeight: 1.45 },
  statusFooter: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 14, borderTop: '1px solid rgba(214, 239, 221, 0.22)', color: '#c4ddcb', fontFamily: MONO_FONT, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: '#9ee0b9', boxShadow: '0 0 0 4px rgba(158, 224, 185, 0.12)' },
  path: { display: 'flex', gap: 'clamp(20px, 4vw, 52px)', flexWrap: 'wrap', padding: '23px clamp(26px, 5vw, 58px) 28px', borderTop: '1px solid #b9c5b7', borderBottom: '1px solid #b9c5b7', background: '#e2e9de' },
  pathIntro: { flex: '1 1 205px', maxWidth: 290 },
  pathTitle: { margin: '7px 0 0', color: '#143b2b', fontFamily: DISPLAY_FONT, fontSize: 24, lineHeight: 1.05, letterSpacing: '-0.035em' },
  pathCopy: { margin: '10px 0 0', color: '#50675a', fontSize: 13, lineHeight: 1.55 },
  pathList: { flex: '4 1 520px', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8, listStyle: 'none', padding: 0, margin: 0, counterReset: 'none' },
  pathStep: { minHeight: 103, padding: '13px 12px', border: '1px solid #b8c8bb', borderRadius: 10, background: 'rgba(255, 253, 247, 0.7)' },
  pathNumber: { color: '#567463', fontFamily: MONO_FONT, fontSize: 10, letterSpacing: '0.08em' },
  pathLabel: { marginTop: 14, color: '#143b2b', fontFamily: DISPLAY_FONT, fontSize: 17, lineHeight: 1, letterSpacing: '-0.025em' },
  pathDetail: { marginTop: 6, color: '#597063', fontSize: 11, lineHeight: 1.4 },
  catalog: { padding: 'clamp(24px, 4vw, 46px)', background: '#ece6da' },
  catalogLead: { display: 'flex', gap: 18, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', paddingBottom: 20, borderBottom: '1px solid #c9c0b1' },
  sectionIndex: { color: '#4d6a59', fontFamily: MONO_FONT, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase' },
  sectionHeading: { margin: '7px 0 0', color: '#10271d', fontFamily: DISPLAY_FONT, fontSize: 'clamp(27px, 4vw, 42px)', lineHeight: 0.98, letterSpacing: '-0.045em' },
  sectionSummary: { maxWidth: 395, margin: 0, color: '#586b60', fontSize: 13, lineHeight: 1.55 },
  searchForm: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 18 },
  input: { flex: '1 1 260px', minWidth: 0, border: '1px solid #9eaa9e', borderRadius: 999, outline: 'none', background: '#fffdf7', color: '#10271d', padding: '11px 15px', font: '14px ' + BODY_FONT, boxShadow: 'inset 0 1px 1px rgba(16, 39, 29, 0.04)' },
  count: { marginLeft: 'auto', color: '#506458', fontSize: 11, fontFamily: MONO_FONT, letterSpacing: '0.04em', whiteSpace: 'nowrap' },
  safeguard: { display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, color: '#5b6d61', fontSize: 12, lineHeight: 1.45 },
  safeguardMark: { display: 'grid', placeItems: 'center', width: 18, height: 18, flex: '0 0 auto', borderRadius: '50%', background: '#d4e8d9', color: '#176b4a', fontSize: 12, fontWeight: 900 },
  list: { listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'grid', gap: 10 },
  card: { contentVisibility: 'auto', containIntrinsicSize: '0 154px', border: '1px solid #cfc6b7', borderLeft: '4px solid #2b7d59', borderRadius: 11, background: '#fffdf7', padding: '16px 15px 16px 17px', display: 'grid', gap: 13, boxShadow: '0 5px 16px rgba(33, 49, 40, 0.045)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  name: { color: '#112a1f', fontSize: 18, lineHeight: 1.12, fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: '-0.025em' },
  description: { marginTop: 6, color: '#52645a', fontSize: 13, lineHeight: 1.52 },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  badge: { borderRadius: 999, padding: '3px 7px', fontSize: 10, fontFamily: MONO_FONT, letterSpacing: '0.06em', fontWeight: 700 },
  actions: { display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 20, paddingTop: 16, borderTop: '1px solid #c9c0b1', fontSize: 13 },
  error: { marginTop: 15, padding: 13, border: '1px solid #b54e3a', borderRadius: 10, color: '#722d21', background: '#fff4ee', fontFamily: BODY_FONT, fontSize: 13, boxShadow: '0 6px 14px rgba(114, 45, 33, 0.06)' },
  overlay: { position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(10, 27, 19, 0.64)' },
  dialog: { width: 'min(760px, 100%)', maxHeight: 'min(760px, calc(100vh - 36px))', overflow: 'auto', borderRadius: 16, border: '1px solid #cfc6b7', background: '#fffdf7', color: '#10271d', padding: 'clamp(20px, 4vw, 30px)', boxShadow: '0 28px 78px rgba(0, 0, 0, 0.34)' },
  dialogHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  dialogTitle: { margin: '7px 0 3px', color: '#10271d', fontFamily: DISPLAY_FONT, fontSize: 31, lineHeight: 1, letterSpacing: '-0.04em' },
  screenshots: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 17 },
  screenshot: { width: '100%', borderRadius: 9, border: '1px solid #d8d1c3', background: '#e7e2d8', aspectRatio: '16 / 9', objectFit: 'cover' },
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

function catalogStatus({ count, loaded, loading, error, hasQuery }) {
  if (error) return { metric: '!', label: '目录需要重试', trail: '仍保留已载入条目', tone: '#f5bd72' }
  if (loading) return { metric: '…', label: '正在读取目录', trail: 'CATALOG / CONNECTING', tone: '#d7edbc' }
  if (loaded) return { metric: String(count), label: hasQuery ? '个匹配结果' : '个可见 Web 条目', trail: 'CATALOG / LOADED', tone: '#9ee0b9' }
  return { metric: '—', label: '等待目录响应', trail: 'CATALOG / STANDBY', tone: '#c9d8cd' }
}

export function MarketLanding({ count = 0, loaded = false, loading = false, error = null, hasQuery = false, onBrowse }) {
  const status = catalogStatus({ count, loaded, loading, error, hasQuery })
  return h('header', { className: 'cordis-mp-landing', style: styles.hero },
    h('div', { style: styles.heroGrid },
      h('div', { style: styles.heroCopy },
        h('div', { style: styles.eyebrow }, 'Cordis.run / DeepSeek Harness / Web'),
        h('h1', { style: styles.heading }, '为 Harness 建立可控的插件目录。'),
        h('p', { style: styles.deck }, '先看到兼容性、来源与版本；安装后保持待启用，直到你明确选择 Activate。市场只提供一条受控路径，不会替你悄悄运行新插件。'),
        h('div', { style: styles.heroActions },
          h('button', { type: 'button', onClick: onBrowse, style: styles.primaryButton }, '浏览目录 ↓'),
          h('span', { style: styles.heroNote }, '所有安装请求仍需在具体条目中确认；启用始终是单独操作。'),
        ),
      ),
      h('aside', { className: 'cordis-mp-catalog-status', 'aria-live': 'polite', style: styles.statusCard },
        h('div', null,
          h('div', { style: styles.statusKicker }, '本次目录'),
          h('div', { style: styles.statusMetric }, status.metric),
          h('div', { style: styles.statusLabel }, status.label),
        ),
        h('div', { style: styles.statusFooter },
          h('span', { 'aria-hidden': true, style: { ...styles.statusDot, background: status.tone, boxShadow: '0 0 0 4px ' + status.tone + '22' } }),
          status.trail,
        ),
      ),
    ),
    h('section', { className: 'cordis-mp-install-path', 'aria-label': '受控安装路径', style: styles.path },
      h('div', { style: styles.pathIntro },
        h('div', { style: styles.eyebrow }, '受控安装路径'),
        h('h2', { style: styles.pathTitle }, '默认不运行，直到你确认。'),
        h('p', { style: styles.pathCopy }, '这不是六个可跳过的提示，而是安装事务与显式启用之间的实际边界。'),
      ),
      h('ol', { style: styles.pathList }, INSTALL_PATH.map(([number, label, detail]) => h('li', { key: label, style: styles.pathStep },
        h('div', { style: styles.pathNumber }, number),
        h('div', { style: styles.pathLabel }, label),
        h('div', { style: styles.pathDetail }, detail),
      ))),
    ),
  )
}

export function PlatformBadges({ platforms = [] }) {
  const labels = platforms.length ? platforms : ['unknown']
  return h('div', { className: 'cordis-mp-platforms', style: styles.badgeRow }, labels.map(platform => {
    const tone = platform === 'web'
      ? { background: '#d5eee2', color: '#176b4a' }
      : platform === 'desktop'
        ? { background: '#dbe6f7', color: '#244f84' }
        : { background: '#ebe7de', color: '#62625d' }
    return h('span', { key: platform, className: 'cordis-mp-platform-badge cordis-mp-platform-' + platform, style: { ...styles.badge, ...tone } }, platform.toUpperCase())
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
      onDismiss ? h('button', { type: 'button', onClick: onDismiss, style: { ...styles.quietButton, padding: '2px 8px', border: 0, background: 'transparent' } }, '关闭') : null,
    ),
    fields.length ? h('details', { style: { marginTop: 8 } },
      h('summary', { style: { cursor: 'pointer' } }, '错误详情'),
      h('dl', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', margin: '8px 0 0' } }, fields.flatMap(([label, value]) => [h('dt', { key: label + '-label' }, label), h('dd', { key: label + '-value', style: { margin: 0, overflowWrap: 'anywhere' } }, String(value))])),
    ) : null,
  )
}

export function Pagination({ page, pageNumber, hasPrevious, loading, onPrevious, onNext }) {
  return h('nav', { className: 'cordis-mp-pagination', 'aria-label': '市场分页', style: styles.pagination },
    h('button', { type: 'button', disabled: loading || !hasPrevious, onClick: onPrevious, style: styles.quietButton }, '上一页'),
    h('span', { className: 'cordis-mp-page-status', style: { color: '#53685b', fontFamily: MONO_FONT, fontSize: 11 } }, '第 ' + pageNumber + ' 页 · 每页 ' + (page?.limit || PAGE_SIZE) + ' 个'),
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
          h('h2', { style: styles.dialogTitle }, item?.name || '加载中…'),
          h(PlatformBadges, { platforms: item?.platforms || [] }),
        ),
        h('button', { type: 'button', onClick: onClose, style: styles.quietButton, 'aria-label': '关闭详情' }, '关闭'),
      ),
      error ? h(ErrorPanel, { error }) : null,
      loading ? h('p', { style: { color: '#5b6d63' } }, '正在加载详情…') : h('div', null,
        h('p', { style: { ...styles.description, marginTop: 16 } }, description),
        item?.description?.en && item.description.en !== description ? h('p', { style: { ...styles.description, fontStyle: 'italic' } }, item.description.en) : null,
        h('dl', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: '16px 0 0', fontSize: 13 } },
          h('dt', null, '来源'), h('dd', { style: { margin: 0 } }, item?.source?.packageName || '—'),
          h('dt', null, '版本'), h('dd', { style: { margin: 0 } }, item?.source?.version || '—'),
          h('dt', null, '引擎'), h('dd', { style: { margin: 0 } }, item?.engines?.dsh || '—'),
          h('dt', null, '状态'), h('dd', { style: { margin: 0 } }, item?.blocked ? '已阻止' : item?.deprecated ? '已弃用' : '可浏览'),
        ),
        homepage ? h('p', { style: { marginTop: 14 } }, h('a', { href: homepage, target: '_blank', rel: 'noreferrer', style: { color: '#176b4a' } }, '访问项目主页 ↗')) : null,
        screenshots.length ? h('div', { className: 'cordis-mp-screenshots', style: styles.screenshots }, screenshots.map((url, index) => h('img', { key: url, src: url, alt: (item?.name || '插件') + ' 截图 ' + (index + 1), referrerPolicy: 'no-referrer', loading: 'lazy', style: styles.screenshot }))) : h('p', { style: { ...styles.description, marginTop: 16 } }, '该插件暂未提供截图。'),
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
  const [catalogError, setCatalogError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [catalogLoaded, setCatalogLoaded] = React.useState(false)
  const [busySlug, setBusySlug] = React.useState(null)
  const [pendingBySlug, setPendingBySlug] = React.useState({})
  const [detail, setDetail] = React.useState(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState(null)
  const listRequestId = React.useRef(0)
  const detailRequestId = React.useRef(0)
  const searchInputRef = React.useRef(null)
  const catalogRef = React.useRef(null)

  const load = React.useCallback(async ({ nextQuery, cursor = null, history = [] }) => {
    const requestId = ++listRequestId.current
    setLoading(true); setError(null); setCatalogError(null)
    try {
      const result = await controller.search({ q: nextQuery, platform: 'web', cursor, limit: PAGE_SIZE })
      if (requestId !== listRequestId.current) return
      setItems(Array.isArray(result.items) ? result.items : [])
      setCount(Number.isInteger(result.count) ? result.count : 0)
      setPage(result.page || { cursor: null, hasMore: false, limit: PAGE_SIZE })
      setCurrentCursor(cursor)
      setCursorHistory(history)
      setActiveQuery(nextQuery)
      setCatalogLoaded(true)
    } catch (nextError) {
      if (requestId === listRequestId.current) {
        const info = errorInfo(nextError)
        setError(info)
        setCatalogError(info)
      }
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
  function browseCatalog() {
    catalogRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    searchInputRef.current?.focus?.()
  }
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
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm('确认安装插件 ' + item.name + '？安装后默认禁用，需手动启用。')) return
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
    h(MarketLanding, { count, loaded: catalogLoaded, loading, error: catalogError, hasQuery: Boolean(activeQuery), onBrowse: browseCatalog }),
    h('section', { id: 'cordis-mp-catalog', ref: catalogRef, tabIndex: -1, 'aria-label': '插件目录', style: styles.catalog },
      h('div', { style: styles.catalogLead },
        h('div', null,
          h('div', { style: styles.sectionIndex }, '01 / Browser'),
          h('h2', { style: styles.sectionHeading }, '从目录开始，而不是从猜测开始。'),
        ),
        h('p', { style: styles.sectionSummary }, '搜索名称或 slug，查看兼容平台、工件信息与截图。只有符合当前 Web 安装门槛的条目才可安装。'),
      ),
      h('form', { className: 'cordis-mp-market-head', onSubmit: event => { event.preventDefault(); search() }, style: styles.searchForm },
        h('input', { ref: searchInputRef, value: query, placeholder: '搜索插件名称或 slug', 'aria-label': '搜索插件', onChange: event => setQuery(event.target.value), style: styles.input }),
        h('button', { type: 'submit', disabled: loading, style: styles.primaryButton }, loading ? '加载中…' : '搜索'),
        h('span', { className: 'cordis-mp-count', style: styles.count, 'aria-live': 'polite' }, count + ' 个结果'),
      ),
      h('div', { style: styles.safeguard },
        h('span', { 'aria-hidden': true, style: styles.safeguardMark }, '✓'),
        h('span', null, '安装会先进入待启用状态；只有你点击“启用”才会激活插件。'),
      ),
      h(ErrorPanel, { error, onDismiss: () => { setError(null); setCatalogError(null) } }),
      h('ul', { className: 'cordis-mp-list', style: styles.list }, items.map(item => h(MarketItem, { key: item.slug, item, pending: pendingBySlug[item.slug] === true, busy: busySlug !== null, onInstall: install, onActivate: activate, onDetail: openDetail }))),
      !loading && items.length === 0 ? h('p', { style: { ...styles.description, textAlign: 'center', padding: '24px 0' } }, activeQuery ? '没有匹配的插件。' : '暂无可展示的 Web 插件。') : null,
      h(Pagination, { page, pageNumber: cursorHistory.length + 1, hasPrevious: cursorHistory.length > 0, loading, onPrevious: previousPage, onNext: nextPage }),
    ),
    h(DetailDialog, { item: detail, loading: detailLoading, error: detailError, onClose: () => { detailRequestId.current++; setDetail(null); setDetailError(null) } }),
  )
}
