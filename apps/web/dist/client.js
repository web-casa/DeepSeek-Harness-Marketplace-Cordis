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
var DISPLAY_FONT = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif";
var BODY_FONT = "'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
var MONO_FONT = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
var INSTALL_PATH = [
  ["01", "Inspect", "\u6821\u9A8C\u5305\u4E0E\u5B8C\u6574\u6027"],
  ["02", "Pre-disable", "\u5148\u505C\u7528\u65E7\u5165\u53E3"],
  ["03", "Install", "\u5199\u5165\u53D7\u63A7\u4E8B\u52A1"],
  ["04", "Verify", "\u590D\u6838 lockfile"],
  ["05", "Pending", "\u9ED8\u8BA4\u4FDD\u6301\u7981\u7528"],
  ["06", "Activate", "\u7531\u4F60\u660E\u786E\u542F\u7528"]
];
var styles = {
  root: {
    position: "relative",
    isolation: "isolate",
    overflow: "hidden",
    color: "#10271d",
    background: "#e9e3d7",
    border: "1px solid #b6ad9d",
    borderRadius: 18,
    fontFamily: BODY_FONT,
    boxShadow: "0 26px 70px rgba(20, 37, 28, 0.15)"
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    padding: "clamp(26px, 5vw, 58px)",
    backgroundColor: "#f7f0e3",
    backgroundImage: "linear-gradient(115deg, rgba(247, 240, 227, 0.97) 0%, rgba(247, 240, 227, 0.92) 53%, rgba(222, 230, 212, 0.88) 100%), repeating-linear-gradient(90deg, rgba(20, 56, 40, 0.055) 0, rgba(20, 56, 40, 0.055) 1px, transparent 1px, transparent 10px)"
  },
  heroGrid: { position: "relative", display: "flex", alignItems: "stretch", gap: "clamp(22px, 4vw, 58px)", flexWrap: "wrap" },
  heroCopy: { flex: "1 1 460px", minWidth: 0, maxWidth: 740 },
  eyebrow: { color: "#42604e", fontSize: 10, fontFamily: MONO_FONT, letterSpacing: "0.16em", lineHeight: 1.4, textTransform: "uppercase", fontWeight: 700 },
  heading: { margin: "10px 0 0", color: "#10271d", fontSize: "clamp(34px, 5.5vw, 68px)", lineHeight: 0.96, letterSpacing: "-0.055em", fontFamily: DISPLAY_FONT, fontWeight: 600, maxWidth: "10.5ch" },
  deck: { maxWidth: 600, margin: "19px 0 0", color: "#40584b", fontSize: "clamp(15px, 1.8vw, 18px)", lineHeight: 1.65, letterSpacing: "-0.01em" },
  heroActions: { display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", marginTop: 27 },
  primaryButton: { border: "1px solid #144931", borderRadius: 999, background: "#176b4a", color: "#fffdf7", padding: "10px 16px", font: "700 13px " + BODY_FONT, cursor: "pointer", boxShadow: "0 8px 18px rgba(23, 107, 74, 0.23)" },
  quietButton: { border: "1px solid #9aab9e", borderRadius: 999, background: "rgba(255, 253, 247, 0.55)", color: "#1a4a35", padding: "8px 12px", font: "600 13px " + BODY_FONT, cursor: "pointer" },
  heroNote: { color: "#637569", fontSize: 12, lineHeight: 1.5, maxWidth: 290 },
  statusCard: { flex: "1 1 270px", minWidth: 250, maxWidth: 330, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 32, padding: 22, border: "1px solid #285a43", borderRadius: 14, color: "#eaf2e8", background: "#123b2b", boxShadow: "inset 0 1px rgba(255,255,255,0.12), 0 16px 30px rgba(14, 49, 35, 0.2)" },
  statusKicker: { color: "#a9d5bd", fontSize: 10, fontFamily: MONO_FONT, letterSpacing: "0.14em", textTransform: "uppercase" },
  statusMetric: { marginTop: 10, color: "#fffdf7", fontFamily: DISPLAY_FONT, fontSize: 44, lineHeight: 0.9, letterSpacing: "-0.06em" },
  statusLabel: { marginTop: 7, color: "#d1e1d4", fontSize: 13, lineHeight: 1.45 },
  statusFooter: { display: "flex", alignItems: "center", gap: 8, paddingTop: 14, borderTop: "1px solid rgba(214, 239, 221, 0.22)", color: "#c4ddcb", fontFamily: MONO_FONT, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto", background: "#9ee0b9", boxShadow: "0 0 0 4px rgba(158, 224, 185, 0.12)" },
  path: { display: "flex", gap: "clamp(20px, 4vw, 52px)", flexWrap: "wrap", padding: "23px clamp(26px, 5vw, 58px) 28px", borderTop: "1px solid #b9c5b7", borderBottom: "1px solid #b9c5b7", background: "#e2e9de" },
  pathIntro: { flex: "1 1 205px", maxWidth: 290 },
  pathTitle: { margin: "7px 0 0", color: "#143b2b", fontFamily: DISPLAY_FONT, fontSize: 24, lineHeight: 1.05, letterSpacing: "-0.035em" },
  pathCopy: { margin: "10px 0 0", color: "#50675a", fontSize: 13, lineHeight: 1.55 },
  pathList: { flex: "4 1 520px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8, listStyle: "none", padding: 0, margin: 0, counterReset: "none" },
  pathStep: { minHeight: 103, padding: "13px 12px", border: "1px solid #b8c8bb", borderRadius: 10, background: "rgba(255, 253, 247, 0.7)" },
  pathNumber: { color: "#567463", fontFamily: MONO_FONT, fontSize: 10, letterSpacing: "0.08em" },
  pathLabel: { marginTop: 14, color: "#143b2b", fontFamily: DISPLAY_FONT, fontSize: 17, lineHeight: 1, letterSpacing: "-0.025em" },
  pathDetail: { marginTop: 6, color: "#597063", fontSize: 11, lineHeight: 1.4 },
  catalog: { padding: "clamp(24px, 4vw, 46px)", background: "#ece6da" },
  catalogLead: { display: "flex", gap: 18, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", paddingBottom: 20, borderBottom: "1px solid #c9c0b1" },
  sectionIndex: { color: "#4d6a59", fontFamily: MONO_FONT, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase" },
  sectionHeading: { margin: "7px 0 0", color: "#10271d", fontFamily: DISPLAY_FONT, fontSize: "clamp(27px, 4vw, 42px)", lineHeight: 0.98, letterSpacing: "-0.045em" },
  sectionSummary: { maxWidth: 395, margin: 0, color: "#586b60", fontSize: 13, lineHeight: 1.55 },
  searchForm: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 18 },
  input: { flex: "1 1 260px", minWidth: 0, border: "1px solid #9eaa9e", borderRadius: 999, outline: "none", background: "#fffdf7", color: "#10271d", padding: "11px 15px", font: "14px " + BODY_FONT, boxShadow: "inset 0 1px 1px rgba(16, 39, 29, 0.04)" },
  count: { marginLeft: "auto", color: "#506458", fontSize: 11, fontFamily: MONO_FONT, letterSpacing: "0.04em", whiteSpace: "nowrap" },
  safeguard: { display: "flex", alignItems: "center", gap: 9, marginTop: 13, color: "#5b6d61", fontSize: 12, lineHeight: 1.45 },
  safeguardMark: { display: "grid", placeItems: "center", width: 18, height: 18, flex: "0 0 auto", borderRadius: "50%", background: "#d4e8d9", color: "#176b4a", fontSize: 12, fontWeight: 900 },
  list: { listStyle: "none", margin: "20px 0 0", padding: 0, display: "grid", gap: 10 },
  card: { contentVisibility: "auto", containIntrinsicSize: "0 154px", border: "1px solid #cfc6b7", borderLeft: "4px solid #2b7d59", borderRadius: 11, background: "#fffdf7", padding: "16px 15px 16px 17px", display: "grid", gap: 13, boxShadow: "0 5px 16px rgba(33, 49, 40, 0.045)" },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  name: { color: "#112a1f", fontSize: 18, lineHeight: 1.12, fontFamily: DISPLAY_FONT, fontWeight: 700, letterSpacing: "-0.025em" },
  description: { marginTop: 6, color: "#52645a", fontSize: 13, lineHeight: 1.52 },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 },
  badge: { borderRadius: 999, padding: "3px 7px", fontSize: 10, fontFamily: MONO_FONT, letterSpacing: "0.06em", fontWeight: 700 },
  actions: { display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" },
  pagination: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 20, paddingTop: 16, borderTop: "1px solid #c9c0b1", fontSize: 13 },
  error: { marginTop: 15, padding: 13, border: "1px solid #b54e3a", borderRadius: 10, color: "#722d21", background: "#fff4ee", fontFamily: BODY_FONT, fontSize: 13, boxShadow: "0 6px 14px rgba(114, 45, 33, 0.06)" },
  overlay: { position: "fixed", inset: 0, zIndex: 30, display: "grid", placeItems: "center", padding: 18, background: "rgba(10, 27, 19, 0.64)" },
  dialog: { width: "min(760px, 100%)", maxHeight: "min(760px, calc(100vh - 36px))", overflow: "auto", borderRadius: 16, border: "1px solid #cfc6b7", background: "#fffdf7", color: "#10271d", padding: "clamp(20px, 4vw, 30px)", boxShadow: "0 28px 78px rgba(0, 0, 0, 0.34)" },
  dialogHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  dialogTitle: { margin: "7px 0 3px", color: "#10271d", fontFamily: DISPLAY_FONT, fontSize: 31, lineHeight: 1, letterSpacing: "-0.04em" },
  screenshots: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 17 },
  screenshot: { width: "100%", borderRadius: 9, border: "1px solid #d8d1c3", background: "#e7e2d8", aspectRatio: "16 / 9", objectFit: "cover" }
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
function catalogStatus({ count, loaded, loading, error, hasQuery }) {
  if (error) return { metric: "!", label: "\u76EE\u5F55\u9700\u8981\u91CD\u8BD5", trail: "\u4ECD\u4FDD\u7559\u5DF2\u8F7D\u5165\u6761\u76EE", tone: "#f5bd72" };
  if (loading) return { metric: "\u2026", label: "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55", trail: "CATALOG / CONNECTING", tone: "#d7edbc" };
  if (loaded) return { metric: String(count), label: hasQuery ? "\u4E2A\u5339\u914D\u7ED3\u679C" : "\u4E2A\u53EF\u89C1 Web \u6761\u76EE", trail: "CATALOG / LOADED", tone: "#9ee0b9" };
  return { metric: "\u2014", label: "\u7B49\u5F85\u76EE\u5F55\u54CD\u5E94", trail: "CATALOG / STANDBY", tone: "#c9d8cd" };
}
function MarketLanding({ count = 0, loaded = false, loading = false, error = null, hasQuery = false, onBrowse }) {
  const status = catalogStatus({ count, loaded, loading, error, hasQuery });
  return h(
    "header",
    { className: "cordis-mp-landing", style: styles.hero },
    h(
      "div",
      { style: styles.heroGrid },
      h(
        "div",
        { style: styles.heroCopy },
        h("div", { style: styles.eyebrow }, "Cordis.run / DeepSeek Harness / Web"),
        h("h1", { style: styles.heading }, "\u4E3A Harness \u5EFA\u7ACB\u53EF\u63A7\u7684\u63D2\u4EF6\u76EE\u5F55\u3002"),
        h("p", { style: styles.deck }, "\u5148\u770B\u5230\u517C\u5BB9\u6027\u3001\u6765\u6E90\u4E0E\u7248\u672C\uFF1B\u5B89\u88C5\u540E\u4FDD\u6301\u5F85\u542F\u7528\uFF0C\u76F4\u5230\u4F60\u660E\u786E\u9009\u62E9 Activate\u3002\u5E02\u573A\u53EA\u63D0\u4F9B\u4E00\u6761\u53D7\u63A7\u8DEF\u5F84\uFF0C\u4E0D\u4F1A\u66FF\u4F60\u6084\u6084\u8FD0\u884C\u65B0\u63D2\u4EF6\u3002"),
        h(
          "div",
          { style: styles.heroActions },
          h("button", { type: "button", onClick: onBrowse, style: styles.primaryButton }, "\u6D4F\u89C8\u76EE\u5F55 \u2193"),
          h("span", { style: styles.heroNote }, "\u6240\u6709\u5B89\u88C5\u8BF7\u6C42\u4ECD\u9700\u5728\u5177\u4F53\u6761\u76EE\u4E2D\u786E\u8BA4\uFF1B\u542F\u7528\u59CB\u7EC8\u662F\u5355\u72EC\u64CD\u4F5C\u3002")
        )
      ),
      h(
        "aside",
        { className: "cordis-mp-catalog-status", "aria-live": "polite", style: styles.statusCard },
        h(
          "div",
          null,
          h("div", { style: styles.statusKicker }, "\u672C\u6B21\u76EE\u5F55"),
          h("div", { style: styles.statusMetric }, status.metric),
          h("div", { style: styles.statusLabel }, status.label)
        ),
        h(
          "div",
          { style: styles.statusFooter },
          h("span", { "aria-hidden": true, style: { ...styles.statusDot, background: status.tone, boxShadow: "0 0 0 4px " + status.tone + "22" } }),
          status.trail
        )
      )
    ),
    h(
      "section",
      { className: "cordis-mp-install-path", "aria-label": "\u53D7\u63A7\u5B89\u88C5\u8DEF\u5F84", style: styles.path },
      h(
        "div",
        { style: styles.pathIntro },
        h("div", { style: styles.eyebrow }, "\u53D7\u63A7\u5B89\u88C5\u8DEF\u5F84"),
        h("h2", { style: styles.pathTitle }, "\u9ED8\u8BA4\u4E0D\u8FD0\u884C\uFF0C\u76F4\u5230\u4F60\u786E\u8BA4\u3002"),
        h("p", { style: styles.pathCopy }, "\u8FD9\u4E0D\u662F\u516D\u4E2A\u53EF\u8DF3\u8FC7\u7684\u63D0\u793A\uFF0C\u800C\u662F\u5B89\u88C5\u4E8B\u52A1\u4E0E\u663E\u5F0F\u542F\u7528\u4E4B\u95F4\u7684\u5B9E\u9645\u8FB9\u754C\u3002")
      ),
      h("ol", { style: styles.pathList }, INSTALL_PATH.map(([number, label, detail]) => h(
        "li",
        { key: label, style: styles.pathStep },
        h("div", { style: styles.pathNumber }, number),
        h("div", { style: styles.pathLabel }, label),
        h("div", { style: styles.pathDetail }, detail)
      )))
    )
  );
}
function PlatformBadges({ platforms = [] }) {
  const labels = platforms.length ? platforms : ["unknown"];
  return h("div", { className: "cordis-mp-platforms", style: styles.badgeRow }, labels.map((platform) => {
    const tone = platform === "web" ? { background: "#d5eee2", color: "#176b4a" } : platform === "desktop" ? { background: "#dbe6f7", color: "#244f84" } : { background: "#ebe7de", color: "#62625d" };
    return h("span", { key: platform, className: "cordis-mp-platform-badge cordis-mp-platform-" + platform, style: { ...styles.badge, ...tone } }, platform.toUpperCase());
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
      onDismiss ? h("button", { type: "button", onClick: onDismiss, style: { ...styles.quietButton, padding: "2px 8px", border: 0, background: "transparent" } }, "\u5173\u95ED") : null
    ),
    fields.length ? h(
      "details",
      { style: { marginTop: 8 } },
      h("summary", { style: { cursor: "pointer" } }, "\u9519\u8BEF\u8BE6\u60C5"),
      h("dl", { style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", margin: "8px 0 0" } }, fields.flatMap(([label, value]) => [h("dt", { key: label + "-label" }, label), h("dd", { key: label + "-value", style: { margin: 0, overflowWrap: "anywhere" } }, String(value))]))
    ) : null
  );
}
function Pagination({ page, pageNumber, hasPrevious, loading, onPrevious, onNext }) {
  return h(
    "nav",
    { className: "cordis-mp-pagination", "aria-label": "\u5E02\u573A\u5206\u9875", style: styles.pagination },
    h("button", { type: "button", disabled: loading || !hasPrevious, onClick: onPrevious, style: styles.quietButton }, "\u4E0A\u4E00\u9875"),
    h("span", { className: "cordis-mp-page-status", style: { color: "#53685b", fontFamily: MONO_FONT, fontSize: 11 } }, "\u7B2C " + pageNumber + " \u9875 \xB7 \u6BCF\u9875 " + (page?.limit || PAGE_SIZE) + " \u4E2A"),
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
          h("h2", { style: styles.dialogTitle }, item?.name || "\u52A0\u8F7D\u4E2D\u2026"),
          h(PlatformBadges, { platforms: item?.platforms || [] })
        ),
        h("button", { type: "button", onClick: onClose, style: styles.quietButton, "aria-label": "\u5173\u95ED\u8BE6\u60C5" }, "\u5173\u95ED")
      ),
      error ? h(ErrorPanel, { error }) : null,
      loading ? h("p", { style: { color: "#5b6d63" } }, "\u6B63\u5728\u52A0\u8F7D\u8BE6\u60C5\u2026") : h(
        "div",
        null,
        h("p", { style: { ...styles.description, marginTop: 16 } }, description),
        item?.description?.en && item.description.en !== description ? h("p", { style: { ...styles.description, fontStyle: "italic" } }, item.description.en) : null,
        h(
          "dl",
          { style: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", margin: "16px 0 0", fontSize: 13 } },
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
        screenshots.length ? h("div", { className: "cordis-mp-screenshots", style: styles.screenshots }, screenshots.map((url, index) => h("img", { key: url, src: url, alt: (item?.name || "\u63D2\u4EF6") + " \u622A\u56FE " + (index + 1), referrerPolicy: "no-referrer", loading: "lazy", style: styles.screenshot }))) : h("p", { style: { ...styles.description, marginTop: 16 } }, "\u8BE5\u63D2\u4EF6\u6682\u672A\u63D0\u4F9B\u622A\u56FE\u3002")
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
  const [catalogError, setCatalogError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [catalogLoaded, setCatalogLoaded] = React.useState(false);
  const [busySlug, setBusySlug] = React.useState(null);
  const [pendingBySlug, setPendingBySlug] = React.useState({});
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState(null);
  const listRequestId = React.useRef(0);
  const detailRequestId = React.useRef(0);
  const searchInputRef = React.useRef(null);
  const catalogRef = React.useRef(null);
  const load = React.useCallback(async ({ nextQuery, cursor = null, history = [] }) => {
    const requestId = ++listRequestId.current;
    setLoading(true);
    setError(null);
    setCatalogError(null);
    try {
      const result = await controller.search({ q: nextQuery, platform: "web", cursor, limit: PAGE_SIZE });
      if (requestId !== listRequestId.current) return;
      setItems(Array.isArray(result.items) ? result.items : []);
      setCount(Number.isInteger(result.count) ? result.count : 0);
      setPage(result.page || { cursor: null, hasMore: false, limit: PAGE_SIZE });
      setCurrentCursor(cursor);
      setCursorHistory(history);
      setActiveQuery(nextQuery);
      setCatalogLoaded(true);
    } catch (nextError) {
      if (requestId === listRequestId.current) {
        const info = errorInfo(nextError);
        setError(info);
        setCatalogError(info);
      }
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
  function browseCatalog() {
    catalogRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    searchInputRef.current?.focus?.();
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
    if (typeof globalThis.confirm === "function" && !globalThis.confirm("\u786E\u8BA4\u5B89\u88C5\u63D2\u4EF6 " + item.name + "\uFF1F\u5B89\u88C5\u540E\u9ED8\u8BA4\u7981\u7528\uFF0C\u9700\u624B\u52A8\u542F\u7528\u3002")) return;
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
    h(MarketLanding, { count, loaded: catalogLoaded, loading, error: catalogError, hasQuery: Boolean(activeQuery), onBrowse: browseCatalog }),
    h(
      "section",
      { id: "cordis-mp-catalog", ref: catalogRef, tabIndex: -1, "aria-label": "\u63D2\u4EF6\u76EE\u5F55", style: styles.catalog },
      h(
        "div",
        { style: styles.catalogLead },
        h(
          "div",
          null,
          h("div", { style: styles.sectionIndex }, "01 / Browser"),
          h("h2", { style: styles.sectionHeading }, "\u4ECE\u76EE\u5F55\u5F00\u59CB\uFF0C\u800C\u4E0D\u662F\u4ECE\u731C\u6D4B\u5F00\u59CB\u3002")
        ),
        h("p", { style: styles.sectionSummary }, "\u641C\u7D22\u540D\u79F0\u6216 slug\uFF0C\u67E5\u770B\u517C\u5BB9\u5E73\u53F0\u3001\u5DE5\u4EF6\u4FE1\u606F\u4E0E\u622A\u56FE\u3002\u53EA\u6709\u7B26\u5408\u5F53\u524D Web \u5B89\u88C5\u95E8\u69DB\u7684\u6761\u76EE\u624D\u53EF\u5B89\u88C5\u3002")
      ),
      h(
        "form",
        { className: "cordis-mp-market-head", onSubmit: (event) => {
          event.preventDefault();
          search();
        }, style: styles.searchForm },
        h("input", { ref: searchInputRef, value: query, placeholder: "\u641C\u7D22\u63D2\u4EF6\u540D\u79F0\u6216 slug", "aria-label": "\u641C\u7D22\u63D2\u4EF6", onChange: (event) => setQuery(event.target.value), style: styles.input }),
        h("button", { type: "submit", disabled: loading, style: styles.primaryButton }, loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u641C\u7D22"),
        h("span", { className: "cordis-mp-count", style: styles.count, "aria-live": "polite" }, count + " \u4E2A\u7ED3\u679C")
      ),
      h(
        "div",
        { style: styles.safeguard },
        h("span", { "aria-hidden": true, style: styles.safeguardMark }, "\u2713"),
        h("span", null, "\u5B89\u88C5\u4F1A\u5148\u8FDB\u5165\u5F85\u542F\u7528\u72B6\u6001\uFF1B\u53EA\u6709\u4F60\u70B9\u51FB\u201C\u542F\u7528\u201D\u624D\u4F1A\u6FC0\u6D3B\u63D2\u4EF6\u3002")
      ),
      h(ErrorPanel, { error, onDismiss: () => {
        setError(null);
        setCatalogError(null);
      } }),
      h("ul", { className: "cordis-mp-list", style: styles.list }, items.map((item) => h(MarketItem, { key: item.slug, item, pending: pendingBySlug[item.slug] === true, busy: busySlug !== null, onInstall: install, onActivate: activate, onDetail: openDetail }))),
      !loading && items.length === 0 ? h("p", { style: { ...styles.description, textAlign: "center", padding: "24px 0" } }, activeQuery ? "\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6\u3002" : "\u6682\u65E0\u53EF\u5C55\u793A\u7684 Web \u63D2\u4EF6\u3002") : null,
      h(Pagination, { page, pageNumber: cursorHistory.length + 1, hasPrevious: cursorHistory.length > 0, loading, onPrevious: previousPage, onNext: nextPage })
    ),
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
