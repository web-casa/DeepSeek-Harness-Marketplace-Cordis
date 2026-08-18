// apps/web/src/client/index.js
import React2 from "react";

// apps/web/src/client/api.js
function createMarketApi({ fetchImpl = globalThis.fetch, base = "" } = {}) {
  let token = null;
  async function session() {
    const res = await fetchImpl(`${base}/cordis-mp/session`, { method: "POST" });
    if (!res.ok) throw new Error(`session failed: HTTP ${res.status}`);
    const body = await res.json();
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
      throw e;
    }
    return body;
  }
  async function mutation(path, body) {
    if (!token) await session();
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cordis-mp-token": token },
      body: JSON.stringify(body)
    });
    if (res.status === 403) {
      token = null;
      await session();
      return mutation(path, body);
    }
    return json(res);
  }
  return {
    session,
    async catalog(params = {}) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== void 0 && v !== null && v !== "") qs.set(k, String(v));
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
    async search({ q = "", platform = "web", page = 1, perPage = 20 } = {}) {
      const body = await api.catalog({ q, platform, page, perPage });
      return { source: body.source, catalogRevision: body.catalogRevision, count: body.count, page: body.page, items: body.items };
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
function MarketSection({ close, controller }) {
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState([]);
  const [count, setCount] = React.useState(0);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [busySlug, setBusySlug] = React.useState(null);
  const [pendingSlug, setPendingSlug] = React.useState(null);
  async function load(value = q) {
    setLoading(true);
    setError(null);
    try {
      const res = await controller.search({ q: value, platform: "web" });
      setItems(res.items);
      setCount(res.count);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    load("");
  }, []);
  async function install(item) {
    if (globalThis.confirm && !globalThis.confirm(`\u786E\u8BA4\u5B89\u88C5\u63D2\u4EF6 ${item.name}\uFF1F\u5B89\u88C5\u540E\u9ED8\u8BA4\u7981\u7528\uFF0C\u9700\u624B\u52A8\u542F\u7528\u3002`)) return;
    setBusySlug(item.slug);
    try {
      await controller.install(item.slug, item.entryRevision);
      setPendingSlug(item.slug);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlug(null);
    }
  }
  async function activate(item) {
    setBusySlug(item.slug);
    try {
      await controller.activate(item.slug);
      setPendingSlug(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlug(null);
    }
  }
  return React.createElement(
    "div",
    { className: "cordis-mp-market", "data-testid": "cordis-mp-market" },
    React.createElement(
      "div",
      { className: "cordis-mp-market-head" },
      React.createElement("input", { value: q, placeholder: "\u641C\u7D22\u63D2\u4EF6", onChange: (e) => setQ(e.target.value), onKeyDown: (e) => {
        if (e.key === "Enter") load();
      } }),
      React.createElement("button", { onClick: () => load(), disabled: loading }, loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u641C\u7D22"),
      React.createElement("span", { className: "cordis-mp-count" }, String(count))
    ),
    error ? React.createElement("div", { className: "cordis-mp-error" }, error) : null,
    React.createElement(
      "ul",
      { className: "cordis-mp-list" },
      (items || []).map((item) => React.createElement(
        "li",
        { key: item.slug, className: "cordis-mp-item" },
        React.createElement(
          "div",
          { className: "cordis-mp-item-main" },
          React.createElement("span", { className: "cordis-mp-name" }, item.name),
          React.createElement("span", { className: "cordis-mp-desc" }, item.description?.zh || ""),
          React.createElement("span", { className: "cordis-mp-platforms" }, (item.platforms || []).join("/"))
        ),
        pendingSlug === item.slug ? React.createElement("button", { disabled: busySlug === item.slug, onClick: () => activate(item) }, busySlug === item.slug ? "\u542F\u7528\u4E2D\u2026" : "\u542F\u7528") : React.createElement("button", { disabled: busySlug === item.slug, onClick: () => install(item) }, busySlug === item.slug ? "\u5B89\u88C5\u4E2D\u2026" : "\u5B89\u88C5")
      ))
    )
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
