// apps/web/src/client/index.js
import React2 from "react";

// apps/web/src/client/api.js
function createMarketApi({ fetchImpl = globalThis.fetch, base = "" } = {}) {
  let token = null;
  async function session() {
    const res = await fetchImpl(`${base}/cordis-mp/session`, { method: "POST" });
    const body = await json(res);
    if (typeof body.token !== "string" || !body.token) {
      const error = new Error("session failed: response has no mutation token");
      error.code = "BAD_SESSION";
      error.status = res.status;
      throw error;
    }
    token = body.token;
    return body.token;
  }
  async function json(res) {
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
    }
    if (!res.ok) {
      const e = new Error(body?.error?.message || `HTTP ${res.status}`);
      e.code = body?.error?.code || "HTTP_ERROR";
      e.status = res.status;
      e.requestId = body?.error?.requestId || null;
      e.retryAfter = body?.error?.retryAfter ?? null;
      throw e;
    }
    return body;
  }
  async function mutation(path, body) {
    if (!token) await session();
    let retried = false;
    for (; ; ) {
      const res = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cordis-mp-token": token },
        body: JSON.stringify(body)
      });
      if (res.status === 403 && !retried) {
        retried = true;
        token = null;
        await session();
        continue;
      }
      return json(res);
    }
  }
  return {
    session,
    async catalog(params = {}) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== void 0 && v !== null && v !== "") qs.set(k === "perPage" ? "per_page" : k, String(v));
      }
      const res = await fetchImpl(`${base}/cordis-mp/catalog?${qs}`);
      return json(res);
    },
    async detail(slug) {
      return json(await fetchImpl(`${base}/cordis-mp/plugin/${encodeURIComponent(slug)}`));
    },
    async status() {
      return json(await fetchImpl(`${base}/cordis-mp/status`));
    },
    install: (payload) => mutation("/cordis-mp/install", payload),
    activate: (payload) => mutation("/cordis-mp/activate", payload),
    uninstall: (payload) => mutation("/cordis-mp/uninstall", payload)
  };
}

// apps/web/src/client/market-controller.js
function createMarketController(api) {
  return {
    async search({ q = "", platform = "web", cursor = void 0, limit = 20, page = void 0, perPage = void 0 } = {}) {
      const params = { q, platform };
      if (page !== void 0 || perPage !== void 0) {
        params.page = page ?? 1;
        params.perPage = perPage ?? limit;
      } else {
        params.cursor = cursor;
        params.limit = limit;
      }
      const body = await api.catalog(params);
      return { source: body.source, catalogRevision: body.catalogRevision, count: body.count, page: body.page, categories: body.categories, items: body.items };
    },
    async detail(slug) {
      const body = await api.detail(slug);
      return body.plugin;
    },
    install(slug, entryRevision) {
      return api.install({ slug, entryRevision });
    },
    activate(slug) {
      return api.activate({ slug });
    },
    uninstall(name) {
      return api.uninstall({ name });
    },
    status() {
      return api.status();
    }
  };
}

// apps/web/src/client/MarketSection.js
import React from "react";

// packages/catalog-core/src/schema.mjs
var HASH_RE = /^sha(256|512)-[A-Za-z0-9+/=]+$/;
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
function installability(item, platform = "web") {
  const reasons = [];
  const src = item?.source || {};
  if (src.type !== "npm") reasons.push("non-npm-source");
  else {
    if (!src.packageName || !NPM_NAME_RE.test(src.packageName)) reasons.push("bad-package-name");
    if (typeof src.version !== "string" || !/^\d+\.\d+\.\d+/.test(src.version)) reasons.push("bad-version");
    if (typeof src.integrity !== "string" || !HASH_RE.test(src.integrity)) reasons.push("missing-integrity");
    if (!["https://registry.npmjs.org"].includes(src.registry)) reasons.push("registry-not-allowed");
    if (typeof src.tarball !== "string" || src.tarball.length === 0) reasons.push("missing-tarball");
    else {
      try {
        const registry = new URL(src.registry);
        const tarball = new URL(src.tarball);
        if (tarball.protocol !== registry.protocol || tarball.hostname !== registry.hostname || tarball.port !== registry.port) reasons.push("tarball-origin-mismatch");
      } catch {
        reasons.push("bad-tarball-url");
      }
    }
  }
  const platforms = Array.isArray(item?.platforms) ? item.platforms : [];
  if (!platforms.includes(platform)) reasons.push(`platform-${platforms.join("+")}`);
  if (item?.blocked) reasons.push("blocked");
  if (item?.deprecated) reasons.push("deprecated");
  if (typeof item?.entryRevision !== "string" || item.entryRevision.length === 0) reasons.push("missing-entry-revision");
  if (typeof item?.engines?.dsh !== "string" || !item.engines.dsh.startsWith(">=")) reasons.push("bad-engines-dsh");
  return { installable: reasons.length === 0, reasons, reason: reasons.join(",") };
}

// apps/web/src/client/MarketSection.js
var h = React.createElement;
var PAGE_SIZE = 12;
var styles = {
  root: { color: "#15251e", background: "#f4f0e8", border: "1px solid #c9c3b5", borderRadius: 14, padding: 20, fontFamily: "ui-serif, Georgia, serif", boxShadow: "0 16px 36px rgba(21, 37, 30, 0.09)" },
  eyebrow: { color: "#5b6d63", fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.12em", textTransform: "uppercase" },
  heading: { margin: "4px 0 14px", fontSize: 26, lineHeight: 1.1, letterSpacing: "-0.035em" },
  searchRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: { flex: "1 1 220px", minWidth: 0, border: "1px solid #a8b1a7", borderRadius: 8, background: "#fffdf8", color: "#15251e", padding: "10px 12px", font: "inherit" },
  primaryButton: { border: 0, borderRadius: 8, background: "#176b4a", color: "#fffdf8", padding: "10px 14px", font: "inherit", cursor: "pointer" },
  quietButton: { border: "1px solid #a8b1a7", borderRadius: 8, background: "transparent", color: "#1c4031", padding: "8px 11px", font: "inherit", cursor: "pointer" },
  count: { marginLeft: "auto", color: "#5b6d63", fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  list: { listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 9 },
  card: { contentVisibility: "auto", containIntrinsicSize: "0 144px", border: "1px solid #d8d1c3", borderRadius: 10, background: "#fffdf8", padding: 14, display: "grid", gap: 12 },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  name: { fontSize: 17, lineHeight: 1.15, fontWeight: 700 },
  description: { marginTop: 5, color: "#526259", fontSize: 14, lineHeight: 1.45 },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 },
  badge: { borderRadius: 999, padding: "3px 7px", fontSize: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.06em", fontWeight: 700 },
  actions: { display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 18, paddingTop: 14, borderTop: "1px solid #d8d1c3", fontSize: 13 },
  error: { marginTop: 14, padding: 12, border: "1px solid #b54e3a", borderRadius: 9, color: "#722d21", background: "#fff4ee", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 13 },
  overlay: { position: "fixed", inset: 0, zIndex: 30, display: "grid", placeItems: "center", padding: 18, background: "rgba(17, 28, 23, 0.56)" },
  dialog: { width: "min(760px, 100%)", maxHeight: "min(760px, calc(100vh - 36px))", overflow: "auto", borderRadius: 14, border: "1px solid #d8d1c3", background: "#fffdf8", color: "#15251e", padding: 20, boxShadow: "0 24px 64px rgba(0, 0, 0, 0.28)" },
  dialogHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  screenshots: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 16 },
  screenshot: { width: "100%", borderRadius: 8, border: "1px solid #d8d1c3", background: "#e7e2d8", aspectRatio: "16 / 9", objectFit: "cover" }
};
function errorInfo(error) {
  return {
    message: error?.message || "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
    code: error?.code || null,
    status: Number.isInteger(error?.status) ? error.status : null,
    requestId: error?.requestId || null,
    retryAfter: error?.retryAfter ?? null
  };
}
function externalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
function screenshotUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.cordis.run" ? url.href : null;
  } catch {
    return null;
  }
}
function canInstall(item) {
  return installability(item, "web").installable;
}
function PlatformBadges({ platforms = [] }) {
  const labels = platforms.length ? platforms : ["unknown"];
  return h("div", { className: "cordis-mp-platforms", style: styles.badgeRow }, labels.map((platform) => {
    const tone = platform === "web" ? { background: "#d5eee2", color: "#176b4a" } : platform === "desktop" ? { background: "#dbe6f7", color: "#244f84" } : { background: "#ebe7de", color: "#62625d" };
    return h("span", { key: platform, className: `cordis-mp-platform-badge cordis-mp-platform-${platform}`, style: { ...styles.badge, ...tone } }, platform.toUpperCase());
  }));
}
function ErrorPanel({ error, onDismiss }) {
  if (!error) return null;
  const fields = [
    ["\u4EE3\u7801", error.code],
    ["HTTP", error.status],
    ["Request ID", error.requestId],
    ["\u91CD\u8BD5\u79D2\u6570", error.retryAfter]
  ].filter(([, value]) => value !== null && value !== void 0 && value !== "");
  return h(
    "section",
    { className: "cordis-mp-error", role: "alert", style: styles.error },
    h(
      "div",
      { style: { display: "flex", justifyContent: "space-between", gap: 12 } },
      h("strong", null, error.message),
      onDismiss ? h("button", { type: "button", onClick: onDismiss, style: { ...styles.quietButton, padding: "2px 7px", border: 0 } }, "\u5173\u95ED") : null
    ),
    fields.length ? h(
      "details",
      { style: { marginTop: 8 } },
      h("summary", { style: { cursor: "pointer" } }, "\u9519\u8BEF\u8BE6\u60C5"),
      h("dl", { style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", margin: "8px 0 0" } }, fields.flatMap(([label, value]) => [h("dt", { key: `${label}-label` }, label), h("dd", { key: `${label}-value`, style: { margin: 0, overflowWrap: "anywhere" } }, String(value))]))
    ) : null
  );
}
function Pagination({ page, pageNumber, hasPrevious, loading, onPrevious, onNext }) {
  return h(
    "nav",
    { className: "cordis-mp-pagination", "aria-label": "\u5E02\u573A\u5206\u9875", style: styles.pagination },
    h("button", { type: "button", disabled: loading || !hasPrevious, onClick: onPrevious, style: styles.quietButton }, "\u4E0A\u4E00\u9875"),
    h("span", { className: "cordis-mp-page-status", style: { color: "#5b6d63" } }, `\u7B2C ${pageNumber} \u9875 \xB7 \u6BCF\u9875 ${page?.limit || PAGE_SIZE} \u4E2A`),
    h("button", { type: "button", disabled: loading || !page?.hasMore || typeof page?.cursor !== "string", onClick: onNext, style: styles.quietButton }, "\u4E0B\u4E00\u9875")
  );
}
function MarketItem({ item, pending, busy, onInstall, onActivate, onDetail }) {
  const installable = canInstall(item);
  const description = item.description?.zh || item.description?.en || "\u6682\u65E0\u7B80\u4ECB";
  return h(
    "li",
    { className: "cordis-mp-item", style: { ...styles.card, opacity: installable ? 1 : 0.7 } },
    h(
      "div",
      { style: styles.cardTop },
      h(
        "div",
        null,
        h("div", { className: "cordis-mp-name", style: styles.name }, item.name),
        h("div", { className: "cordis-mp-desc", style: styles.description }, description),
        h(PlatformBadges, { platforms: item.platforms })
      ),
      h(
        "div",
        { style: styles.actions },
        h("button", { type: "button", onClick: () => onDetail(item), style: styles.quietButton }, "\u8BE6\u60C5"),
        pending ? h("button", { type: "button", disabled: busy, onClick: () => onActivate(item), style: styles.primaryButton }, busy ? "\u542F\u7528\u4E2D\u2026" : "\u542F\u7528") : h("button", { type: "button", disabled: busy || !installable, onClick: () => onInstall(item), style: styles.primaryButton }, item.blocked ? "\u5DF2\u963B\u6B62" : item.deprecated ? "\u5DF2\u5F03\u7528" : busy ? "\u5B89\u88C5\u4E2D\u2026" : "\u5B89\u88C5")
      )
    )
  );
}
function DetailDialog({ item, loading, error, onClose }) {
  if (!item && !loading && !error) return null;
  const homepage = externalUrl(item?.homepage);
  const description = item?.description?.zh || item?.description?.en || "\u6B63\u5728\u83B7\u53D6\u63D2\u4EF6\u8BE6\u60C5\u2026";
  const screenshots = Array.isArray(item?.screenshots) ? item.screenshots.map(screenshotUrl).filter(Boolean) : [];
  return h(
    "div",
    { className: "cordis-mp-detail-overlay", style: styles.overlay },
    h(
      "section",
      { className: "cordis-mp-detail-dialog", role: "dialog", "aria-modal": true, "aria-label": item?.name || "\u63D2\u4EF6\u8BE6\u60C5", style: styles.dialog },
      h(
        "div",
        { style: styles.dialogHead },
        h(
          "div",
          null,
          h("div", { style: styles.eyebrow }, item?.slug || "\u63D2\u4EF6\u8BE6\u60C5"),
          h("h2", { style: { ...styles.heading, marginBottom: 4 } }, item?.name || "\u52A0\u8F7D\u4E2D\u2026"),
          h(PlatformBadges, { platforms: item?.platforms || [] })
        ),
        h("button", { type: "button", onClick: onClose, style: styles.quietButton, "aria-label": "\u5173\u95ED\u8BE6\u60C5" }, "\u5173\u95ED")
      ),
      error ? h(ErrorPanel, { error }) : null,
      loading ? h("p", { style: { color: "#5b6d63" } }, "\u6B63\u5728\u52A0\u8F7D\u8BE6\u60C5\u2026") : h(
        "div",
        null,
        h("p", { style: { ...styles.description, marginTop: 14 } }, description),
        item?.description?.en && item.description.en !== description ? h("p", { style: { ...styles.description, fontStyle: "italic" } }, item.description.en) : null,
        h(
          "dl",
          { style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: "14px 0 0", fontSize: 13 } },
          h("dt", null, "\u6765\u6E90"),
          h("dd", { style: { margin: 0 } }, item?.source?.packageName || "\u2014"),
          h("dt", null, "\u7248\u672C"),
          h("dd", { style: { margin: 0 } }, item?.source?.version || "\u2014"),
          h("dt", null, "\u5F15\u64CE"),
          h("dd", { style: { margin: 0 } }, item?.engines?.dsh || "\u2014"),
          h("dt", null, "\u72B6\u6001"),
          h("dd", { style: { margin: 0 } }, item?.blocked ? "\u5DF2\u963B\u6B62" : item?.deprecated ? "\u5DF2\u5F03\u7528" : "\u53EF\u6D4F\u89C8")
        ),
        homepage ? h("p", { style: { marginTop: 14 } }, h("a", { href: homepage, target: "_blank", rel: "noreferrer", style: { color: "#176b4a" } }, "\u8BBF\u95EE\u9879\u76EE\u4E3B\u9875 \u2197")) : null,
        screenshots.length ? h("div", { className: "cordis-mp-screenshots", style: styles.screenshots }, screenshots.map((url, index) => h("img", { key: url, src: url, alt: `${item?.name || "\u63D2\u4EF6"} \u622A\u56FE ${index + 1}`, referrerPolicy: "no-referrer", loading: "lazy", style: styles.screenshot }))) : h("p", { style: { ...styles.description, marginTop: 16 } }, "\u8BE5\u63D2\u4EF6\u6682\u672A\u63D0\u4F9B\u622A\u56FE\u3002")
      )
    )
  );
}
function MarketSection({ controller }) {
  const [query, setQuery] = React.useState("");
  const [activeQuery, setActiveQuery] = React.useState("");
  const [items, setItems] = React.useState([]);
  const [count, setCount] = React.useState(0);
  const [page, setPage] = React.useState({ cursor: null, hasMore: false, limit: PAGE_SIZE });
  const [currentCursor, setCurrentCursor] = React.useState(null);
  const [cursorHistory, setCursorHistory] = React.useState([]);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busySlug, setBusySlug] = React.useState(null);
  const [pendingBySlug, setPendingBySlug] = React.useState({});
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState(null);
  const listRequestId = React.useRef(0);
  const detailRequestId = React.useRef(0);
  const load = React.useCallback(async ({ nextQuery, cursor = null, history = [] }) => {
    const requestId = ++listRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await controller.search({ q: nextQuery, platform: "web", cursor, limit: PAGE_SIZE });
      if (requestId !== listRequestId.current) return;
      setItems(Array.isArray(result.items) ? result.items : []);
      setCount(Number.isInteger(result.count) ? result.count : 0);
      setPage(result.page || { cursor: null, hasMore: false, limit: PAGE_SIZE });
      setCurrentCursor(cursor);
      setCursorHistory(history);
      setActiveQuery(nextQuery);
    } catch (nextError) {
      if (requestId === listRequestId.current) setError(errorInfo(nextError));
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  }, [controller]);
  React.useEffect(() => {
    void load({ nextQuery: "", cursor: null, history: [] });
  }, [load]);
  React.useEffect(() => {
    if (typeof controller.status !== "function") return void 0;
    let active = true;
    void controller.status().then((status) => {
      if (!active) return;
      const pending = Array.isArray(status?.pending) ? status.pending : [];
      const recovered = Object.fromEntries(pending.map((item) => typeof item === "string" ? item : item?.slug).filter((slug) => typeof slug === "string" && slug.length > 0).map((slug) => [slug, true]));
      setPendingBySlug((previous) => ({ ...previous, ...recovered }));
    }).catch((nextError) => {
      if (active) setError(errorInfo(nextError));
    });
    return () => {
      active = false;
    };
  }, [controller]);
  function search() {
    void load({ nextQuery: query, cursor: null, history: [] });
  }
  function nextPage() {
    if (page.hasMore && typeof page.cursor === "string") void load({ nextQuery: activeQuery, cursor: page.cursor, history: [...cursorHistory, currentCursor] });
  }
  function previousPage() {
    if (!cursorHistory.length) return;
    const previousCursor = cursorHistory[cursorHistory.length - 1];
    void load({ nextQuery: activeQuery, cursor: previousCursor, history: cursorHistory.slice(0, -1) });
  }
  async function install(item) {
    if (!canInstall(item)) return;
    if (typeof globalThis.confirm === "function" && !globalThis.confirm(`\u786E\u8BA4\u5B89\u88C5\u63D2\u4EF6 ${item.name}\uFF1F\u5B89\u88C5\u540E\u9ED8\u8BA4\u7981\u7528\uFF0C\u9700\u624B\u52A8\u542F\u7528\u3002`)) return;
    setBusySlug(item.slug);
    setError(null);
    try {
      await controller.install(item.slug, item.entryRevision);
      setPendingBySlug((previous) => ({ ...previous, [item.slug]: true }));
    } catch (nextError) {
      setError(errorInfo(nextError));
    } finally {
      setBusySlug(null);
    }
  }
  async function activate(item) {
    setBusySlug(item.slug);
    setError(null);
    try {
      await controller.activate(item.slug);
      setPendingBySlug((previous) => {
        const next = { ...previous };
        delete next[item.slug];
        return next;
      });
    } catch (nextError) {
      setError(errorInfo(nextError));
    } finally {
      setBusySlug(null);
    }
  }
  async function openDetail(item) {
    const requestId = ++detailRequestId.current;
    setDetail(item);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await controller.detail(item.slug);
      if (requestId === detailRequestId.current) setDetail(result);
    } catch (nextError) {
      if (requestId === detailRequestId.current) setDetailError(errorInfo(nextError));
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  }
  return h(
    "div",
    { className: "cordis-mp-market", "data-testid": "cordis-mp-market", style: styles.root },
    h(
      "div",
      { className: "cordis-mp-market-head" },
      h("div", { style: styles.eyebrow }, "Cordis.run / Web"),
      h("h1", { style: styles.heading }, "\u63D2\u4EF6\u5E02\u573A"),
      h(
        "div",
        { style: styles.searchRow },
        h("input", { value: query, placeholder: "\u641C\u7D22\u63D2\u4EF6\u540D\u79F0\u6216 slug", "aria-label": "\u641C\u7D22\u63D2\u4EF6", onChange: (event) => setQuery(event.target.value), onKeyDown: (event) => {
          if (event.key === "Enter") search();
        }, style: styles.input }),
        h("button", { type: "button", onClick: search, disabled: loading, style: styles.primaryButton }, loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u641C\u7D22"),
        h("span", { className: "cordis-mp-count", style: styles.count, "aria-live": "polite" }, `${count} \u4E2A\u7ED3\u679C`)
      )
    ),
    h(ErrorPanel, { error, onDismiss: () => setError(null) }),
    h("ul", { className: "cordis-mp-list", style: styles.list }, items.map((item) => h(MarketItem, { key: item.slug, item, pending: pendingBySlug[item.slug] === true, busy: busySlug !== null, onInstall: install, onActivate: activate, onDetail: openDetail }))),
    !loading && items.length === 0 ? h("p", { style: { ...styles.description, textAlign: "center", padding: "22px 0" } }, activeQuery ? "\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6\u3002" : "\u6682\u65E0\u53EF\u5C55\u793A\u7684 Web \u63D2\u4EF6\u3002") : null,
    h(Pagination, { page, pageNumber: cursorHistory.length + 1, hasPrevious: cursorHistory.length > 0, loading, onPrevious: previousPage, onNext: nextPage }),
    h(DetailDialog, { item: detail, loading: detailLoading, error: detailError, onClose: () => {
      detailRequestId.current++;
      setDetail(null);
      setDetailError(null);
    } })
  );
}

// apps/web/src/client/index.js
var inject = ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"];
function apply(ctx) {
  if (!ctx?.slots) {
    console.warn("[cordis-mp] settings slots unavailable; market UI is not mounted");
    return;
  }
  const api = createMarketApi();
  const controller = createMarketController(api);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "cordis-mp-market",
    order: 25,
    label: () => "\u63D2\u4EF6\u5E02\u573A",
    inject: () => ({ controller }),
    children: {}
  }, (props) => React2.createElement(MarketSection, { ...props, controller })));
}
export {
  apply,
  inject
};
