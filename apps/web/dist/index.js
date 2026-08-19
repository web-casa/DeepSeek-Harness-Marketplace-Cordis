// apps/web/src/index.js
import { readFileSync as readFileSync8 } from "node:fs";
import { join as join8 } from "node:path";

// packages/catalog-core/src/schema.mjs
var HASH_RE = /^sha(256|512)-[A-Za-z0-9+/=]+$/;
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
var CatalogSchemaError = class extends Error {
};
function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function normalizeLocalized(value, fallback = "") {
  if (typeof value === "string") return { zh: value, en: value };
  if (isObject(value)) return { zh: typeof value.zh === "string" ? value.zh : fallback, en: typeof value.en === "string" ? value.en : fallback };
  return { zh: fallback, en: fallback };
}
function normalizeSource(item) {
  const source = isObject(item.source) ? item.source : null;
  const flat = { packageName: item.npm ?? null, version: item.version ?? null, integrity: item.integrity ?? null };
  return {
    type: source?.type ?? (flat.packageName ? "npm" : null),
    packageName: source?.packageName ?? flat.packageName,
    version: source?.version ?? flat.version,
    integrity: source?.integrity ?? flat.integrity,
    registry: source?.registry ?? "https://registry.npmjs.org",
    tarball: source?.tarball ?? null
  };
}
function normalizePage(body, perPage) {
  const page = body?.page;
  if (Number.isInteger(page)) return { cursor: String(page), hasMore: false, limit: perPage ?? body?.per_page ?? 50 };
  if (isObject(page)) {
    const limit = Number.isInteger(page.limit) ? page.limit : Number.isInteger(page.per_page) ? page.per_page : perPage ?? 50;
    const cursor = typeof page.cursor === "string" ? page.cursor : Number.isInteger(page.page) ? String(page.page) : null;
    return { cursor, hasMore: page.hasMore === true, limit };
  }
  return { cursor: null, hasMore: false, limit: perPage ?? 50 };
}
function validateCatalog(body) {
  if (!isObject(body) || body.schemaVersion !== 1) throw new CatalogSchemaError("schemaVersion must be 1");
  if (typeof body.catalogRevision !== "string") throw new CatalogSchemaError("catalogRevision required");
  if (!Array.isArray(body.items)) throw new CatalogSchemaError("items must be an array");
  const count = Number.isInteger(body.count) ? body.count : body.items.length;
  const page = normalizePage(body, body.per_page);
  const categories = isObject(body.categories) ? body.categories : {};
  return { ...body, count, page, categories, items: body.items };
}
function validateCatalogItem(item) {
  if (!isObject(item) || typeof item.slug !== "string" || item.slug.length === 0) throw new CatalogSchemaError("item.slug required");
  const source = normalizeSource(item);
  return {
    slug: item.slug,
    name: typeof item.name === "string" ? item.name : item.slug,
    description: normalizeLocalized(item.description, item.name ?? ""),
    category: typeof item.category === "string" ? item.category : null,
    homepage: typeof item.homepage === "string" ? item.homepage : null,
    platforms: Array.isArray(item.platforms) ? item.platforms.filter((x) => typeof x === "string") : ["unknown"],
    engines: isObject(item.engines) ? item.engines : {},
    stars: Number.isInteger(item.stars) ? item.stars : 0,
    blocked: item.blocked === true,
    deprecated: item.deprecated === true,
    replacementSlug: typeof item.replacementSlug === "string" ? item.replacementSlug : null,
    entryRevision: typeof item.entryRevision === "string" ? item.entryRevision : null,
    entryIds: Array.isArray(item.entryIds) ? item.entryIds.filter((x) => typeof x === "string") : [],
    installHint: typeof item.installHint === "string" ? item.installHint : null,
    source
  };
}
function installability(item, platform = "web") {
  const reasons = [];
  const src = item.source;
  if (src.type !== "npm") reasons.push("non-npm-source");
  else {
    if (!src.packageName || !NPM_NAME_RE.test(src.packageName)) reasons.push("bad-package-name");
    if (typeof src.version !== "string" || !/^\d+\.\d+\.\d+/.test(src.version)) reasons.push("bad-version");
    if (typeof src.integrity !== "string" || !HASH_RE.test(src.integrity)) reasons.push("missing-integrity");
    if (!["https://registry.npmjs.org"].includes(src.registry)) reasons.push("registry-not-allowed");
    if (src.tarball) {
      try {
        if (new URL(src.tarball).hostname !== new URL(src.registry).hostname) reasons.push("tarball-host-mismatch");
      } catch {
        reasons.push("bad-tarball-url");
      }
    }
  }
  if (!item.platforms.includes(platform) && !item.platforms.includes("unknown")) reasons.push(`platform-${item.platforms.join("+")}`);
  if (item.blocked) reasons.push("blocked");
  if (item.deprecated) reasons.push("deprecated");
  if (item.engines?.dsh && !item.engines.dsh.startsWith(">=")) reasons.push("bad-engines-dsh");
  return { installable: reasons.length === 0, reasons, reason: reasons.join(",") };
}

// packages/catalog-core/src/catalog.mjs
var CatalogError = class extends Error {
  constructor(code, message, { status = 0, requestId = null, retryAfter = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
};
var DEFAULT_BASE = "https://cordis.run/api/v1";
function isContractScreenshot(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.cordis.run";
  } catch {
    return false;
  }
}
var CatalogClient = class {
  constructor({ baseUrl = DEFAULT_BASE, fetchImpl = fetch, snapshot = null, cacheTtlMs = 6e4, staleIfErrorMs = 24 * 60 * 60 * 1e3 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.snapshot = snapshot ? validateCatalog(snapshot) : null;
    this.cacheTtlMs = cacheTtlMs;
    this.staleIfErrorMs = staleIfErrorMs;
    this.cache = /* @__PURE__ */ new Map();
  }
  #cacheKey(path) {
    return `${this.baseUrl}${path}`;
  }
  #cached(key) {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.cacheTtlMs && Date.now() - hit.at > this.staleIfErrorMs) return null;
    return hit;
  }
  async #request(path, { fresh = false, catalog = true } = {}) {
    const key = this.#cacheKey(path);
    const hit = this.cache.get(key);
    const headers = { accept: "application/json" };
    if (fresh) headers["cache-control"] = "no-cache";
    else if (hit?.etag) headers["if-none-match"] = hit.etag;
    let res;
    try {
      res = await this.fetchImpl(key, { method: "GET", headers, redirect: "error" });
    } catch (e) {
      const stale2 = this.#cached(key);
      if (stale2) return { ...stale2, source: "stale-cache" };
      if (this.snapshot) return { source: "snapshot", ...this.#snapshotFor(path) };
      throw new CatalogError("NETWORK", `catalog request failed: ${e.message}`);
    }
    if (res.status === 304) {
      const cached = hit;
      if (cached) return { ...cached, source: "cache" };
      throw new CatalogError("NO_CACHE", "server returned 304 but no cache entry exists", { status: 304 });
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CatalogError("BAD_JSON", "catalog response was not JSON", { status: res.status });
    }
    if (!res.ok) {
      const e = body?.error || {};
      throw new CatalogError(e.code || "HTTP_ERROR", e.message || `HTTP ${res.status}`, { status: res.status, requestId: e.requestId, retryAfter: e.retryAfter });
    }
    let normalizedBody = body;
    if (catalog) normalizedBody = validateCatalog(body);
    const entry = { data: normalizedBody, etag: res.headers?.get?.("etag") || null, at: Date.now(), source: "network" };
    this.cache.set(key, entry);
    return entry;
  }
  #snapshotFor(path) {
    const url = new URL(path, "http://x");
    const q2 = url.searchParams;
    let items = (this.snapshot.items || []).map(validateCatalogItem);
    const platform = q2.get("platform");
    if (platform) items = items.filter((i) => i.platforms.includes(platform));
    const term = (q2.get("q") || "").toLowerCase();
    if (term) items = items.filter((i) => i.slug.toLowerCase().includes(term) || i.name.toLowerCase().includes(term));
    const page = parseInt(q2.get("page") || q2.get("cursor") || "1", 10) || 1;
    const perPage = parseInt(q2.get("per_page") || q2.get("limit") || "50", 10) || 50;
    const start = (page - 1) * perPage;
    return { data: { ...this.snapshot, count: items.length, page: { cursor: String(page), hasMore: start + perPage < items.length, limit: perPage }, items: items.slice(start, start + perPage) } };
  }
  async list(options = {}) {
    const qs2 = new URLSearchParams();
    for (const k2 of ["q", "category", "platform", "sort", "order"]) if (options[k2] !== void 0 && options[k2] !== null && options[k2] !== "") qs2.set(k2, options[k2]);
    if (options.page) qs2.set("page", String(options.page));
    if (options.perPage) qs2.set("per_page", String(options.perPage));
    if (options.cursor) qs2.set("cursor", String(options.cursor));
    if (options.limit) qs2.set("limit", String(options.limit));
    const res = await this.#request(`/plugins?${qs2}`);
    return { source: res.source, catalogRevision: res.data.catalogRevision, count: res.data.count, page: res.data.page, categories: res.data.categories, items: res.data.items.map(validateCatalogItem) };
  }
  async detail(slug, { fresh = false } = {}) {
    if (typeof slug !== "string" || !slug) throw new CatalogError("BAD_SLUG", "slug is required");
    const res = await this.#request(`/plugins/${encodeURIComponent(slug)}`, { fresh, catalog: false });
    const item = Array.isArray(res.data.items) ? res.data.items.find((i) => i.slug === slug) : res.data;
    if (!item) throw new CatalogError("BAD_DETAIL", "detail response has no matching item");
    const normalized = validateCatalogItem(item);
    return {
      ...normalized,
      source: normalized.source,
      catalogRevision: res.data.catalogRevision ?? null,
      versions: Array.isArray(res.data.versions) ? res.data.versions : [],
      screenshots: Array.isArray(res.data.screenshots) ? res.data.screenshots.filter(isContractScreenshot) : []
    };
  }
  async fetchFresh(slug) {
    return this.detail(slug, { fresh: true });
  }
  installability(item, platform = "web") {
    return installability(item, platform);
  }
};

// packages/web-harness/src/catalog-routes.mjs
var PREFIX = "/cordis-mp";
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function parseListQuery(url) {
  const q2 = url.searchParams.get("q") || "";
  const category = url.searchParams.get("category") || void 0;
  const platform = url.searchParams.get("platform") || "web";
  const sort = url.searchParams.get("sort") || void 0;
  const order = url.searchParams.get("order") || void 0;
  const cursor = url.searchParams.get("cursor") || void 0;
  const rawLimit = url.searchParams.get("limit");
  if (cursor || rawLimit !== null) {
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit || "50", 10) || 50));
    return { q: q2 || void 0, category, platform, sort, order, cursor, limit };
  }
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const perPage = parseInt(url.searchParams.get("per_page") || "50", 10) || 50;
  return { q: q2 || void 0, category, platform, sort, order, page, perPage };
}
function createCatalogHandler(catalog) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" });
        res.end();
        return;
      }
      if (url.pathname === `${PREFIX}/catalog`) {
        const result = await catalog.list(parseListQuery(url));
        return json(res, 200, { ok: true, ...result });
      }
      const m2 = url.pathname.match(/^\/cordis-mp\/plugin\/([^/]+)$/);
      if (m2) {
        const slug = decodeURIComponent(m2[1]);
        const detail = await catalog.detail(slug);
        return json(res, 200, { ok: true, plugin: detail });
      }
      if (url.pathname === `${PREFIX}/health`) return json(res, 200, { ok: true, service: "cordis-mp-catalog" });
      json(res, 404, { error: { code: "NOT_FOUND", message: "no such route" } });
    } catch (e) {
      if (e instanceof CatalogError) return json(res, e.status || 502, { error: { code: e.code, message: e.message, requestId: e.requestId, retryAfter: e.retryAfter } });
      json(res, 500, { error: { code: "INTERNAL", message: e?.message || String(e) } });
    }
  };
}
function mountCatalogRoutes(webServer, catalog) {
  const handler = createCatalogHandler(catalog);
  const disposers = [
    webServer.register({ kind: "exact", path: `${PREFIX}/catalog`, handler }),
    webServer.register({ kind: "exact", path: `${PREFIX}/health`, handler }),
    webServer.register({ kind: "prefix", path: `${PREFIX}/plugin`, handler })
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

// packages/install-core/src/install-service.mjs
import { readFileSync as readFileSync5, existsSync as existsSync5 } from "node:fs";
import { join as join4 } from "node:path";

// packages/journal-core/src/journal.mjs
import { existsSync as existsSync4, readFileSync as readFileSync4, mkdirSync as mkdirSync3, readdirSync as readdirSync3, statSync as statSync4, copyFileSync } from "node:fs";
import { join as join3, dirname as dirname2 } from "node:path";
import { randomBytes as randomBytes3 } from "node:crypto";

// packages/journal-core/src/durable.mjs
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, existsSync, appendFileSync, readFileSync, chmodSync, linkSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";

// packages/journal-core/src/failpoints.mjs
var registry = /* @__PURE__ */ new Map();
function failpoint(name2, ctx = {}) {
  const item = registry.get(name2);
  if (!item) return;
  item.count++;
  if (item.count > item.times) return;
  return item.fn(ctx);
}

// packages/journal-core/src/durable.mjs
var fsyncWarning = false;
function fsyncDir(dir) {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (process.platform === "win32" && ["EISDIR", "EPERM", "EINVAL", "ENOTSUP"].includes(e.code)) {
      if (!fsyncWarning) {
        console.warn("[journal-core] dir fsync unavailable on win32; durability tier=BEST_EFFORT");
        fsyncWarning = true;
      }
      return;
    }
    throw e;
  }
}
function atomicFile(path, content, { mode = 384, exclusive = false } = {}) {
  failpoint("atomicFile:before", { path, exclusive });
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const tmp = join(dirname(path), `.tmp-${randomBytes(6).toString("hex")}`);
  const fd = openSync(tmp, "wx", mode);
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, mode);
  const fd2 = openSync(tmp, "r");
  try {
    fsyncSync(fd2);
  } finally {
    closeSync(fd2);
  }
  failpoint("atomicFile:after-write", { path, exclusive });
  if (exclusive) {
    try {
      linkSync(tmp, path);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
      }
      ;
      throw e;
    }
    try {
      unlinkSync(tmp);
    } catch {
    }
    failpoint("atomicFile:after-publish", { path, exclusive });
  } else {
    renameSync(tmp, path);
    failpoint("atomicFile:after-publish", { path, exclusive });
  }
  failpoint("atomicFile:before-dirfsync", { path, exclusive });
  fsyncDir(dirname(path));
  failpoint("atomicFile:after-dirfsync", { path, exclusive });
}
function appendRecord(path, line) {
  failpoint("appendRecord:before", { path });
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const fd = openSync(path, "a", 384);
  try {
    writeFileSync(fd, line + "\n");
  } finally {
    closeSync(fd);
  }
  failpoint("appendRecord:after-write", { path });
  const fd2 = openSync(path, "r");
  try {
    fsyncSync(fd2);
  } finally {
    closeSync(fd2);
  }
  failpoint("appendRecord:before-dirfsync", { path });
  fsyncDir(dirname(path));
  failpoint("appendRecord:after-dirfsync", { path });
}
function marker(path) {
  failpoint("marker:before", { path });
  atomicFile(path, "", { exclusive: true });
  failpoint("marker:after", { path });
}
function replaceTarget(path, data, mode = 384) {
  failpoint("replaceTarget:before", { path });
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const tmp = join(dirname(path), `.tmp-target-${randomBytes(6).toString("hex")}`);
  const fd = openSync(tmp, "wx", mode);
  try {
    writeFileSync(fd, data);
  } finally {
    closeSync(fd);
  }
  failpoint("replaceTarget:after-write", { path });
  chmodSync(tmp, mode);
  const fd2 = openSync(tmp, "r");
  try {
    fsyncSync(fd2);
  } finally {
    closeSync(fd2);
  }
  failpoint("replaceTarget:before-rename", { path });
  renameSync(tmp, path);
  failpoint("replaceTarget:after-rename", { path });
  fsyncDir(dirname(path));
  failpoint("replaceTarget:after-dirfsync", { path });
}
function unlinkTargetDurable(path) {
  failpoint("unlinkTarget:before", { path });
  unlinkSync(path);
  failpoint("unlinkTarget:after-unlink", { path });
  fsyncDir(dirname(path));
  failpoint("unlinkTarget:after-dirfsync", { path });
}
function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
function tombstone(kind, dir) {
  failpoint("tombstone:before", { kind, dir });
  if (!existsSync(dir)) return;
  const trashRoot = join(dirname(dirname(dir)), "trash");
  mkdirSync(trashRoot, { recursive: true, mode: 448 });
  const target = join(trashRoot, `${kind}-${basename(dir)}-${randomBytes(6).toString("hex")}`);
  renameSync(dir, target);
  failpoint("tombstone:after-rename", { kind, dir, target });
  fsyncDir(dirname(dir));
  failpoint("tombstone:after-src-fsync", { kind, dir, target });
  fsyncDir(trashRoot);
  failpoint("tombstone:after-dirfsync", { kind, dir, target });
  rmSync(target, { recursive: true, force: true });
}
function sweepTrash(root, { olderThanMs = 60 * 60 * 1e3 } = {}) {
  const trashRoot = join(root, "trash");
  if (!existsSync(trashRoot)) return;
  for (const name2 of readdirSync(trashRoot)) {
    const p2 = join(trashRoot, name2);
    try {
      if (Date.now() - statSync(p2).mtimeMs < olderThanMs) continue;
      rmSync(p2, { recursive: true, force: true });
    } catch {
    }
  }
}

// packages/journal-core/src/lock.mjs
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, rmSync as rmSync2, existsSync as existsSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { randomBytes as randomBytes2 } from "node:crypto";
var STALE_MS = 3e4;
var PROCESS_TOKEN = randomBytes2(8).toString("hex");
var LockBusy = class extends Error {
  constructor(reason = "lock busy") {
    super(reason);
    this.code = "LOCK_BUSY";
  }
};
var LockFenced = class extends Error {
  constructor() {
    super("lock token mismatch");
    this.code = "LOCK_FENCED";
  }
};
function processStartTicks(pid) {
  if (process.platform !== "linux") return null;
  try {
    const stat = readFileSync2(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    return Number(stat.slice(close + 1).trim().split(/\s+/)[19]);
  } catch {
    return null;
  }
}
function ownerAlive(rec) {
  if (!rec || !Number.isInteger(rec.pid)) return false;
  try {
    process.kill(rec.pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "linux" && Number.isInteger(rec.processStartTicks)) {
    const ticks = processStartTicks(rec.pid);
    if (ticks !== null && ticks !== rec.processStartTicks) return false;
  }
  return true;
}
function stale(rec) {
  return Date.now() - (rec.heartbeatAt ?? 0) > STALE_MS;
}
var FileLock = class {
  constructor(root) {
    this.root = root;
    this.dir = join2(root, "lock");
    this.ownerPath = join2(this.dir, "owner.json");
    this.hbPath = join2(this.dir, "heartbeat.json");
    this.record = null;
  }
  #readOwner(path) {
    try {
      return JSON.parse(readFileSync2(path, "utf8"));
    } catch {
      return null;
    }
  }
  #stolenState() {
    const names = readdirSync2(this.root).filter((n) => n.startsWith("lock.stolen-"));
    if (names.length === 0) return null;
    let newest = null;
    for (const name2 of names) {
      const p2 = join2(this.root, name2);
      try {
        const st2 = statSync2(p2);
        if (!newest || st2.mtimeMs > newest.mtimeMs) newest = { name: name2, path: p2, mtimeMs: st2.mtimeMs, owner: this.#readOwner(join2(p2, "owner.json")) };
      } catch {
      }
    }
    return newest;
  }
  acquire(scope = "mutation", { wait = false } = {}) {
    mkdirSync2(this.root, { recursive: true, mode: 448 });
    const rec = {
      owner: "journal-core",
      scope,
      bootId: randomBytes2(8).toString("hex"),
      pid: process.pid,
      processStartToken: PROCESS_TOKEN,
      ownerToken: randomBytes2(16).toString("hex"),
      epoch: 1,
      acquiredAt: Date.now(),
      heartbeatAt: Date.now(),
      processStartTicks: processStartTicks(process.pid) ?? void 0
    };
    for (; ; ) {
      const stolen = this.#stolenState();
      if (stolen) {
        const age = Date.now() - stolen.mtimeMs;
        if (age < 5e3) {
          if (!existsSync2(this.dir)) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
            continue;
          }
        }
        if (!existsSync2(this.dir) && stolen.owner && !ownerAlive(stolen.owner) && stale(stolen.owner)) {
          rec.epoch = (stolen.owner.epoch ?? 0) + 1;
        }
      }
      try {
        mkdirSync2(this.dir, { mode: 448 });
        const gapStolen = this.#stolenState();
        if (gapStolen?.owner && !ownerAlive(gapStolen.owner) && stale(gapStolen.owner)) {
          rec.epoch = (gapStolen.owner.epoch ?? 0) + 1;
        }
        try {
          atomicFile(this.ownerPath, JSON.stringify(rec), { mode: 384 });
          atomicFile(this.hbPath, JSON.stringify({ heartbeatAt: rec.heartbeatAt }), { mode: 384 });
          this.record = rec;
          return rec;
        } catch (inner) {
          try {
            rmSync2(this.dir, { recursive: true, force: true });
          } catch {
          }
          throw inner;
        }
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let cur = this.#readOwner(this.ownerPath);
        if (!cur) throw new LockBusy("lock dir exists but owner unreadable");
        if (ownerAlive(cur) || !stale(cur)) {
          if (!wait) throw new LockBusy("owner alive or heartbeat fresh");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          continue;
        }
        const tag = randomBytes2(6).toString("hex");
        const stolen2 = this.dir + ".stolen-" + tag;
        try {
          renameSync2(this.dir, stolen2);
        } catch (e2) {
          if (e2.code === "ENOENT") continue;
          throw e2;
        }
        const stolenOwner = this.#readOwner(join2(stolen2, "owner.json"));
        if (!stolenOwner || stolenOwner.ownerToken !== cur.ownerToken || stolenOwner.processStartToken !== cur.processStartToken) {
          try {
            renameSync2(stolen2, this.dir);
          } catch {
          }
          ;
          throw new LockBusy("stolen owner changed");
        }
        if (ownerAlive(stolenOwner) || !stale(stolenOwner)) {
          if (!existsSync2(this.dir)) try {
            renameSync2(stolen2, this.dir);
          } catch {
          }
          throw new LockBusy("owner revived or heartbeat fresh");
        }
        rec.epoch = (cur.epoch ?? 0) + 1;
        try {
          mkdirSync2(this.dir, { mode: 448 });
        } catch (e3) {
          if (e3.code === "EEXIST") throw new LockBusy("cas lost to another takeover");
          throw e3;
        }
        atomicFile(this.ownerPath, JSON.stringify(rec), { mode: 384 });
        atomicFile(this.hbPath, JSON.stringify({ heartbeatAt: rec.heartbeatAt }), { mode: 384 });
        this.record = rec;
        return rec;
      }
    }
  }
  heartbeat() {
    if (!this.record) throw new LockBusy("no lease");
    this.fence();
    const rec = { ...this.record, heartbeatAt: Date.now() };
    atomicFile(this.ownerPath, JSON.stringify(rec), { mode: 384 });
    atomicFile(this.hbPath, JSON.stringify({ heartbeatAt: rec.heartbeatAt }), { mode: 384 });
    this.record = rec;
  }
  fence() {
    if (!this.record) throw new LockBusy("no lease");
    const cur = this.#readOwner(this.ownerPath);
    if (!cur || cur.ownerToken !== this.record.ownerToken || cur.epoch !== this.record.epoch) throw new LockFenced();
  }
  release() {
    if (!this.record) return;
    const cur = this.#readOwner(this.ownerPath);
    if (cur && cur.ownerToken === this.record.ownerToken) {
      rmSync2(this.dir, { recursive: true, force: true });
      fsyncDir(this.root);
    }
    this.record = null;
  }
};
async function withFileLock(lock, scope, operation) {
  if (!lock || typeof lock.acquire !== "function" || typeof lock.release !== "function") {
    throw new TypeError("a FileLock is required for a mutating operation");
  }
  lock.acquire(scope);
  try {
    return await operation();
  } finally {
    lock.release();
  }
}
function sweepLockDebris(root, { olderThanMs = 6e4 } = {}) {
  if (!existsSync2(root)) return;
  for (const name2 of readdirSync2(root)) {
    if (!name2.startsWith("lock.stolen-")) continue;
    const p2 = join2(root, name2);
    try {
      if (!statSync2(p2).isDirectory()) continue;
      if (Date.now() - statSync2(p2).mtimeMs > olderThanMs) rmSync2(p2, { recursive: true, force: true });
    } catch {
    }
  }
}

// packages/journal-core/src/state.mjs
import { createHash } from "node:crypto";
import { existsSync as existsSync3, readFileSync as readFileSync3, statSync as statSync3 } from "node:fs";
var sha256 = (data) => "sha256:" + createHash("sha256").update(data).digest("hex");
function fileState(path) {
  if (!existsSync3(path)) return { exists: false, hash: null };
  return { exists: true, hash: sha256(readFileSync3(path)) };
}
function targetKey(rel) {
  return createHash("sha256").update(rel).digest("hex");
}
function modeOf(path) {
  try {
    return (statSync3(path).mode & 511).toString(8).padStart(3, "0");
  } catch {
    return null;
  }
}

// packages/journal-core/src/reducer.mjs
var PHASES = ["INTENDED", "CONFIRMED", "CANCELLED"];
var KINDS = ["FORWARD", "ROLLBACK"];
var HASH_RE2 = /^sha256:[0-9a-f]{64}$/;
function validFileState(s3) {
  if (!s3 || typeof s3 !== "object" || typeof s3.exists !== "boolean") return false;
  if (s3.exists) return typeof s3.hash === "string" && HASH_RE2.test(s3.hash);
  return s3.hash === null;
}
function sameState(a, b2) {
  return a && b2 && a.exists === b2.exists && a.hash === b2.hash;
}
function validateCommon(op, { txid, rel }) {
  if (op.v !== 1) throw { code: "BAD_OP", message: "op v != 1" };
  if (op.next.exists) {
    if (typeof op.length !== "number" || !Number.isInteger(op.length) || op.length < 0) throw { code: "BAD_OP", message: "bad length for present next" };
    if (typeof op.mode !== "string" || !/^0?[0-7]{3}$/.test(op.mode)) throw { code: "BAD_OP", message: "bad mode" };
  } else if (op.length !== void 0 || op.mode !== void 0) {
    throw { code: "BAD_OP", message: "length/mode must be absent for absent next" };
  }
  if (op.txid !== txid) throw { code: "BAD_OP", message: "op txid mismatch" };
  if (op.targetKey !== targetKey(rel)) throw { code: "BAD_OP", message: "op targetKey mismatch" };
  if (!PHASES.includes(op.phase)) throw { code: "BAD_OP", message: "bad phase" };
  if (!KINDS.includes(op.kind)) throw { code: "BAD_OP", message: "bad kind" };
  if (!Number.isInteger(op.seq) || op.seq < 1) throw { code: "BAD_OP", message: "bad seq" };
  if (op.opId !== `${txid}-${op.seq}`) throw { code: "BAD_OP", message: "opId/seq mismatch" };
  if (!validFileState(op.expected) || !validFileState(op.next) || !validFileState(op.before)) throw { code: "BAD_OP", message: "bad file state" };
}
function parseOpLog(lines, { txid, rel }) {
  const groups = [];
  let current = null;
  let expectedSeq = 1;
  let truncatedTail = false;
  lines.forEach((line, index) => {
    if (line === "") return;
    let op;
    try {
      op = JSON.parse(line);
    } catch {
      if (index === lines.length - 1) {
        truncatedTail = true;
        return;
      }
      throw { code: "BAD_OP", message: `bad json line ${index}` };
    }
    validateCommon(op, { txid, rel });
    if (op.phase === "INTENDED") {
      if (op.seq !== expectedSeq) throw { code: "BAD_OP", message: `physical seq gap: expected ${expectedSeq} got ${op.seq}` };
      if (current && current.length === 1) throw { code: "BAD_OP", message: "unresolved op before new INTENDED" };
      current = [op];
      groups.push(current);
      expectedSeq = op.seq + 1;
      return;
    }
    if (!current) throw { code: "BAD_OP", message: "terminal phase without INTENDED" };
    if (current[0].opId !== op.opId || current[0].seq !== op.seq) throw { code: "BAD_OP", message: "terminal opId/seq mismatch" };
    if (current.length >= 2) throw { code: "BAD_OP", message: "duplicate terminal phase" };
    for (const k2 of ["seq", "opId", "kind", "expected", "next", "before", "mode", "length", "v", "txid", "targetKey"]) {
      if (JSON.stringify(current[0][k2]) !== JSON.stringify(op[k2])) throw { code: "BAD_OP", message: `phase records differ: ${k2}` };
    }
    current.push(op);
  });
  const records = groups.flat();
  return { records, groups, truncatedTail };
}
function reduceOps(parsed, baseline) {
  const { groups } = parsed;
  let owned = baseline.state;
  groups.forEach((group) => {
    const op = group[0];
    if (!sameState(op.before, owned)) throw { code: "BAD_OP", message: "op before != previous owned" };
    if (!sameState(op.expected, owned)) throw { code: "BAD_OP", message: "expected chain mismatch" };
    if (op.kind === "ROLLBACK" && !sameState(op.next, baseline.state)) throw { code: "BAD_OP", message: "rollback next != baseline" };
    const final = group[group.length - 1];
    if (final.phase === "CONFIRMED") owned = final.next;
  });
  const last = groups.length ? groups[groups.length - 1] : null;
  const pending = last && last.length === 1 && last[0].phase === "INTENDED" ? last[0] : null;
  return { owned, pending, records: parsed.records, groups };
}
function classifyTarget(parsed, baseline, current) {
  const { owned, pending } = reduceOps(parsed, baseline);
  if (pending) {
    if (sameState(current, pending.expected)) return { conflict: false, owned, pending, pendingAction: "CANCELLED" };
    if (sameState(current, pending.next)) return { conflict: false, owned: pending.next, pending, pendingAction: "CONFIRMED" };
    return { conflict: true, owned, pending, pendingAction: null };
  }
  if (!sameState(current, owned)) return { conflict: true, owned, pending: null, pendingAction: null };
  return { conflict: false, owned, pending: null, pendingAction: null };
}

// packages/journal-core/src/schema.mjs
var HASH_RE3 = /^sha256:[0-9a-f]{64}$/;
function isFileState(s3) {
  if (!s3 || typeof s3 !== "object" || typeof s3.exists !== "boolean") return false;
  if (s3.exists) return typeof s3.hash === "string" && HASH_RE3.test(s3.hash);
  return s3.hash === null;
}
function validateBaseline(b2) {
  if (!b2 || !isFileState(b2.state)) throw new Error("baseline.state invalid");
  if (b2.state.exists) {
    if (!Number.isInteger(b2.length) || b2.length < 0) throw new Error("baseline.length invalid");
    if (typeof b2.mode !== "string" || !/^0?[0-7]{3}$/.test(b2.mode)) throw new Error("baseline.mode invalid");
  }
  return b2;
}
function validateManifest(m2) {
  if (!m2 || m2.v !== 1 || typeof m2.txid !== "string" || typeof m2.createdAt !== "number") throw new Error("manifest header invalid");
  if (!["PREPARING", "PREPARED", "MUTATING", "FILE_COMMITTED", "CONFLICTED"].includes(m2.state)) throw new Error("manifest state invalid");
  if (!m2.targets || typeof m2.targets !== "object" || Object.keys(m2.targets).length === 0) throw new Error("manifest targets empty");
  for (const [rel, b2] of Object.entries(m2.targets)) {
    if (typeof rel !== "string" || rel.length === 0 || rel.includes("..") || rel.startsWith("/")) throw new Error("manifest target rel invalid");
    validateBaseline(b2);
  }
  return m2;
}
function validateOutcome(o) {
  if (!o || o.v !== 1 || typeof o.txid !== "string" || !["ROLLED_BACK", "COMMITTED"].includes(o.outcome)) throw new Error("outcome invalid");
  return o;
}
function validateConflictReport(r) {
  if (!r || r.v !== 1 || typeof r.txid !== "string" || !Array.isArray(r.conflicts)) throw new Error("report invalid");
  for (const c of r.conflicts) {
    if (!c || typeof c.rel !== "string" || !isFileState(c.state)) throw new Error("report conflict invalid");
  }
  if (r.evidence !== void 0) {
    if (!Array.isArray(r.evidence)) throw new Error("report evidence invalid");
    for (const e of r.evidence) {
      if (!e || typeof e.name !== "string" || typeof e.hash !== "string" || !Number.isInteger(e.length) || e.length < 0) throw new Error("report evidence entry invalid");
    }
  }
  return r;
}
var RESULT_ENUM = [
  "CLEAN",
  "COMMITTED_OK",
  "ROLLED_BACK",
  "CONFLICTED",
  "CONFLICTED_EXISTING",
  "BAD_MANIFEST",
  "BAD_OUTCOME",
  "BAD_REPORT",
  "BAD_EVIDENCE",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_BAD",
  "BAD_OP",
  "ACTIVE_TX",
  "RESOLVED",
  "RESOLUTION_CONFLICTED",
  "ACCEPTED_CURRENT",
  "SUPERSEDED",
  "WAITING_AUTHORIZATION",
  "WAITING_VALIDATION",
  "CLEANED_TERMINAL",
  "CLEANED_SUPERSEDED",
  "NO_HEAD",
  "BAD_GRAPH",
  "MULTIPLE_HEADS",
  "BAD_PLAN",
  "BAD_ACTION",
  "BAD_VALIDATION",
  "NO_VALIDATOR",
  "JOURNALLED",
  "NOT_TERMINAL",
  "FINGERPRINT_MISMATCH",
  "UNRECOVERABLE_RESTORE",
  "NO_VALIDATION"
];
function makeRecoveryReport(entries) {
  const report = { v: 1, entries };
  validateRecoveryReport(report);
  return report;
}
function validateRecoveryReport(r) {
  if (!r || r.v !== 1 || !Array.isArray(r.entries)) throw new Error("recovery report invalid");
  for (const e of r.entries) {
    if (!e || typeof e.txid !== "string" || !RESULT_ENUM.includes(e.result)) throw new Error("recovery report entry invalid");
  }
  return r;
}

// packages/journal-core/src/journal.mjs
var ALLOWED = /* @__PURE__ */ new Set(["package.json", "pnpm-lock.yaml", "cordis.patch.yml", ".cordis-mp/state.json", ".cordis-mp/pending-activation.json"]);
var JournalError = class extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
};
var Journal = class {
  constructor({ journalRoot, profileRoot, lock = null }) {
    this.root = journalRoot;
    this.profile = profileRoot;
    this.txDir = join3(journalRoot, "journal");
    this.lock = lock;
  }
  #assertRel(rel) {
    if (!ALLOWED.has(rel)) throw new JournalError("BAD_TARGET", "target not allowed: " + rel);
  }
  #txDir(tx) {
    return join3(this.txDir, tx);
  }
  #profilePath(rel) {
    return join3(this.profile, rel);
  }
  async begin(targets) {
    if (!Array.isArray(targets) || targets.length === 0) throw new JournalError("BAD_TARGETS", "targets must not be empty");
    this.lock?.fence();
    const active = this.scan().txs.filter((t) => !t.committed && !(t.outcome && t.outcome.outcome === "ROLLED_BACK"));
    if (active.length > 0) throw new JournalError("ACTIVE_TX", "an active journal transaction already exists: " + active.map((t) => t.txid).join(","));
    const txid = randomBytes3(6).toString("hex");
    const manifest = { v: 1, txid, state: "PREPARING", createdAt: Date.now(), targets: {} };
    const dir = this.#txDir(txid);
    mkdirSync3(dir, { recursive: true, mode: 448 });
    for (const rel of targets) {
      this.#assertRel(rel);
      const p2 = this.#profilePath(rel);
      const st2 = fileState(p2);
      const baseline = { state: st2 };
      if (st2.exists) {
        baseline.length = readFileSync4(p2).length;
        baseline.mode = modeOf(p2) || "0644";
        atomicFile(join3(dir, "snapshots", targetKey(rel) + ".bin"), readFileSync4(p2), { mode: 384 });
      }
      manifest.targets[rel] = baseline;
    }
    manifest.state = "PREPARED";
    atomicFile(join3(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 384 });
    return txid;
  }
  #loadManifest(tx) {
    const raw = readJsonIfExists(join3(this.#txDir(tx), "manifest.json"));
    if (!raw) throw new JournalError("NO_MANIFEST", "no manifest");
    try {
      return validateManifest(raw);
    } catch (e) {
      throw new JournalError("BAD_MANIFEST", e.message);
    }
  }
  #opsPath(tx, rel) {
    return join3(this.#txDir(tx), "ops", targetKey(rel) + ".jsonl");
  }
  #parseTarget(tx, rel) {
    const p2 = this.#opsPath(tx, rel);
    const lines = existsSync4(p2) ? readFileSync4(p2, "utf8").split("\n") : [];
    try {
      const parsed = parseOpLog(lines, { txid: tx, rel });
      if (parsed.truncatedTail) console.warn(`[journal-core] ignoring truncated op tail for tx=${tx} rel=${rel}`);
      return parsed;
    } catch (e) {
      throw new JournalError(e.code ?? "BAD_OP", e.message);
    }
  }
  #validatedTarget(tx, rel) {
    const parsed = this.#parseTarget(tx, rel);
    const baseline = this.#loadManifest(tx).targets[rel];
    return reduceOps(parsed, baseline);
  }
  #ownedBefore(tx, rel) {
    return this.#validatedTarget(tx, rel).owned;
  }
  #beginOp(tx, rel, { kind, expected, next, mode, length }) {
    const m2 = this.#loadManifest(tx);
    const v2 = this.#validatedTarget(tx, rel);
    if (v2.pending) throw new JournalError("PENDING", "previous op is pending INTENDED");
    const seq = v2.records.length ? v2.records[v2.records.length - 1].seq + 1 : 1;
    const op = { v: 1, txid: tx, targetKey: targetKey(rel), opId: `${tx}-${seq}`, seq, kind, phase: "INTENDED", expected, next, before: expected };
    if (next.exists) {
      op.mode = mode;
      op.length = length;
    }
    appendRecord(this.#opsPath(tx, rel), JSON.stringify(op));
    return op;
  }
  #appendPhase(tx, rel, op, phase) {
    this.lock?.fence();
    appendRecord(this.#opsPath(tx, rel), JSON.stringify({ ...op, phase }));
  }
  async writePresent(tx, rel, data) {
    this.lock?.fence();
    this.#assertRel(rel);
    const m2 = this.#loadManifest(tx);
    const p2 = this.#profilePath(rel);
    const current = fileState(p2);
    const owned = this.#ownedBefore(tx, rel);
    if (current.hash !== owned.hash || current.exists !== owned.exists) throw new JournalError("CONFLICT", "optimistic check failed");
    const next = { exists: true, hash: sha256(data) };
    const mode = owned.exists ? this.#lastMode(tx, rel) || m2.targets[rel].mode || "0644" : "0600";
    const op = this.#beginOp(tx, rel, { kind: "FORWARD", expected: owned, next, mode, length: data.length });
    this.lock?.fence();
    replaceTarget(p2, data, parseInt(mode, 8));
    const after = fileState(p2);
    if (after.hash !== next.hash || after.exists !== next.exists) throw new JournalError("CONFLICT", "post-write check failed");
    this.#appendPhase(tx, rel, op, "CONFIRMED");
  }
  async deleteTarget(tx, rel) {
    this.lock?.fence();
    this.#assertRel(rel);
    const p2 = this.#profilePath(rel);
    const current = fileState(p2);
    const owned = this.#ownedBefore(tx, rel);
    if (!owned.exists) throw new JournalError("BAD_TARGET_STATE", "cannot delete absent target: " + rel);
    if (current.hash !== owned.hash || current.exists !== owned.exists) throw new JournalError("CONFLICT", "optimistic check failed");
    const next = { exists: false, hash: null };
    const op = this.#beginOp(tx, rel, { kind: "FORWARD", expected: owned, next });
    this.lock?.fence();
    unlinkTargetDurable(p2);
    if (fileState(p2).exists) throw new JournalError("CONFLICT", "post-delete check failed");
    this.#appendPhase(tx, rel, op, "CONFIRMED");
  }
  #lastMode(tx, rel) {
    const ops = this.#parseTarget(tx, rel).records;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i].mode) return ops[i].mode;
    }
    return null;
  }
  async commitFiles(tx) {
    this.lock?.fence();
    const m2 = this.#loadManifest(tx);
    for (const rel of Object.keys(m2.targets)) {
      const v2 = this.#validatedTarget(tx, rel);
      if (v2.pending) throw new JournalError("PENDING", "unconfirmed target: " + rel);
      const current = fileState(this.#profilePath(rel));
      const baseline = m2.targets[rel].state;
      if (v2.records.length === 0 && current.exists === baseline.exists && current.hash === baseline.hash) continue;
      if (current.hash !== v2.owned.hash || current.exists !== v2.owned.exists) throw new JournalError("CONFLICT", "final check failed: " + rel);
    }
    this.lock?.fence();
    marker(join3(this.#txDir(tx), "COMMITTED"));
    m2.state = "FILE_COMMITTED";
    atomicFile(join3(this.#txDir(tx), "manifest.json"), JSON.stringify(m2, null, 2), { mode: 384 });
    this.lock?.fence();
    atomicFile(join3(this.#txDir(tx), "OUTCOME.json"), JSON.stringify({ v: 1, txid: tx, outcome: "COMMITTED" }), { mode: 384 });
  }
  async adoptExternal(tx, rel, expectedBytes = null) {
    this.lock?.fence();
    this.#assertRel(rel);
    const baseline = this.#loadManifest(tx).targets[rel].state;
    const current = fileState(this.#profilePath(rel));
    if (expectedBytes != null) {
      const expectedHash = sha256(expectedBytes);
      if (current.hash !== expectedHash) throw new JournalError("CONFLICT", "external change does not match expected bytes: " + rel);
    }
    if (current.exists === baseline.exists && current.hash === baseline.hash) return false;
    const mode = current.exists ? modeOf(this.#profilePath(rel)) || "0644" : void 0;
    const length = current.exists ? readFileSync4(this.#profilePath(rel)).length : void 0;
    const op = this.#beginOp(tx, rel, { kind: "FORWARD", expected: baseline, next: current, mode, length });
    this.#appendPhase(tx, rel, op, "CONFIRMED");
    return true;
  }
  getBaseline(tx) {
    return this.#loadManifest(tx).targets;
  }
  readSnapshot(tx, rel) {
    const b2 = this.getBaseline(tx)[rel];
    if (!b2) return null;
    if (!b2.state.exists) return null;
    return readFileSync4(join3(this.#txDir(tx), "snapshots", targetKey(rel) + ".bin"));
  }
  txExists(tx) {
    return existsSync4(join3(this.#txDir(tx), "manifest.json"));
  }
  hasConflict(tx) {
    return this.#conflictStatus(tx) === "conflicted";
  }
  #conflictStatus(tx) {
    const reportPath = join3(this.root, "conflicts", tx, "report.json");
    if (!existsSync4(reportPath)) return "none";
    let report;
    try {
      report = validateConflictReport(JSON.parse(readFileSync4(reportPath, "utf8")));
    } catch {
      return "bad-report";
    }
    if (report.txid !== tx) return "bad-report";
    const ev = join3(this.root, "conflicts", tx, "evidence");
    if (Array.isArray(report.evidence)) {
      for (const e of report.evidence) {
        if (!e || typeof e.name !== "string" || typeof e.hash !== "string" || !Number.isInteger(e.length)) return "bad-report";
        const f2 = join3(ev, e.name);
        try {
          if (!existsSync4(f2)) return "bad-evidence";
          const bytes = readFileSync4(f2);
          if (sha256(bytes) !== e.hash || bytes.length !== e.length) return "bad-evidence";
        } catch {
          return "bad-evidence";
        }
      }
    }
    for (const c of report.conflicts) {
      if (!c || typeof c.rel !== "string" || !c.state) return "bad-report";
      const f2 = join3(ev, targetKey(c.rel) + ".bin");
      const a = join3(ev, targetKey(c.rel) + ".absent.json");
      if (c.state.exists) {
        if (!existsSync4(f2)) return "bad-evidence";
        try {
          if (sha256(readFileSync4(f2)) !== c.state.hash) return "bad-evidence";
        } catch {
          return "bad-evidence";
        }
      } else if (!existsSync4(a)) return "bad-evidence";
    }
    return "conflicted";
  }
  scan() {
    const out = { txs: [] };
    if (!existsSync4(this.txDir)) return out;
    for (const tx of readdirSync3(this.txDir)) {
      const d = join3(this.txDir, tx);
      if (!statSync4(d).isDirectory()) continue;
      let m2 = null, manifestInvalid = false;
      try {
        const raw = readJsonIfExists(join3(d, "manifest.json"));
        if (raw) m2 = validateManifest(raw);
      } catch {
        manifestInvalid = true;
      }
      const committed = existsSync4(join3(d, "COMMITTED"));
      let outcome = null, outcomeInvalid = false;
      const op = join3(d, "OUTCOME.json");
      if (existsSync4(op)) {
        try {
          outcome = validateOutcome(JSON.parse(readFileSync4(op, "utf8")));
        } catch {
          outcomeInvalid = true;
        }
      }
      out.txs.push({ txid: tx, manifest: m2, manifestInvalid, committed, outcome, outcomeInvalid });
    }
    return out;
  }
  #verifySnapshots(tx) {
    const m2 = this.#loadManifest(tx);
    for (const [rel, b2] of Object.entries(m2.targets)) {
      if (!b2.state.exists) continue;
      const snap = join3(this.#txDir(tx), "snapshots", targetKey(rel) + ".bin");
      if (!existsSync4(snap)) throw new JournalError("SNAPSHOT_MISSING", "snapshot missing: " + rel);
      const bytes = readFileSync4(snap);
      if (sha256(bytes) !== b2.state.hash) throw new JournalError("SNAPSHOT_BAD", "snapshot hash mismatch: " + rel);
      if (bytes.length !== b2.length) throw new JournalError("SNAPSHOT_BAD", "snapshot length mismatch: " + rel);
    }
  }
  async recoverReport() {
    return makeRecoveryReport(await this.#recoverEntries());
  }
  async #safeArchive(tx, conflicts) {
    try {
      await this.archiveConflict(tx, conflicts);
      return null;
    } catch (e) {
      if (e.code === "FP_INJECTED") throw e;
      console.warn(`[journal-core] archiveConflict failed for ${tx}: ${e.code ?? e.message}`);
      return e.code ?? "EVIDENCE_ERROR";
    }
  }
  async recover() {
    return this.#recoverEntries();
  }
  async #recoverEntries() {
    this.lock?.fence();
    sweepLockDebris(this.root);
    sweepTrash(this.root);
    const scan = this.scan();
    const report = [];
    const pre = [];
    for (const t of scan.txs) {
      if (t.manifestInvalid) {
        report.push({ txid: t.txid, result: "BAD_MANIFEST" });
        continue;
      }
      const conflictStatus = this.#conflictStatus(t.txid);
      if (conflictStatus === "conflicted") {
        report.push({ txid: t.txid, result: "CONFLICTED_EXISTING" });
        continue;
      }
      if (conflictStatus !== "none") {
        report.push({ txid: t.txid, result: conflictStatus === "bad-evidence" ? "BAD_EVIDENCE" : "BAD_REPORT" });
        continue;
      }
      if (t.committed) {
        pre.push({ t, committed: true });
        continue;
      }
      try {
        this.#verifySnapshots(t.txid);
      } catch (e) {
        report.push({ txid: t.txid, result: e.code });
        continue;
      }
      const m2 = this.#loadManifest(t.txid);
      const classified = {};
      const conflicts = [];
      let bad = false;
      for (const rel of Object.keys(m2.targets)) {
        try {
          const r = this.#classify(t.txid, rel, m2.targets[rel]);
          classified[rel] = r;
          if (r.conflict) conflicts.push({ rel, state: r.current });
        } catch (e) {
          report.push({ txid: t.txid, result: e.code });
          bad = true;
          break;
        }
      }
      if (bad) continue;
      pre.push({ t, committed: false, m: m2, classified, conflicts });
    }
    outer: for (const p2 of pre) {
      if (p2.committed) {
        const m2 = this.#loadManifest(p2.t.txid);
        const bad = [];
        for (const rel of Object.keys(m2.targets)) {
          let v2;
          try {
            v2 = this.#validatedTarget(p2.t.txid, rel);
          } catch (e) {
            report.push({ txid: p2.t.txid, result: e.code });
            continue outer;
          }
          const cur = fileState(this.#profilePath(rel));
          if (v2.pending || cur.hash !== v2.owned.hash || cur.exists !== v2.owned.exists) bad.push(rel);
        }
        if (bad.length) {
          await this.#safeArchive(p2.t.txid, bad.map((rel) => ({ rel, state: fileState(this.#profilePath(rel)) })));
          report.push({ txid: p2.t.txid, result: "CONFLICTED" });
          continue;
        }
        if (p2.t.outcomeInvalid) {
          report.push({ txid: p2.t.txid, result: "BAD_OUTCOME" });
          continue;
        }
        if (p2.t.outcome && p2.t.outcome.outcome !== "COMMITTED") {
          report.push({ txid: p2.t.txid, result: "BAD_OUTCOME" });
          continue;
        }
        if (!p2.t.outcome) atomicFile(join3(this.#txDir(p2.t.txid), "OUTCOME.json"), JSON.stringify({ v: 1, txid: p2.t.txid, outcome: "COMMITTED" }), { mode: 384 });
        tombstone("journal", this.#txDir(p2.t.txid));
        report.push({ txid: p2.t.txid, result: "COMMITTED_OK" });
        continue;
      }
      if (p2.conflicts.length) {
        await this.#safeArchive(p2.t.txid, p2.conflicts);
        report.push({ txid: p2.t.txid, result: "CONFLICTED", conflicts: p2.conflicts });
        continue;
      }
      for (const [rel, r] of Object.entries(p2.classified)) {
        if (r.pendingAction === "CANCELLED") {
          const cur = fileState(this.#profilePath(rel));
          if (cur.hash !== r.pending.expected.hash || cur.exists !== r.pending.expected.exists) {
            await this.#safeArchive(p2.t.txid, [{ rel, state: cur }]);
            report.push({ txid: p2.t.txid, result: "CONFLICTED" });
            continue outer;
          }
          this.#appendPhase(p2.t.txid, rel, r.pending, "CANCELLED");
        }
        if (r.pendingAction === "CONFIRMED") {
          const cur = fileState(this.#profilePath(rel));
          if (cur.hash !== r.pending.next.hash || cur.exists !== r.pending.next.exists) {
            await this.#safeArchive(p2.t.txid, [{ rel, state: cur }]);
            report.push({ txid: p2.t.txid, result: "CONFLICTED" });
            continue outer;
          }
          this.#appendPhase(p2.t.txid, rel, r.pending, "CONFIRMED");
        }
      }
      const rollback = [];
      for (const [rel] of Object.entries(p2.classified)) {
        const owned = this.#ownedBefore(p2.t.txid, rel);
        const b2 = p2.m.targets[rel].state;
        if (owned.hash !== b2.hash || owned.exists !== b2.exists) rollback.push(rel);
      }
      for (const rel of rollback) {
        try {
          await this.#rollbackTarget(p2.t.txid, rel, p2.m);
        } catch (e) {
          if (e.code === "FP_INJECTED") throw e;
          await this.#safeArchive(p2.t.txid, [{ rel, state: fileState(this.#profilePath(rel)) }]);
          report.push({ txid: p2.t.txid, result: "CONFLICTED" });
          continue outer;
        }
      }
      for (const rel of Object.keys(p2.m.targets)) {
        const cur = fileState(this.#profilePath(rel));
        const b2 = p2.m.targets[rel].state;
        if (cur.exists !== b2.exists || cur.hash !== b2.hash) {
          await this.#safeArchive(p2.t.txid, [{ rel, state: cur }]);
          report.push({ txid: p2.t.txid, result: "CONFLICTED" });
          continue outer;
        }
      }
      atomicFile(join3(this.#txDir(p2.t.txid), "OUTCOME.json"), JSON.stringify({ v: 1, txid: p2.t.txid, outcome: "ROLLED_BACK" }), { mode: 384 });
      report.push({ txid: p2.t.txid, result: "ROLLED_BACK" });
    }
    return report;
  }
  #classify(tx, rel, baseline) {
    const current = fileState(this.#profilePath(rel));
    const parsed = this.#parseTarget(tx, rel);
    const plan = classifyTarget(parsed, baseline, current);
    return { ...plan, current };
  }
  async #rollbackTarget(tx, rel, m2) {
    const baseline = m2.targets[rel];
    const p2 = this.#profilePath(rel);
    const owned = this.#ownedBefore(tx, rel);
    const cur = fileState(p2);
    if (cur.hash !== owned.hash || cur.exists !== owned.exists) throw new JournalError("CONFLICT", "rollback optimistic check failed: " + rel);
    if (baseline.state.exists) {
      const bytes = readFileSync4(join3(this.#txDir(tx), "snapshots", targetKey(rel) + ".bin"));
      const op = this.#beginOp(tx, rel, { kind: "ROLLBACK", expected: owned, next: baseline.state, mode: baseline.mode, length: bytes.length });
      this.lock?.fence();
      replaceTarget(p2, bytes, parseInt(baseline.mode || "0644", 8));
      const after = fileState(p2);
      if (after.hash !== baseline.state.hash || after.exists !== baseline.state.exists) throw new JournalError("CONFLICT", "rollback post-check failed: " + rel);
      this.#appendPhase(tx, rel, op, "CONFIRMED");
    } else {
      const op = this.#beginOp(tx, rel, { kind: "ROLLBACK", expected: owned, next: baseline.state });
      this.lock?.fence();
      unlinkTargetDurable(p2);
      const after = fileState(p2);
      if (after.exists !== false) throw new JournalError("CONFLICT", "rollback delete post-check failed: " + rel);
      this.#appendPhase(tx, rel, op, "CONFIRMED");
    }
  }
  async archiveConflict(tx, conflicts) {
    this.lock?.fence();
    const d = join3(this.root, "conflicts", tx);
    if (existsSync4(join3(d, "report.json"))) throw new JournalError("JOURNALLED", "conflict report already exists for tx: " + tx);
    mkdirSync3(join3(d, "evidence"), { recursive: true, mode: 448 });
    const txd = this.#txDir(tx);
    const entries = [];
    const addEntry = (relPath, bytes) => {
      const target = join3(d, "evidence", relPath);
      mkdirSync3(dirname2(target), { recursive: true, mode: 448 });
      atomicFile(target, bytes, { mode: 384 });
      entries.push({ name: relPath, hash: sha256(bytes), length: bytes.length });
    };
    if (existsSync4(join3(txd, "manifest.json"))) addEntry("manifest.json", readFileSync4(join3(txd, "manifest.json")));
    const opsDir = join3(txd, "ops");
    if (existsSync4(opsDir)) {
      for (const f2 of readdirSync3(opsDir)) addEntry("ops/" + f2, readFileSync4(join3(opsDir, f2)));
    }
    const snapDir = join3(txd, "snapshots");
    if (existsSync4(snapDir)) {
      for (const f2 of readdirSync3(snapDir)) addEntry("snapshots/" + f2, readFileSync4(join3(snapDir, f2)));
    }
    for (const c of conflicts) {
      const rel = c.rel;
      const p2 = this.#profilePath(rel);
      const st2 = fileState(p2);
      if (st2.exists) {
        const bytes = readFileSync4(p2);
        addEntry(targetKey(rel) + ".bin", bytes);
        if (sha256(bytes) !== st2.hash) throw new JournalError("EVIDENCE_BAD", "evidence copy hash mismatch");
      } else addEntry(targetKey(rel) + ".absent.json", Buffer.from(JSON.stringify({ exists: false })));
    }
    atomicFile(join3(d, "evidence-manifest.json"), JSON.stringify({ v: 1, txid: tx, entries }, null, 2), { mode: 384 });
    atomicFile(join3(d, "report.json"), JSON.stringify({ v: 1, txid: tx, detectedAt: Date.now(), conflicts, evidence: entries }, null, 2), { mode: 384 });
    const m2 = this.#loadManifest(tx);
    m2.state = "CONFLICTED";
    atomicFile(join3(txd, "manifest.json"), JSON.stringify(m2, null, 2), { mode: 384 });
  }
};

// packages/install-core/src/errors.mjs
var InstallError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};

// packages/install-core/src/install-service.mjs
var TRACKED_FILES = ["package.json", "pnpm-lock.yaml", "cordis.patch.yml", ".cordis-mp/state.json"];
var InstallService = class {
  constructor({ catalog, journal, packageManager, activation = null, inspect = null, pendingPath = null, lock = null, selfPackageName = null, selfEntryIds = [] }) {
    this.catalog = catalog;
    this.journal = journal;
    this.packageManager = packageManager;
    this.activation = activation;
    this.inspect = inspect;
    this.pendingPath = pendingPath;
    this.lock = lock;
    if (selfPackageName !== null && (typeof selfPackageName !== "string" || selfPackageName.trim().length === 0)) {
      throw new TypeError("InstallService selfPackageName must be a non-empty package name or null");
    }
    if (!Array.isArray(selfEntryIds) || selfEntryIds.some((id) => typeof id !== "string" || id.trim().length === 0)) {
      throw new TypeError("InstallService selfEntryIds must be an array of non-empty entry ids");
    }
    this.selfPackageName = selfPackageName?.trim() || null;
    this.selfEntryIds = [...new Set(selfEntryIds.map((id) => id.trim()))];
    if (!this.lock) throw new TypeError("InstallService requires a profile FileLock");
    if (this.journal?.lock !== this.lock) throw new TypeError("InstallService and Journal must share the profile FileLock");
    this.pending = /* @__PURE__ */ new Map();
  }
  async #withProfileLock(operation) {
    try {
      return await withFileLock(this.lock, "mutation", operation);
    } catch (e) {
      if (e?.code === "LOCK_BUSY") throw new InstallError("MUTATION_BUSY", "another profile mutation or recovery is in progress");
      if (e?.code === "LOCK_FENCED") throw new InstallError("MUTATION_FENCED", "profile mutation lease was lost; no further writes were attempted");
      throw e;
    }
  }
  async install({ slug, platform = "web", confirmation = {}, signal } = {}) {
    const fresh = await this.catalog.fetchFresh(slug);
    if (confirmation.entryRevision && fresh.entryRevision !== confirmation.entryRevision) {
      throw new InstallError("STALE_CONFIRMATION", "catalog entry changed; please review again");
    }
    const decision = this.catalog.installability(fresh, platform);
    if (!decision.installable) throw new InstallError("NOT_INSTALLABLE", decision.reason);
    if (this.selfPackageName && fresh.source?.packageName === this.selfPackageName) {
      throw new InstallError("SELF_INSTALL_FORBIDDEN", "the marketplace host cannot install its own package");
    }
    const artifact = {
      packageName: fresh.source.packageName,
      version: fresh.source.version,
      integrity: fresh.source.integrity,
      tarball: fresh.source.tarball,
      registry: fresh.source.registry
    };
    let stagedPath = null;
    try {
      if (this.inspect) {
        const inspected = await this.inspect.inspectArtifact(artifact);
        const inspectedIds = inspected?.entryIds;
        artifact.entryIds = Array.isArray(inspectedIds) && inspectedIds.length > 0 ? inspectedIds : Array.isArray(fresh.entryIds) ? fresh.entryIds : [];
        stagedPath = inspected?.stagedPath || null;
      } else {
        artifact.entryIds = fresh.entryIds || [];
      }
      if (artifact.entryIds.some((id) => this.selfEntryIds.includes(id))) {
        throw new InstallError("HOST_ENTRY_CONFLICT", "a plugin bundle cannot replace the marketplace host entry");
      }
      return await this.#withProfileLock(async () => {
        const tx = await this.journal.begin(TRACKED_FILES);
        let disable = null;
        let disableApplied = false;
        try {
          if (this.activation) {
            disable = await this.activation.prepareDisable({ slug, artifact });
            disable.ownedDisables = [];
            if (disable?.entryIds?.length) {
              await this.activation.preDisable(disable.entryIds);
              disableApplied = true;
              disable.ownedDisables = this.activation.ownedDisables || [];
            }
          }
          const result = await this.packageManager.installVerifiedArtifact(artifact, signal);
          if (result.exitCode !== 0) throw new InstallError("INSTALL_FAILED", result.stderr || `exit ${result.exitCode}`);
          for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
            await this.journal.adoptExternal(tx, rel, bytes);
          }
          const verified = await this.packageManager.verifyInstalled(artifact);
          if (!verified) throw new InstallError("VERIFY_FAILED", "installed package does not match verified artifact");
          await this.journal.commitFiles(tx);
        } catch (e) {
          if (e.code === "FP_INJECTED") throw e;
          if (disableApplied && disable?.entryIds?.length) {
            try {
              await this.activation.cancelDisable(disable.entryIds);
            } catch {
            }
          }
          try {
            await this.journal.recover();
          } catch {
          }
          throw e;
        }
        const pending = { v: 1, slug, artifact, entryIds: disable?.entryIds || [], ownedDisables: disable?.ownedDisables || [], entryRevision: fresh.entryRevision, tx, createdAt: Date.now() };
        this.pending.set(slug, pending);
        await this.#persistPending();
        return { status: "COMMITTED", pendingActivation: true, pending };
      });
    } finally {
      if (stagedPath) {
        try {
          this.inspect.cleanup?.(stagedPath);
        } catch {
        }
      }
    }
  }
  async activate({ slug, signal } = {}) {
    return this.#withProfileLock(async () => {
      const pending = this.pending.get(slug);
      if (!pending) throw new InstallError("NO_PENDING_ACTIVATION", "no pending activation for slug: " + slug);
      if (!this.activation) throw new InstallError("NO_ACTIVATION_PORT", "activation port is not configured");
      let activationStatus = null;
      if (pending.entryIds.length) activationStatus = await this.activation.activate(pending.entryIds, { ownedSet: pending.ownedDisables });
      this.pending.delete(slug);
      await this.#persistPending();
      return { status: "ACTIVE", activationStatus };
    });
  }
  #pendingFile() {
    if (!this.pendingPath) return null;
    return join4(this.pendingPath, "pending-activation.json");
  }
  async #persistPending() {
    const p2 = this.#pendingFile();
    if (!p2) return;
    const snapshot = { v: 1, items: [...this.pending.values()] };
    const tx = await this.journal.begin([".cordis-mp/pending-activation.json"]);
    try {
      await this.journal.writePresent(tx, ".cordis-mp/pending-activation.json", Buffer.from(JSON.stringify(snapshot)));
      await this.journal.commitFiles(tx);
    } catch (e) {
      try {
        await this.journal.recover();
      } catch {
      }
      ;
      throw e;
    }
  }
  async recoverPending() {
    const p2 = this.#pendingFile();
    if (!p2 || !existsSync5(p2)) return 0;
    try {
      const data = JSON.parse(readFileSync5(p2, "utf8"));
      const list = data?.v === 1 ? Array.isArray(data.items) ? data.items : data.slug ? [data] : [] : [];
      for (const item of list) if (item?.slug) this.pending.set(item.slug, item);
      return list.length;
    } catch {
      return 0;
    }
  }
  async uninstall({ packageName, signal } = {}) {
    return this.#withProfileLock(async () => {
      const tx = await this.journal.begin(TRACKED_FILES);
      try {
        const result = await this.packageManager.remove(packageName, signal);
        if (result.exitCode !== 0) throw new InstallError("REMOVE_FAILED", result.stderr || `exit ${result.exitCode}`);
        for (const [rel, bytes] of Object.entries(result.profileFiles || {})) {
          await this.journal.adoptExternal(tx, rel, bytes);
        }
        await this.journal.commitFiles(tx);
      } catch (e) {
        if (e.code === "FP_INJECTED") throw e;
        try {
          await this.journal.recover();
        } catch {
        }
        throw e;
      }
      return { status: "COMMITTED", tx };
    });
  }
};

// packages/web-harness/src/mutation-routes.mjs
function json2(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(Object.assign(new Error("invalid JSON body"), { code: "BAD_JSON" }));
      }
    });
    req.on("error", reject);
  });
}
function createMutationHandler({ installService, platform = "web", guard = null }) {
  return async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/cordis-mp/status" && req.method === "GET") return json2(res, 200, { ok: true, busy: false });
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    if (guard) {
      const check = guard.guard(req);
      if (!check.ok) return json2(res, check.status, { error: { code: check.reason, message: "untrusted mutation request" } });
    }
    try {
      if (url.pathname === "/cordis-mp/install") {
        const body = await readJsonBody(req);
        const out = await installService.install({ slug: body.slug, platform, confirmation: { entryRevision: body.entryRevision } });
        return json2(res, 200, { ok: true, ...out });
      }
      if (url.pathname === "/cordis-mp/uninstall") {
        const body = await readJsonBody(req);
        const out = await installService.uninstall({ packageName: body.name });
        return json2(res, 200, { ok: true, ...out });
      }
      if (url.pathname === "/cordis-mp/activate") {
        const body = await readJsonBody(req);
        const out = await installService.activate({ slug: body.slug });
        return json2(res, 200, { ok: true, ...out });
      }
      json2(res, 404, { error: { code: "NOT_FOUND", message: "no such route" } });
    } catch (e) {
      if (e instanceof InstallError) {
        const status = ["MUTATION_BUSY", "MUTATION_FENCED", "SELF_INSTALL_FORBIDDEN", "HOST_ENTRY_CONFLICT"].includes(e.code) ? 409 : 400;
        return json2(res, status, { error: { code: e.code, message: e.message } });
      }
      if (e.code === "BAD_JSON" || e.code === "BODY_TOO_LARGE") return json2(res, 400, { error: { code: e.code, message: e.message } });
      json2(res, 500, { error: { code: "INTERNAL", message: e?.message || String(e) } });
    }
  };
}
function mountMutationRoutes(webServer, opts) {
  const handler = createMutationHandler(opts);
  const disposers = [
    webServer.register({ kind: "exact", path: "/cordis-mp/install", handler }),
    webServer.register({ kind: "exact", path: "/cordis-mp/uninstall", handler }),
    webServer.register({ kind: "exact", path: "/cordis-mp/activate", handler }),
    webServer.register({ kind: "exact", path: "/cordis-mp/status", handler })
  ];
  return () => {
    for (const d of disposers) d();
  };
}

// packages/web-harness/src/security.mjs
import { randomBytes as randomBytes4 } from "node:crypto";
function normHost(hostHeader) {
  try {
    const u2 = new URL("http://" + (hostHeader || ""));
    return { host: u2.hostname.toLowerCase(), port: u2.port || "80" };
  } catch {
    return { host: (hostHeader || "").toLowerCase(), port: "" };
  }
}
function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return { ok: false, reason: "origin-missing-or-null" };
  let o;
  try {
    o = new URL(origin);
  } catch {
    return { ok: false, reason: "origin-invalid" };
  }
  const expected = normHost(req.headers.host);
  const actual = normHost(o.host);
  if (actual.host !== expected.host || actual.port !== expected.port) return { ok: false, reason: "origin-host-mismatch" };
  return { ok: true };
}
var MutationGuard = class {
  constructor({ allowedHosts = ["127.0.0.1", "localhost", "[::1]"], loopbackOnly = true } = {}) {
    this.allowedHosts = new Set(allowedHosts);
    this.loopbackOnly = loopbackOnly;
    this.ttlMs = 15 * 60 * 1e3;
    this.#rotateToken();
  }
  #rotateToken() {
    this.token = randomBytes4(32).toString("hex");
    this.tokenIssuedAt = Date.now();
  }
  #tokenExpired() {
    return Date.now() - this.tokenIssuedAt > this.ttlMs;
  }
  #baseCheck(req) {
    const reasons = [];
    if (this.loopbackOnly && !isLoopback(req.socket?.remoteAddress)) reasons.push("peer-not-loopback");
    const h = normHost(req.headers.host);
    if (!this.allowedHosts.has(h.host)) reasons.push("host-not-allowed");
    const so2 = sameOrigin(req);
    if (!so2.ok) reasons.push(so2.reason);
    const sf = req.headers["sec-fetch-site"];
    if (sf && !["same-origin", "none"].includes(sf)) reasons.push("sec-fetch-site=" + sf);
    return { ok: reasons.length === 0, reasons };
  }
  session(req) {
    const base = this.#baseCheck(req);
    if (!base.ok) return base;
    if (this.#tokenExpired()) this.#rotateToken();
    return { ...base, ok: true };
  }
  guard(req) {
    const base = this.#baseCheck(req);
    if (!base.ok) return { ok: false, reason: base.reasons[0], reasons: base.reasons, status: 403 };
    if (this.#tokenExpired()) return { ok: false, reason: "token-expired", reasons: [...base.reasons, "token-expired"], status: 403 };
    const token = req.headers["x-cordis-mp-token"];
    if (token !== this.token) return { ok: false, reason: "bad-token", reasons: [...base.reasons, "bad-token"], status: 403 };
    return { ok: true, reasons: base.reasons, status: 0 };
  }
};

// packages/web-harness/src/session-routes.mjs
function json3(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
function createSessionHandler(guard = new MutationGuard()) {
  return (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    const check = guard.session(req);
    if (!check.ok) return json3(res, 403, { error: { code: check.reason, message: "untrusted session request" } });
    json3(res, 200, { token: guard.token, ttl: Math.floor(guard.ttlMs / 1e3), expiresAt: new Date(guard.tokenIssuedAt + guard.ttlMs).toISOString() });
  };
}
function mountSessionRoute(webServer, guard = new MutationGuard()) {
  return webServer.register({ kind: "exact", path: "/cordis-mp/session", handler: createSessionHandler(guard) });
}

// packages/dsh-runner/src/runner.mjs
import { spawn } from "node:child_process";
var DshRunner = class {
  constructor({ dshBin = "dsh", dshHome = process.env.DSH_HOME, profile = "web", timeoutMs = 15 * 60 * 1e3 } = {}) {
    this.dshBin = dshBin;
    this.dshHome = dshHome;
    this.profile = profile;
    this.timeoutMs = timeoutMs;
    this.active = null;
  }
  pluginArgs(profile) {
    return ["plugin", "--profile", profile ?? this.profile];
  }
  #env() {
    const env = { ...process.env, CI: "true" };
    if (this.dshHome) env.DSH_HOME = this.dshHome;
    return env;
  }
  run(args, { signal } = {}) {
    if (this.active) return Promise.resolve({ exitCode: 409, timedOut: false, stdout: "", stderr: "another dsh operation is already running", cancelled: false, busy: true });
    const child = spawn(this.dshBin, args, { env: this.#env(), stdio: ["ignore", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" });
    this.active = child;
    let stdout = "", stderr = "", timedOut = false, cancelled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.cancel();
    }, this.timeoutMs);
    child.stdout?.on("data", (d) => stdout = (stdout + d.toString()).slice(-256 * 1024));
    child.stderr?.on("data", (d) => stderr = (stderr + d.toString()).slice(-64 * 1024));
    const onAbort = () => {
      cancelled = true;
      this.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    return new Promise((resolve) => {
      child.on("error", (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.active = null;
        resolve({ exitCode: 127, timedOut, stdout, stderr: `${stderr}
${err.message}`, cancelled });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.active = null;
        resolve({ exitCode: code, timedOut, stdout, stderr, cancelled });
      });
    });
  }
  cancel() {
    const child = this.active;
    if (!child) return false;
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      } catch {
        child.kill();
      }
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
    return true;
  }
  async probe() {
    const r = await this.run(["--version"], { signal: AbortSignal.timeout(1e4) });
    return r.exitCode === 0 && !r.timedOut;
  }
};

// packages/dsh-runner/src/package-manager.mjs
import { existsSync as existsSync6, lstatSync, readFileSync as readFileSync6 } from "node:fs";
import { join as join5 } from "node:path";
var TRACKED = ["package.json", "pnpm-lock.yaml", "cordis.patch.yml", ".cordis-mp/state.json"];
var MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
function unquoteYamlScalar(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  return text;
}
function isArtifactPackageKey(key, artifact) {
  const id = `${artifact.packageName}@${artifact.version}`;
  return key === id || key === `/${id}` || key.startsWith(`${id}(`) || key.startsWith(`/${id}(`);
}
function inlineIntegrity(resolution) {
  const match = /(?:^|,)\s*integrity:\s*([^,}]+)/.exec(resolution);
  return match ? unquoteYamlScalar(match[1]) : null;
}
function pnpmLockRecords(lockfile, artifact) {
  let inPackages = false;
  let current = null;
  const records = [];
  const finish = () => {
    if (current) records.push(current);
    current = null;
  };
  for (const line of lockfile.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages:\s*(?:#.*)?$/.test(line)) inPackages = true;
      continue;
    }
    if (/^[^\s#]/.test(line)) break;
    const entry = /^ {2}([^\s].*?):\s*(?:#.*)?$/.exec(line);
    if (entry) {
      finish();
      const key = unquoteYamlScalar(entry[1]);
      if (isArtifactPackageKey(key, artifact)) current = { integrity: null, resolutionIndent: null };
      continue;
    }
    if (!current) continue;
    const flowResolution = /^ {4}resolution:\s*\{(.*)\}\s*(?:#.*)?$/.exec(line);
    if (flowResolution) {
      current.integrity = inlineIntegrity(flowResolution[1]);
      current.resolutionIndent = null;
      continue;
    }
    if (/^ {4}resolution:\s*(?:#.*)?$/.test(line)) {
      current.resolutionIndent = 4;
      continue;
    }
    if (current.resolutionIndent === 4) {
      const nestedIntegrity = /^ {6}integrity:\s*(.*?)\s*(?:#.*)?$/.exec(line);
      if (nestedIntegrity) current.integrity = unquoteYamlScalar(nestedIntegrity[1]);
    }
  }
  finish();
  return records;
}
function lockfileIntegrityMatches(lockPath, artifact) {
  if (typeof artifact?.integrity !== "string" || artifact.integrity.length === 0) return false;
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isFile() || stat.size > MAX_LOCKFILE_BYTES) return false;
    const records = pnpmLockRecords(readFileSync6(lockPath, "utf8"), artifact);
    return records.length > 0 && records.every((record) => record.integrity === artifact.integrity);
  } catch {
    return false;
  }
}
var DshPackageManagerPort = class {
  constructor({ runner, profileDir, platform = "web" }) {
    this.runner = runner;
    this.profileDir = profileDir;
    this.platform = platform;
  }
  #spec(artifact) {
    return `${artifact.packageName}@${artifact.version}`;
  }
  #profileFiles() {
    const files = {};
    for (const rel of TRACKED) {
      const p2 = join5(this.profileDir, rel);
      if (existsSync6(p2)) files[rel] = readFileSync6(p2);
    }
    return files;
  }
  async installVerifiedArtifact(artifact, signal) {
    const result = await this.runner.run([...this.runner.pluginArgs(), "add", this.#spec(artifact), "--ignore-scripts"], { signal });
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} };
  }
  async remove(packageName, signal) {
    const result = await this.runner.run([...this.runner.pluginArgs(), "remove", packageName], { signal });
    return { ...result, profileFiles: result.exitCode === 0 ? this.#profileFiles() : {} };
  }
  async verifyInstalled(artifact) {
    const p2 = join5(this.profileDir, "node_modules", artifact.packageName, "package.json");
    try {
      const manifest = JSON.parse(readFileSync6(p2, "utf8"));
      if (manifest.name !== artifact.packageName || manifest.version !== artifact.version) return false;
      return lockfileIntegrityMatches(join5(this.profileDir, "pnpm-lock.yaml"), artifact);
    } catch {
      return false;
    }
  }
};

// packages/dsh-runner/src/activation.mjs
import { readFileSync as readFileSync7, writeFileSync as writeFileSync2, mkdirSync as mkdirSync4, renameSync as renameSync3, openSync as openSync2, fsyncSync as fsyncSync2, closeSync as closeSync2 } from "node:fs";
import { dirname as dirname3, join as join6 } from "node:path";
import { randomBytes as randomBytes5 } from "node:crypto";
var ROW_ID_RE = /^[A-Za-z0-9_.-]+$/;
var DshActivationPort = class {
  constructor({ patchPath }) {
    this.patchPath = patchPath;
    this.owned = /* @__PURE__ */ new Set();
  }
  get ownedDisables() {
    return [...this.owned];
  }
  #text() {
    try {
      return readFileSync7(this.patchPath, "utf8");
    } catch {
      return "[]\n";
    }
  }
  #save(text) {
    const dir = dirname3(this.patchPath);
    mkdirSync4(dir, { recursive: true, mode: 448 });
    const tmp = join6(dir, `.cordis.patch.${randomBytes5(6).toString("hex")}`);
    const fd = openSync2(tmp, "wx", 384);
    try {
      writeFileSync2(fd, text);
    } finally {
      closeSync2(fd);
    }
    const r = openSync2(tmp, "r");
    try {
      fsyncSync2(r);
    } finally {
      closeSync2(r);
    }
    renameSync3(tmp, this.patchPath);
    const d = openSync2(dir, "r");
    try {
      fsyncSync2(d);
    } finally {
      closeSync2(d);
    }
  }
  readState() {
    const lines = this.#text().split(/\r?\n/);
    const disables = [];
    const forced = [];
    const inserts = [];
    let inInsert = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^- insert:\s*$/.test(line)) {
        inInsert = true;
        continue;
      }
      if (/^- /.test(line)) inInsert = false;
      if (inInsert) {
        const m2 = /^ {4}- id: ([A-Za-z0-9_.-]+)/.exec(line);
        if (m2) inserts.push(m2[1]);
        continue;
      }
      const row = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(line);
      if (!row) continue;
      const next = lines[i + 1] ?? "";
      if (/^ {2}disabled: true\s*$/.test(next)) disables.push(row[1]);
      else if (/^ {2}disabled: false\s*$/.test(next)) forced.push(row[1]);
    }
    return { disables, forced, inserts };
  }
  preDisable(entryIds) {
    const ids = [...new Set(entryIds)].filter((id) => ROW_ID_RE.test(id));
    if (ids.length === 0) return 0;
    let text = this.#text().replace(/\n?$/, "\n");
    const lines = text.split("\n");
    const emptyIdx = lines.findIndex((l) => /^\s*\[\]\s*$/.test(l));
    if (emptyIdx !== -1) lines.splice(emptyIdx, 1);
    let changed = 0;
    for (const id of ids) {
      let found = false;
      for (let i = 0; i < lines.length - 1; i++) {
        const m2 = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(lines[i]);
        if (!m2 || m2[1] !== id) continue;
        found = true;
        if (/^ {2}disabled: true\s*$/.test(lines[i + 1] ?? "")) break;
        if (/^ {2}disabled: false\s*$/.test(lines[i + 1] ?? "")) {
          lines[i + 1] = "  disabled: true";
          changed++;
          this.owned.add(id);
        }
        break;
      }
      if (!found) {
        lines.push(`- id: ${id}`, "  disabled: true");
        changed++;
        this.owned.add(id);
      }
    }
    if (changed > 0) this.#save(lines.join("\n"));
    return changed;
  }
  activate(entryIds, { ownedOnly = false, ownedSet = null } = {}) {
    let ids = new Set(entryIds.filter((id) => ROW_ID_RE.test(id)));
    if (ownedOnly) ids = new Set([...ids].filter((id) => this.owned.has(id)));
    if (Array.isArray(ownedSet)) ids = new Set([...ids].filter((id) => ownedSet.includes(id)));
    if (ids.size === 0) return 0;
    const lines = this.#text().split("\n");
    const out = [];
    let removed = 0;
    for (let i = 0; i < lines.length; i++) {
      const m2 = /^- id: ([A-Za-z0-9_.-]+)\s*$/.exec(lines[i]);
      if (m2 && ids.has(m2[1]) && /^ {2}disabled: true\s*$/.test(lines[i + 1] ?? "")) {
        i++;
        removed++;
        this.owned.delete(m2[1]);
        continue;
      }
      out.push(lines[i]);
    }
    if (removed > 0) {
      const hasRows = out.some((l) => /^\s*- /.test(l));
      if (!hasRows) {
        let idx = 0;
        while (idx < out.length && (out[idx].trim() === "" || out[idx].trim().startsWith("#"))) idx++;
        out.splice(idx, 0, "[]");
      }
      this.#save(out.join("\n"));
    }
    return removed;
  }
  async prepareDisable({ artifact }) {
    return { entryIds: artifact?.entryIds || [] };
  }
  async cancelDisable(entryIds) {
    return this.activate(entryIds, { ownedOnly: true });
  }
};

// node_modules/.pnpm/tar@7.5.22/node_modules/tar/dist/esm/index.min.js
import Qr from "events";
import I from "fs";
import { EventEmitter as Di } from "node:events";
import Cs from "node:stream";
import { StringDecoder as Hr } from "node:string_decoder";
import cr from "node:path";
import Kt from "node:fs";
import { dirname as Fn, parse as kn } from "path";
import { EventEmitter as Dn } from "events";
import zi from "assert";
import { Buffer as Ot } from "buffer";
import * as Ps from "zlib";
import en from "zlib";
import { posix as Zt } from "node:path";
import { basename as _n } from "node:path";
import mi from "fs";
import X from "fs";
import js from "path";
import { win32 as Pn } from "node:path";
import ar from "path";
import Br from "node:fs";
import co from "node:assert";
import { randomBytes as Mr } from "node:crypto";
import u from "node:fs";
import R from "node:path";
import pr from "fs";
import wi from "node:fs";
import we from "node:path";
import k from "node:fs";
import ro from "node:fs/promises";
import Si from "node:path";
import { join as xr } from "node:path";
import v from "node:fs";
import Pr from "node:path";
var zr = Object.defineProperty;
var Ur = (s3, t) => {
  for (var e in t) zr(s3, e, { get: t[e], enumerable: true });
};
var Ds = typeof process == "object" && process ? process : { stdout: null, stderr: null };
var Wr = (s3) => !!s3 && typeof s3 == "object" && (s3 instanceof A || s3 instanceof Cs || Gr(s3) || Zr(s3));
var Gr = (s3) => !!s3 && typeof s3 == "object" && s3 instanceof Di && typeof s3.pipe == "function" && s3.pipe !== Cs.Writable.prototype.pipe;
var Zr = (s3) => !!s3 && typeof s3 == "object" && s3 instanceof Di && typeof s3.write == "function" && typeof s3.end == "function";
var Q = /* @__PURE__ */ Symbol("EOF");
var J = /* @__PURE__ */ Symbol("maybeEmitEnd");
var nt = /* @__PURE__ */ Symbol("emittedEnd");
var De = /* @__PURE__ */ Symbol("emittingEnd");
var qt = /* @__PURE__ */ Symbol("emittedError");
var Ne = /* @__PURE__ */ Symbol("closed");
var Ns = /* @__PURE__ */ Symbol("read");
var Ae = /* @__PURE__ */ Symbol("flush");
var As = /* @__PURE__ */ Symbol("flushChunk");
var z = /* @__PURE__ */ Symbol("encoding");
var Mt = /* @__PURE__ */ Symbol("decoder");
var g = /* @__PURE__ */ Symbol("flowing");
var Qt = /* @__PURE__ */ Symbol("paused");
var Bt = /* @__PURE__ */ Symbol("resume");
var b = /* @__PURE__ */ Symbol("buffer");
var N = /* @__PURE__ */ Symbol("pipes");
var _ = /* @__PURE__ */ Symbol("bufferLength");
var bi = /* @__PURE__ */ Symbol("bufferPush");
var Ie = /* @__PURE__ */ Symbol("bufferShift");
var L = /* @__PURE__ */ Symbol("objectMode");
var S = /* @__PURE__ */ Symbol("destroyed");
var _i = /* @__PURE__ */ Symbol("error");
var Oi = /* @__PURE__ */ Symbol("emitData");
var Is = /* @__PURE__ */ Symbol("emitEnd");
var Ti = /* @__PURE__ */ Symbol("emitEnd2");
var Z = /* @__PURE__ */ Symbol("async");
var xi = /* @__PURE__ */ Symbol("abort");
var Ce = /* @__PURE__ */ Symbol("aborted");
var Jt = /* @__PURE__ */ Symbol("signal");
var Rt = /* @__PURE__ */ Symbol("dataListeners");
var C = /* @__PURE__ */ Symbol("discarded");
var jt = (s3) => Promise.resolve().then(s3);
var Yr = (s3) => s3();
var Kr = (s3) => s3 === "end" || s3 === "finish" || s3 === "prefinish";
var Vr = (s3) => s3 instanceof ArrayBuffer || !!s3 && typeof s3 == "object" && s3.constructor && s3.constructor.name === "ArrayBuffer" && s3.byteLength >= 0;
var $r = (s3) => !Buffer.isBuffer(s3) && ArrayBuffer.isView(s3);
var Fe = class {
  src;
  dest;
  opts;
  ondrain;
  constructor(t, e, i) {
    this.src = t, this.dest = e, this.opts = i, this.ondrain = () => t[Bt](), this.dest.on("drain", this.ondrain);
  }
  unpipe() {
    this.dest.removeListener("drain", this.ondrain);
  }
  proxyErrors(t) {
  }
  end() {
    this.unpipe(), this.opts.end && this.dest.end();
  }
};
var Li = class extends Fe {
  unpipe() {
    this.src.removeListener("error", this.proxyErrors), super.unpipe();
  }
  constructor(t, e, i) {
    super(t, e, i), this.proxyErrors = (r) => this.dest.emit("error", r), t.on("error", this.proxyErrors);
  }
};
var Xr = (s3) => !!s3.objectMode;
var qr = (s3) => !s3.objectMode && !!s3.encoding && s3.encoding !== "buffer";
var A = class extends Di {
  [g] = false;
  [Qt] = false;
  [N] = [];
  [b] = [];
  [L];
  [z];
  [Z];
  [Mt];
  [Q] = false;
  [nt] = false;
  [De] = false;
  [Ne] = false;
  [qt] = null;
  [_] = 0;
  [S] = false;
  [Jt];
  [Ce] = false;
  [Rt] = 0;
  [C] = false;
  writable = true;
  readable = true;
  constructor(...t) {
    let e = t[0] || {};
    if (super(), e.objectMode && typeof e.encoding == "string") throw new TypeError("Encoding and objectMode may not be used together");
    Xr(e) ? (this[L] = true, this[z] = null) : qr(e) ? (this[z] = e.encoding, this[L] = false) : (this[L] = false, this[z] = null), this[Z] = !!e.async, this[Mt] = this[z] ? new Hr(this[z]) : null, e && e.debugExposeBuffer === true && Object.defineProperty(this, "buffer", { get: () => this[b] }), e && e.debugExposePipes === true && Object.defineProperty(this, "pipes", { get: () => this[N] });
    let { signal: i } = e;
    i && (this[Jt] = i, i.aborted ? this[xi]() : i.addEventListener("abort", () => this[xi]()));
  }
  get bufferLength() {
    return this[_];
  }
  get encoding() {
    return this[z];
  }
  set encoding(t) {
    throw new Error("Encoding must be set at instantiation time");
  }
  setEncoding(t) {
    throw new Error("Encoding must be set at instantiation time");
  }
  get objectMode() {
    return this[L];
  }
  set objectMode(t) {
    throw new Error("objectMode must be set at instantiation time");
  }
  get async() {
    return this[Z];
  }
  set async(t) {
    this[Z] = this[Z] || !!t;
  }
  [xi]() {
    this[Ce] = true, this.emit("abort", this[Jt]?.reason), this.destroy(this[Jt]?.reason);
  }
  get aborted() {
    return this[Ce];
  }
  set aborted(t) {
  }
  write(t, e, i) {
    if (this[Ce]) return false;
    if (this[Q]) throw new Error("write after end");
    if (this[S]) return this.emit("error", Object.assign(new Error("Cannot call write after a stream was destroyed"), { code: "ERR_STREAM_DESTROYED" })), true;
    typeof e == "function" && (i = e, e = "utf8"), e || (e = "utf8");
    let r = this[Z] ? jt : Yr;
    if (!this[L] && !Buffer.isBuffer(t)) {
      if ($r(t)) t = Buffer.from(t.buffer, t.byteOffset, t.byteLength);
      else if (Vr(t)) t = Buffer.from(t);
      else if (typeof t != "string") throw new Error("Non-contiguous data written to non-objectMode stream");
    }
    return this[L] ? (this[g] && this[_] !== 0 && this[Ae](true), this[g] ? this.emit("data", t) : this[bi](t), this[_] !== 0 && this.emit("readable"), i && r(i), this[g]) : t.length ? (typeof t == "string" && !(e === this[z] && !this[Mt]?.lastNeed) && (t = Buffer.from(t, e)), Buffer.isBuffer(t) && this[z] && (t = this[Mt].write(t)), this[g] && this[_] !== 0 && this[Ae](true), this[g] ? this.emit("data", t) : this[bi](t), this[_] !== 0 && this.emit("readable"), i && r(i), this[g]) : (this[_] !== 0 && this.emit("readable"), i && r(i), this[g]);
  }
  read(t) {
    if (this[S]) return null;
    if (this[C] = false, this[_] === 0 || t === 0 || t && t > this[_]) return this[J](), null;
    this[L] && (t = null), this[b].length > 1 && !this[L] && (this[b] = [this[z] ? this[b].join("") : Buffer.concat(this[b], this[_])]);
    let e = this[Ns](t || null, this[b][0]);
    return this[J](), e;
  }
  [Ns](t, e) {
    if (this[L]) this[Ie]();
    else {
      let i = e;
      t === i.length || t === null ? this[Ie]() : typeof i == "string" ? (this[b][0] = i.slice(t), e = i.slice(0, t), this[_] -= t) : (this[b][0] = i.subarray(t), e = i.subarray(0, t), this[_] -= t);
    }
    return this.emit("data", e), !this[b].length && !this[Q] && this.emit("drain"), e;
  }
  end(t, e, i) {
    return typeof t == "function" && (i = t, t = void 0), typeof e == "function" && (i = e, e = "utf8"), t !== void 0 && this.write(t, e), i && this.once("end", i), this[Q] = true, this.writable = false, (this[g] || !this[Qt]) && this[J](), this;
  }
  [Bt]() {
    this[S] || (!this[Rt] && !this[N].length && (this[C] = true), this[Qt] = false, this[g] = true, this.emit("resume"), this[b].length ? this[Ae]() : this[Q] ? this[J]() : this.emit("drain"));
  }
  resume() {
    return this[Bt]();
  }
  pause() {
    this[g] = false, this[Qt] = true, this[C] = false;
  }
  get destroyed() {
    return this[S];
  }
  get flowing() {
    return this[g];
  }
  get paused() {
    return this[Qt];
  }
  [bi](t) {
    this[L] ? this[_] += 1 : this[_] += t.length, this[b].push(t);
  }
  [Ie]() {
    return this[L] ? this[_] -= 1 : this[_] -= this[b][0].length, this[b].shift();
  }
  [Ae](t = false) {
    do
      ;
    while (this[As](this[Ie]()) && this[b].length);
    !t && !this[b].length && !this[Q] && this.emit("drain");
  }
  [As](t) {
    return this.emit("data", t), this[g];
  }
  pipe(t, e) {
    if (this[S]) return t;
    this[C] = false;
    let i = this[nt];
    return e = e || {}, t === Ds.stdout || t === Ds.stderr ? e.end = false : e.end = e.end !== false, e.proxyErrors = !!e.proxyErrors, i ? e.end && t.end() : (this[N].push(e.proxyErrors ? new Li(this, t, e) : new Fe(this, t, e)), this[Z] ? jt(() => this[Bt]()) : this[Bt]()), t;
  }
  unpipe(t) {
    let e = this[N].find((i) => i.dest === t);
    e && (this[N].length === 1 ? (this[g] && this[Rt] === 0 && (this[g] = false), this[N] = []) : this[N].splice(this[N].indexOf(e), 1), e.unpipe());
  }
  addListener(t, e) {
    return this.on(t, e);
  }
  on(t, e) {
    let i = super.on(t, e);
    if (t === "data") this[C] = false, this[Rt]++, !this[N].length && !this[g] && this[Bt]();
    else if (t === "readable" && this[_] !== 0) super.emit("readable");
    else if (Kr(t) && this[nt]) super.emit(t), this.removeAllListeners(t);
    else if (t === "error" && this[qt]) {
      let r = e;
      this[Z] ? jt(() => r.call(this, this[qt])) : r.call(this, this[qt]);
    }
    return i;
  }
  removeListener(t, e) {
    return this.off(t, e);
  }
  off(t, e) {
    let i = super.off(t, e);
    return t === "data" && (this[Rt] = this.listeners("data").length, this[Rt] === 0 && !this[C] && !this[N].length && (this[g] = false)), i;
  }
  removeAllListeners(t) {
    let e = super.removeAllListeners(t);
    return (t === "data" || t === void 0) && (this[Rt] = 0, !this[C] && !this[N].length && (this[g] = false)), e;
  }
  get emittedEnd() {
    return this[nt];
  }
  [J]() {
    !this[De] && !this[nt] && !this[S] && this[b].length === 0 && this[Q] && (this[De] = true, this.emit("end"), this.emit("prefinish"), this.emit("finish"), this[Ne] && this.emit("close"), this[De] = false);
  }
  emit(t, ...e) {
    let i = e[0];
    if (t !== "error" && t !== "close" && t !== S && this[S]) return false;
    if (t === "data") return !this[L] && !i ? false : this[Z] ? (jt(() => this[Oi](i)), true) : this[Oi](i);
    if (t === "end") return this[Is]();
    if (t === "close") {
      if (this[Ne] = true, !this[nt] && !this[S]) return false;
      let n = super.emit("close");
      return this.removeAllListeners("close"), n;
    } else if (t === "error") {
      this[qt] = i, super.emit(_i, i);
      let n = !this[Jt] || this.listeners("error").length ? super.emit("error", i) : false;
      return this[J](), n;
    } else if (t === "resume") {
      let n = super.emit("resume");
      return this[J](), n;
    } else if (t === "finish" || t === "prefinish") {
      let n = super.emit(t);
      return this.removeAllListeners(t), n;
    }
    let r = super.emit(t, ...e);
    return this[J](), r;
  }
  [Oi](t) {
    for (let i of this[N]) i.dest.write(t) === false && this.pause();
    let e = this[C] ? false : super.emit("data", t);
    return this[J](), e;
  }
  [Is]() {
    return this[nt] ? false : (this[nt] = true, this.readable = false, this[Z] ? (jt(() => this[Ti]()), true) : this[Ti]());
  }
  [Ti]() {
    if (this[Mt]) {
      let e = this[Mt].end();
      if (e) {
        for (let i of this[N]) i.dest.write(e);
        this[C] || super.emit("data", e);
      }
    }
    for (let e of this[N]) e.end();
    let t = super.emit("end");
    return this.removeAllListeners("end"), t;
  }
  async collect() {
    let t = Object.assign([], { dataLength: 0 });
    this[L] || (t.dataLength = 0);
    let e = this.promise();
    return this.on("data", (i) => {
      t.push(i), this[L] || (t.dataLength += i.length);
    }), await e, t;
  }
  async concat() {
    if (this[L]) throw new Error("cannot concat in objectMode");
    let t = await this.collect();
    return this[z] ? t.join("") : Buffer.concat(t, t.dataLength);
  }
  async promise() {
    return new Promise((t, e) => {
      this.on(S, () => e(new Error("stream destroyed"))), this.on("error", (i) => e(i)), this.on("end", () => t());
    });
  }
  [Symbol.asyncIterator]() {
    this[C] = false;
    let t = false, e = async () => (this.pause(), t = true, { value: void 0, done: true });
    return { next: () => {
      if (t) return e();
      let r = this.read();
      if (r !== null) return Promise.resolve({ done: false, value: r });
      if (this[Q]) return e();
      let n, o, h = (d) => {
        this.off("data", a), this.off("end", l), this.off(S, c), e(), o(d);
      }, a = (d) => {
        this.off("error", h), this.off("end", l), this.off(S, c), this.pause(), n({ value: d, done: !!this[Q] });
      }, l = () => {
        this.off("error", h), this.off("data", a), this.off(S, c), e(), n({ done: true, value: void 0 });
      }, c = () => h(new Error("stream destroyed"));
      return new Promise((d, y) => {
        o = y, n = d, this.once(S, c), this.once("error", h), this.once("end", l), this.once("data", a);
      });
    }, throw: e, return: e, [Symbol.asyncIterator]() {
      return this;
    }, [Symbol.asyncDispose]: async () => {
    } };
  }
  [Symbol.iterator]() {
    this[C] = false;
    let t = false, e = () => (this.pause(), this.off(_i, e), this.off(S, e), this.off("end", e), t = true, { done: true, value: void 0 }), i = () => {
      if (t) return e();
      let r = this.read();
      return r === null ? e() : { done: false, value: r };
    };
    return this.once("end", e), this.once(_i, e), this.once(S, e), { next: i, throw: e, return: e, [Symbol.iterator]() {
      return this;
    }, [Symbol.dispose]: () => {
    } };
  }
  destroy(t) {
    if (this[S]) return t ? this.emit("error", t) : this.emit(S), this;
    this[S] = true, this[C] = true, this[b].length = 0, this[_] = 0;
    let e = this;
    return typeof e.close == "function" && !this[Ne] && e.close(), t ? this.emit("error", t) : this.emit(S), this;
  }
  static get isStream() {
    return Wr;
  }
};
var Jr = I.writev;
var ht = /* @__PURE__ */ Symbol("_autoClose");
var H = /* @__PURE__ */ Symbol("_close");
var te = /* @__PURE__ */ Symbol("_ended");
var m = /* @__PURE__ */ Symbol("_fd");
var Ni = /* @__PURE__ */ Symbol("_finished");
var tt = /* @__PURE__ */ Symbol("_flags");
var Ai = /* @__PURE__ */ Symbol("_flush");
var ki = /* @__PURE__ */ Symbol("_handleChunk");
var vi = /* @__PURE__ */ Symbol("_makeBuf");
var ie = /* @__PURE__ */ Symbol("_mode");
var ke = /* @__PURE__ */ Symbol("_needDrain");
var Ut = /* @__PURE__ */ Symbol("_onerror");
var Ht = /* @__PURE__ */ Symbol("_onopen");
var Ii = /* @__PURE__ */ Symbol("_onread");
var Pt = /* @__PURE__ */ Symbol("_onwrite");
var at = /* @__PURE__ */ Symbol("_open");
var U = /* @__PURE__ */ Symbol("_path");
var ot = /* @__PURE__ */ Symbol("_pos");
var Y = /* @__PURE__ */ Symbol("_queue");
var zt = /* @__PURE__ */ Symbol("_read");
var Ci = /* @__PURE__ */ Symbol("_readSize");
var j = /* @__PURE__ */ Symbol("_reading");
var ee = /* @__PURE__ */ Symbol("_remain");
var Fi = /* @__PURE__ */ Symbol("_size");
var ve = /* @__PURE__ */ Symbol("_write");
var gt = /* @__PURE__ */ Symbol("_writing");
var Me = /* @__PURE__ */ Symbol("_defaultFlag");
var bt = /* @__PURE__ */ Symbol("_errored");
var _t = class extends A {
  [bt] = false;
  [m];
  [U];
  [Ci];
  [j] = false;
  [Fi];
  [ee];
  [ht];
  constructor(t, e) {
    if (e = e || {}, super(e), this.readable = true, this.writable = false, typeof t != "string") throw new TypeError("path must be a string");
    this[bt] = false, this[m] = typeof e.fd == "number" ? e.fd : void 0, this[U] = t, this[Ci] = e.readSize || 16 * 1024 * 1024, this[j] = false, this[Fi] = typeof e.size == "number" ? e.size : 1 / 0, this[ee] = this[Fi], this[ht] = typeof e.autoClose == "boolean" ? e.autoClose : true, typeof this[m] == "number" ? this[zt]() : this[at]();
  }
  get fd() {
    return this[m];
  }
  get path() {
    return this[U];
  }
  write() {
    throw new TypeError("this is a readable stream");
  }
  end() {
    throw new TypeError("this is a readable stream");
  }
  [at]() {
    I.open(this[U], "r", (t, e) => this[Ht](t, e));
  }
  [Ht](t, e) {
    t ? this[Ut](t) : (this[m] = e, this.emit("open", e), this[zt]());
  }
  [vi]() {
    return Buffer.allocUnsafe(Math.min(this[Ci], this[ee]));
  }
  [zt]() {
    if (!this[j]) {
      this[j] = true;
      let t = this[vi]();
      if (t.length === 0) return process.nextTick(() => this[Ii](null, 0, t));
      I.read(this[m], t, 0, t.length, null, (e, i, r) => this[Ii](e, i, r));
    }
  }
  [Ii](t, e, i) {
    this[j] = false, t ? this[Ut](t) : this[ki](e, i) && this[zt]();
  }
  [H]() {
    if (this[ht] && typeof this[m] == "number") {
      let t = this[m];
      this[m] = void 0, I.close(t, (e) => e ? this.emit("error", e) : this.emit("close"));
    }
  }
  [Ut](t) {
    this[j] = true, this[H](), this.emit("error", t);
  }
  [ki](t, e) {
    let i = false;
    return this[ee] -= t, t > 0 && (i = super.write(t < e.length ? e.subarray(0, t) : e)), (t === 0 || this[ee] <= 0) && (i = false, this[H](), super.end()), i;
  }
  emit(t, ...e) {
    switch (t) {
      case "prefinish":
      case "finish":
        return false;
      case "drain":
        return typeof this[m] == "number" && this[zt](), false;
      case "error":
        return this[bt] ? false : (this[bt] = true, super.emit(t, ...e));
      default:
        return super.emit(t, ...e);
    }
  }
};
var Be = class extends _t {
  [at]() {
    let t = true;
    try {
      this[Ht](null, I.openSync(this[U], "r")), t = false;
    } finally {
      t && this[H]();
    }
  }
  [zt]() {
    let t = true;
    try {
      if (!this[j]) {
        this[j] = true;
        do {
          let e = this[vi](), i = e.length === 0 ? 0 : I.readSync(this[m], e, 0, e.length, null);
          if (!this[ki](i, e)) break;
        } while (true);
        this[j] = false;
      }
      t = false;
    } finally {
      t && this[H]();
    }
  }
  [H]() {
    if (this[ht] && typeof this[m] == "number") {
      let t = this[m];
      this[m] = void 0, I.closeSync(t), this.emit("close");
    }
  }
};
var et = class extends Qr {
  readable = false;
  writable = true;
  [bt] = false;
  [gt] = false;
  [te] = false;
  [Y] = [];
  [ke] = false;
  [U];
  [ie];
  [ht];
  [m];
  [Me];
  [tt];
  [Ni] = false;
  [ot];
  constructor(t, e) {
    e = e || {}, super(e), this[U] = t, this[m] = typeof e.fd == "number" ? e.fd : void 0, this[ie] = e.mode === void 0 ? 438 : e.mode, this[ot] = typeof e.start == "number" ? e.start : void 0, this[ht] = typeof e.autoClose == "boolean" ? e.autoClose : true;
    let i = this[ot] !== void 0 ? "r+" : "w";
    this[Me] = e.flags === void 0, this[tt] = e.flags === void 0 ? i : e.flags, this[m] === void 0 && this[at]();
  }
  emit(t, ...e) {
    if (t === "error") {
      if (this[bt]) return false;
      this[bt] = true;
    }
    return super.emit(t, ...e);
  }
  get fd() {
    return this[m];
  }
  get path() {
    return this[U];
  }
  [Ut](t) {
    this[H](), this[gt] = true, this.emit("error", t);
  }
  [at]() {
    I.open(this[U], this[tt], this[ie], (t, e) => this[Ht](t, e));
  }
  [Ht](t, e) {
    this[Me] && this[tt] === "r+" && t && t.code === "ENOENT" ? (this[tt] = "w", this[at]()) : t ? this[Ut](t) : (this[m] = e, this.emit("open", e), this[gt] || this[Ai]());
  }
  end(t, e) {
    return t && this.write(t, e), this[te] = true, !this[gt] && !this[Y].length && typeof this[m] == "number" && this[Pt](null, 0), this;
  }
  write(t, e) {
    return typeof t == "string" && (t = Buffer.from(t, e)), this[te] ? (this.emit("error", new Error("write() after end()")), false) : this[m] === void 0 || this[gt] || this[Y].length ? (this[Y].push(t), this[ke] = true, false) : (this[gt] = true, this[ve](t), true);
  }
  [ve](t) {
    I.write(this[m], t, 0, t.length, this[ot], (e, i) => this[Pt](e, i));
  }
  [Pt](t, e) {
    t ? this[Ut](t) : (this[ot] !== void 0 && typeof e == "number" && (this[ot] += e), this[Y].length ? this[Ai]() : (this[gt] = false, this[te] && !this[Ni] ? (this[Ni] = true, this[H](), this.emit("finish")) : this[ke] && (this[ke] = false, this.emit("drain"))));
  }
  [Ai]() {
    if (this[Y].length === 0) this[te] && this[Pt](null, 0);
    else if (this[Y].length === 1) this[ve](this[Y].pop());
    else {
      let t = this[Y];
      this[Y] = [], Jr(this[m], t, this[ot], (e, i) => this[Pt](e, i));
    }
  }
  [H]() {
    if (this[ht] && typeof this[m] == "number") {
      let t = this[m];
      this[m] = void 0, I.close(t, (e) => e ? this.emit("error", e) : this.emit("close"));
    }
  }
};
var Wt = class extends et {
  [at]() {
    let t;
    if (this[Me] && this[tt] === "r+") try {
      t = I.openSync(this[U], this[tt], this[ie]);
    } catch (e) {
      if (e?.code === "ENOENT") return this[tt] = "w", this[at]();
      throw e;
    }
    else t = I.openSync(this[U], this[tt], this[ie]);
    this[Ht](null, t);
  }
  [H]() {
    if (this[ht] && typeof this[m] == "number") {
      let t = this[m];
      this[m] = void 0, I.closeSync(t), this.emit("close");
    }
  }
  [ve](t) {
    let e = true;
    try {
      this[Pt](null, I.writeSync(this[m], t, 0, t.length, this[ot])), e = false;
    } finally {
      if (e) try {
        this[H]();
      } catch {
      }
    }
  }
};
var jr = /* @__PURE__ */ new Map([["C", "cwd"], ["f", "file"], ["z", "gzip"], ["P", "preservePaths"], ["U", "unlink"], ["strip-components", "strip"], ["stripComponents", "strip"], ["keep-newer", "newer"], ["keepNewer", "newer"], ["keep-newer-files", "newer"], ["keepNewerFiles", "newer"], ["k", "keep"], ["keep-existing", "keep"], ["keepExisting", "keep"], ["m", "noMtime"], ["no-mtime", "noMtime"], ["p", "preserveOwner"], ["L", "follow"], ["h", "follow"], ["onentry", "onReadEntry"]]);
var Fs = (s3) => !!s3.sync && !!s3.file;
var ks = (s3) => !s3.sync && !!s3.file;
var vs = (s3) => !!s3.sync && !s3.file;
var Ms = (s3) => !s3.sync && !s3.file;
var Bs = (s3) => !!s3.file;
var tn = (s3) => {
  let t = jr.get(s3);
  return t || s3;
};
var se = (s3 = {}) => {
  if (!s3) return {};
  let t = {};
  for (let [e, i] of Object.entries(s3)) {
    let r = tn(e);
    t[r] = i;
  }
  return t.chmod === void 0 && t.noChmod === false && (t.chmod = true), delete t.noChmod, t;
};
var K = (s3, t, e, i, r) => Object.assign((n = [], o, h) => {
  Array.isArray(n) && (o = n, n = {}), typeof o == "function" && (h = o, o = void 0), o = o ? Array.from(o) : [];
  let a = se(n);
  if (r?.(a, o), Fs(a)) {
    if (typeof h == "function") throw new TypeError("callback not supported for sync tar functions");
    return s3(a, o);
  } else if (ks(a)) {
    let l = t(a, o);
    return h ? l.then(() => h(), h) : l;
  } else if (vs(a)) {
    if (typeof h == "function") throw new TypeError("callback not supported for sync tar functions");
    return e(a, o);
  } else if (Ms(a)) {
    if (typeof h == "function") throw new TypeError("callback only supported with file option");
    return i(a, o);
  }
  throw new Error("impossible options??");
}, { syncFile: s3, asyncFile: t, syncNoFile: e, asyncNoFile: i, validate: r });
var sn = en.constants || { ZLIB_VERNUM: 4736 };
var M = Object.freeze(Object.assign(/* @__PURE__ */ Object.create(null), { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_VERSION_ERROR: -6, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, DEFLATE: 1, INFLATE: 2, GZIP: 3, GUNZIP: 4, DEFLATERAW: 5, INFLATERAW: 6, UNZIP: 7, BROTLI_DECODE: 8, BROTLI_ENCODE: 9, Z_MIN_WINDOWBITS: 8, Z_MAX_WINDOWBITS: 15, Z_DEFAULT_WINDOWBITS: 15, Z_MIN_CHUNK: 64, Z_MAX_CHUNK: 1 / 0, Z_DEFAULT_CHUNK: 16384, Z_MIN_MEMLEVEL: 1, Z_MAX_MEMLEVEL: 9, Z_DEFAULT_MEMLEVEL: 8, Z_MIN_LEVEL: -1, Z_MAX_LEVEL: 9, Z_DEFAULT_LEVEL: -1, BROTLI_OPERATION_PROCESS: 0, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2, BROTLI_OPERATION_EMIT_METADATA: 3, BROTLI_MODE_GENERIC: 0, BROTLI_MODE_TEXT: 1, BROTLI_MODE_FONT: 2, BROTLI_DEFAULT_MODE: 0, BROTLI_MIN_QUALITY: 0, BROTLI_MAX_QUALITY: 11, BROTLI_DEFAULT_QUALITY: 11, BROTLI_MIN_WINDOW_BITS: 10, BROTLI_MAX_WINDOW_BITS: 24, BROTLI_LARGE_MAX_WINDOW_BITS: 30, BROTLI_DEFAULT_WINDOW: 22, BROTLI_MIN_INPUT_BLOCK_BITS: 16, BROTLI_MAX_INPUT_BLOCK_BITS: 24, BROTLI_PARAM_MODE: 0, BROTLI_PARAM_QUALITY: 1, BROTLI_PARAM_LGWIN: 2, BROTLI_PARAM_LGBLOCK: 3, BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4, BROTLI_PARAM_SIZE_HINT: 5, BROTLI_PARAM_LARGE_WINDOW: 6, BROTLI_PARAM_NPOSTFIX: 7, BROTLI_PARAM_NDIRECT: 8, BROTLI_DECODER_RESULT_ERROR: 0, BROTLI_DECODER_RESULT_SUCCESS: 1, BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: 2, BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: 3, BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: 0, BROTLI_DECODER_PARAM_LARGE_WINDOW: 1, BROTLI_DECODER_NO_ERROR: 0, BROTLI_DECODER_SUCCESS: 1, BROTLI_DECODER_NEEDS_MORE_INPUT: 2, BROTLI_DECODER_NEEDS_MORE_OUTPUT: 3, BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE: -1, BROTLI_DECODER_ERROR_FORMAT_RESERVED: -2, BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE: -3, BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET: -4, BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME: -5, BROTLI_DECODER_ERROR_FORMAT_CL_SPACE: -6, BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE: -7, BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT: -8, BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1: -9, BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2: -10, BROTLI_DECODER_ERROR_FORMAT_TRANSFORM: -11, BROTLI_DECODER_ERROR_FORMAT_DICTIONARY: -12, BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS: -13, BROTLI_DECODER_ERROR_FORMAT_PADDING_1: -14, BROTLI_DECODER_ERROR_FORMAT_PADDING_2: -15, BROTLI_DECODER_ERROR_FORMAT_DISTANCE: -16, BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET: -19, BROTLI_DECODER_ERROR_INVALID_ARGUMENTS: -20, BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES: -21, BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS: -22, BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP: -25, BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1: -26, BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2: -27, BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES: -30, BROTLI_DECODER_ERROR_UNREACHABLE: -31 }, sn));
var rn = Ot.concat;
var zs = Object.getOwnPropertyDescriptor(Ot, "concat");
var nn = (s3) => s3;
var Bi = zs?.writable === true || zs?.set !== void 0 ? (s3) => {
  Ot.concat = s3 ? nn : rn;
} : (s3) => {
};
var Tt = /* @__PURE__ */ Symbol("_superWrite");
var Gt = class extends Error {
  code;
  errno;
  constructor(t, e) {
    super("zlib: " + t.message, { cause: t }), this.code = t.code, this.errno = t.errno, this.code || (this.code = "ZLIB_ERROR"), this.message = "zlib: " + t.message, Error.captureStackTrace(this, e ?? this.constructor);
  }
  get name() {
    return "ZlibError";
  }
};
var Pi = /* @__PURE__ */ Symbol("flushFlag");
var re = class extends A {
  #t = false;
  #i = false;
  #s;
  #n;
  #r;
  #e;
  #o;
  get sawError() {
    return this.#t;
  }
  get handle() {
    return this.#e;
  }
  get flushFlag() {
    return this.#s;
  }
  constructor(t, e) {
    if (!t || typeof t != "object") throw new TypeError("invalid options for ZlibBase constructor");
    if (super(t), this.#s = t.flush ?? 0, this.#n = t.finishFlush ?? 0, this.#r = t.fullFlushFlag ?? 0, typeof Ps[e] != "function") throw new TypeError("Compression method not supported: " + e);
    try {
      this.#e = new Ps[e](t);
    } catch (i) {
      throw new Gt(i, this.constructor);
    }
    this.#o = (i) => {
      this.#t || (this.#t = true, this.close(), this.emit("error", i));
    }, this.#e?.on("error", (i) => this.#o(new Gt(i))), this.once("end", () => this.close);
  }
  close() {
    this.#e && (this.#e.close(), this.#e = void 0, this.emit("close"));
  }
  reset() {
    if (!this.#t) return zi(this.#e, "zlib binding closed"), this.#e.reset?.();
  }
  flush(t) {
    this.ended || (typeof t != "number" && (t = this.#r), this.write(Object.assign(Ot.alloc(0), { [Pi]: t })));
  }
  end(t, e, i) {
    return typeof t == "function" && (i = t, e = void 0, t = void 0), typeof e == "function" && (i = e, e = void 0), t && (e ? this.write(t, e) : this.write(t)), this.flush(this.#n), this.#i = true, super.end(i);
  }
  get ended() {
    return this.#i;
  }
  [Tt](t) {
    return super.write(t);
  }
  write(t, e, i) {
    if (typeof e == "function" && (i = e, e = "utf8"), typeof t == "string" && (t = Ot.from(t, e)), this.#t) return;
    zi(this.#e, "zlib binding closed");
    let r = this.#e._handle, n = r.close;
    r.close = () => {
    };
    let o = this.#e.close;
    this.#e.close = () => {
    }, Bi(true);
    let h;
    try {
      let l = typeof t[Pi] == "number" ? t[Pi] : this.#s;
      h = this.#e._processChunk(t, l), Bi(false);
    } catch (l) {
      Bi(false), this.#o(new Gt(l, this.write));
    } finally {
      this.#e && (this.#e._handle = r, r.close = n, this.#e.close = o, this.#e.removeAllListeners("error"));
    }
    this.#e && this.#e.on("error", (l) => this.#o(new Gt(l, this.write)));
    let a;
    if (h) if (Array.isArray(h) && h.length > 0) {
      let l = h[0];
      a = this[Tt](Ot.from(l));
      for (let c = 1; c < h.length; c++) a = this[Tt](h[c]);
    } else a = this[Tt](Ot.from(h));
    return i && i(), a;
  }
};
var Pe = class extends re {
  #t;
  #i;
  constructor(t, e) {
    t = t || {}, t.flush = t.flush || M.Z_NO_FLUSH, t.finishFlush = t.finishFlush || M.Z_FINISH, t.fullFlushFlag = M.Z_FULL_FLUSH, super(t, e), this.#t = t.level, this.#i = t.strategy;
  }
  params(t, e) {
    if (!this.sawError) {
      if (!this.handle) throw new Error("cannot switch params when binding is closed");
      if (!this.handle.params) throw new Error("not supported in this implementation");
      if (this.#t !== t || this.#i !== e) {
        this.flush(M.Z_SYNC_FLUSH), zi(this.handle, "zlib binding closed");
        let i = this.handle.flush;
        this.handle.flush = (r, n) => {
          typeof r == "function" && (n = r, r = this.flushFlag), this.flush(r), n?.();
        };
        try {
          this.handle.params(t, e);
        } finally {
          this.handle.flush = i;
        }
        this.handle && (this.#t = t, this.#i = e);
      }
    }
  }
};
var ze = class extends Pe {
  #t;
  constructor(t) {
    super(t, "Gzip"), this.#t = t && !!t.portable;
  }
  [Tt](t) {
    return this.#t ? (this.#t = false, t[9] = 255, super[Tt](t)) : super[Tt](t);
  }
};
var Ue = class extends Pe {
  constructor(t) {
    super(t, "Unzip");
  }
};
var He = class extends re {
  constructor(t, e) {
    t = t || {}, t.flush = t.flush || M.BROTLI_OPERATION_PROCESS, t.finishFlush = t.finishFlush || M.BROTLI_OPERATION_FINISH, t.fullFlushFlag = M.BROTLI_OPERATION_FLUSH, super(t, e);
  }
};
var We = class extends He {
  constructor(t) {
    super(t, "BrotliCompress");
  }
};
var Ge = class extends He {
  constructor(t) {
    super(t, "BrotliDecompress");
  }
};
var Ze = class extends re {
  constructor(t, e) {
    t = t || {}, t.flush = t.flush || M.ZSTD_e_continue, t.finishFlush = t.finishFlush || M.ZSTD_e_end, t.fullFlushFlag = M.ZSTD_e_flush, super(t, e);
  }
};
var Ye = class extends Ze {
  constructor(t) {
    super(t, "ZstdCompress");
  }
};
var Ke = class extends Ze {
  constructor(t) {
    super(t, "ZstdDecompress");
  }
};
var Us = (s3, t) => {
  if (Number.isSafeInteger(s3)) s3 < 0 ? an(s3, t) : hn(s3, t);
  else throw Error("cannot encode number outside of javascript safe integer range");
  return t;
};
var hn = (s3, t) => {
  t[0] = 128;
  for (var e = t.length; e > 1; e--) t[e - 1] = s3 & 255, s3 = Math.floor(s3 / 256);
};
var an = (s3, t) => {
  t[0] = 255;
  var e = false;
  s3 = s3 * -1;
  for (var i = t.length; i > 1; i--) {
    var r = s3 & 255;
    s3 = Math.floor(s3 / 256), e ? t[i - 1] = Ws(r) : r === 0 ? t[i - 1] = 0 : (e = true, t[i - 1] = Gs(r));
  }
};
var Hs = (s3) => {
  let t = s3[0], e = t === 128 ? cn(s3.subarray(1, s3.length)) : t === 255 ? ln(s3) : null;
  if (e === null) throw Error("invalid base256 encoding");
  if (!Number.isSafeInteger(e)) throw Error("parsed number outside of javascript safe integer range");
  return e;
};
var ln = (s3) => {
  for (var t = s3.length, e = 0, i = false, r = t - 1; r > -1; r--) {
    var n = Number(s3[r]), o;
    i ? o = Ws(n) : n === 0 ? o = n : (i = true, o = Gs(n)), o !== 0 && (e -= o * Math.pow(256, t - r - 1));
  }
  return e;
};
var cn = (s3) => {
  for (var t = s3.length, e = 0, i = t - 1; i > -1; i--) {
    var r = Number(s3[i]);
    r !== 0 && (e += r * Math.pow(256, t - i - 1));
  }
  return e;
};
var Ws = (s3) => (255 ^ s3) & 255;
var Gs = (s3) => (255 ^ s3) + 1 & 255;
var Hi = {};
Ur(Hi, { code: () => Ve, isCode: () => ne, isName: () => dn, name: () => oe, normalFsTypes: () => Ui });
var ne = (s3) => oe.has(s3);
var dn = (s3) => Ve.has(s3);
var Ui = /* @__PURE__ */ new Set(["0", "", "1", "2", "3", "4", "5", "6", "7", "D"]);
var oe = /* @__PURE__ */ new Map([["0", "File"], ["", "OldFile"], ["1", "Link"], ["2", "SymbolicLink"], ["3", "CharacterDevice"], ["4", "BlockDevice"], ["5", "Directory"], ["6", "FIFO"], ["7", "ContiguousFile"], ["g", "GlobalExtendedHeader"], ["x", "ExtendedHeader"], ["A", "SolarisACL"], ["D", "GNUDumpDir"], ["I", "Inode"], ["K", "NextFileHasLongLinkpath"], ["L", "NextFileHasLongPath"], ["M", "ContinuationFile"], ["N", "OldGnuLongPath"], ["S", "SparseFile"], ["V", "TapeVolumeHeader"], ["X", "OldExtendedHeader"]]);
var Ve = new Map(Array.from(oe).map((s3) => [s3[1], s3[0]]));
var un = (s3) => s3 === void 0 || s3 < 0 ? void 0 : s3;
var F = class {
  cksumValid = false;
  needPax = false;
  nullBlock = false;
  block;
  path;
  mode;
  uid;
  gid;
  size;
  cksum;
  #t = "Unsupported";
  linkpath;
  uname;
  gname;
  devmaj = 0;
  devmin = 0;
  atime;
  ctime;
  mtime;
  charset;
  comment;
  constructor(t, e = 0, i, r) {
    Buffer.isBuffer(t) ? this.decode(t, e || 0, i, r) : t && this.#i(t);
  }
  decode(t, e, i, r) {
    if (e || (e = 0), !t || !(t.length >= e + 512)) throw new Error("need 512 bytes for header");
    let n = xt(t, e + 156, 1), o = Ui.has(n), h = o ? i : void 0, a = o ? r : void 0;
    if (this.path = h?.path ?? xt(t, e, 100), this.mode = h?.mode ?? a?.mode ?? lt(t, e + 100, 8), this.uid = h?.uid ?? a?.uid ?? lt(t, e + 108, 8), this.gid = h?.gid ?? a?.gid ?? lt(t, e + 116, 8), this.size = un(h?.size ?? a?.size ?? lt(t, e + 124, 12)), this.mtime = h?.mtime ?? a?.mtime ?? Wi(t, e + 136, 12), this.cksum = lt(t, e + 148, 12), a && this.#i(a, true), h && this.#i(h), ne(n) && (this.#t = n || "0"), this.#t === "0" && this.path.slice(-1) === "/" && (this.#t = "5"), this.#t === "5" && (this.size = 0), this.linkpath = xt(t, e + 157, 100), t.subarray(e + 257, e + 265).toString() === "ustar\x0000") if (this.uname = h?.uname ?? a?.uname ?? xt(t, e + 265, 32), this.gname = h?.gname ?? a?.gname ?? xt(t, e + 297, 32), this.devmaj = h?.devmaj ?? a?.devmaj ?? lt(t, e + 329, 8) ?? 0, this.devmin = h?.devmin ?? a?.devmin ?? lt(t, e + 337, 8) ?? 0, t[e + 475] !== 0) {
      let c = xt(t, e + 345, 155);
      this.path = c + "/" + this.path;
    } else {
      let c = xt(t, e + 345, 130);
      c && (this.path = c + "/" + this.path), this.atime = i?.atime ?? r?.atime ?? Wi(t, e + 476, 12), this.ctime = i?.ctime ?? r?.ctime ?? Wi(t, e + 488, 12);
    }
    let l = 256;
    for (let c = e; c < e + 148; c++) l += t[c];
    for (let c = e + 156; c < e + 512; c++) l += t[c];
    this.cksumValid = l === this.cksum, this.cksum === void 0 && l === 256 && (this.nullBlock = true);
  }
  #i(t, e = false) {
    Object.assign(this, Object.fromEntries(Object.entries(t).filter(([i, r]) => !(r == null || i === "size" && Number(r) < 0 || i === "path" && e || i === "linkpath" && e || i === "global"))));
  }
  encode(t, e = 0) {
    if (t || (t = this.block = Buffer.alloc(512)), this.#t === "Unsupported" && (this.#t = "0"), !(t.length >= e + 512)) throw new Error("need 512 bytes for header");
    let i = this.ctime || this.atime ? 130 : 155, r = mn(this.path || "", i), n = r[0], o = r[1];
    this.needPax = !!r[2], this.needPax = Lt(t, e, 100, n) || this.needPax, this.needPax = ct(t, e + 100, 8, this.mode) || this.needPax, this.needPax = ct(t, e + 108, 8, this.uid) || this.needPax, this.needPax = ct(t, e + 116, 8, this.gid) || this.needPax, this.needPax = ct(t, e + 124, 12, this.size) || this.needPax, this.needPax = Gi(t, e + 136, 12, this.mtime) || this.needPax, t[e + 156] = Number(this.#t.codePointAt(0)), this.needPax = Lt(t, e + 157, 100, this.linkpath) || this.needPax, t.write("ustar\x0000", e + 257, 8), this.needPax = Lt(t, e + 265, 32, this.uname) || this.needPax, this.needPax = Lt(t, e + 297, 32, this.gname) || this.needPax, this.needPax = ct(t, e + 329, 8, this.devmaj) || this.needPax, this.needPax = ct(t, e + 337, 8, this.devmin) || this.needPax, this.needPax = Lt(t, e + 345, i, o) || this.needPax, t[e + 475] !== 0 ? this.needPax = Lt(t, e + 345, 155, o) || this.needPax : (this.needPax = Lt(t, e + 345, 130, o) || this.needPax, this.needPax = Gi(t, e + 476, 12, this.atime) || this.needPax, this.needPax = Gi(t, e + 488, 12, this.ctime) || this.needPax);
    let h = 256;
    for (let a = e; a < e + 148; a++) h += t[a];
    for (let a = e + 156; a < e + 512; a++) h += t[a];
    return this.cksum = h, ct(t, e + 148, 8, this.cksum), this.cksumValid = true, this.needPax;
  }
  get type() {
    return this.#t === "Unsupported" ? this.#t : oe.get(this.#t);
  }
  get typeKey() {
    return this.#t;
  }
  set type(t) {
    let e = String(Ve.get(t));
    if (ne(e) || e === "Unsupported") this.#t = e;
    else if (ne(t)) this.#t = t;
    else throw new TypeError("invalid entry type: " + t);
  }
};
var mn = (s3, t) => {
  let i = s3, r = "", n, o = Zt.parse(s3).root || ".";
  if (Buffer.byteLength(i) < 100) n = [i, r, false];
  else {
    r = Zt.dirname(i), i = Zt.basename(i);
    do
      Buffer.byteLength(i) <= 100 && Buffer.byteLength(r) <= t ? n = [i, r, false] : Buffer.byteLength(i) > 100 && Buffer.byteLength(r) <= t ? n = [i.slice(0, 99), r, true] : (i = Zt.join(Zt.basename(r), i), r = Zt.dirname(r));
    while (r !== o && n === void 0);
    n || (n = [s3.slice(0, 99), "", true]);
  }
  return n;
};
var xt = (s3, t, e) => s3.subarray(t, t + e).toString("utf8").replace(/\0.*/, "");
var Wi = (s3, t, e) => pn(lt(s3, t, e));
var pn = (s3) => s3 === void 0 ? void 0 : new Date(s3 * 1e3);
var lt = (s3, t, e) => Number(s3[t]) & 128 ? Hs(s3.subarray(t, t + e)) : wn(s3, t, e);
var En = (s3) => isNaN(s3) ? void 0 : s3;
var wn = (s3, t, e) => En(parseInt(s3.subarray(t, t + e).toString("utf8").replace(/\0.*$/, "").trim(), 8));
var Sn = { 12: 8589934591, 8: 2097151 };
var ct = (s3, t, e, i) => i === void 0 ? false : i > Sn[e] || i < 0 ? (Us(i, s3.subarray(t, t + e)), true) : (yn(s3, t, e, i), false);
var yn = (s3, t, e, i) => s3.write(Rn(i, e), t, e, "ascii");
var Rn = (s3, t) => gn(Math.floor(s3).toString(8), t);
var gn = (s3, t) => (s3.length === t - 1 ? s3 : new Array(t - s3.length - 1).join("0") + s3 + " ") + "\0";
var Gi = (s3, t, e, i) => i === void 0 ? false : ct(s3, t, e, i.getTime() / 1e3);
var bn = new Array(156).join("\0");
var Lt = (s3, t, e, i) => i === void 0 ? false : (s3.write(i + bn, t, e, "utf8"), i.length !== Buffer.byteLength(i) || i.length > e);
var ft = class s {
  atime;
  mtime;
  ctime;
  charset;
  comment;
  gid;
  uid;
  gname;
  uname;
  linkpath;
  dev;
  ino;
  nlink;
  path;
  size;
  mode;
  global;
  constructor(t, e = false) {
    this.atime = t.atime, this.charset = t.charset, this.comment = t.comment, this.ctime = t.ctime, this.dev = t.dev, this.gid = t.gid, this.global = e, this.gname = t.gname, this.ino = t.ino, this.linkpath = t.linkpath, this.mtime = t.mtime, this.nlink = t.nlink, this.path = t.path, this.size = t.size, this.uid = t.uid, this.uname = t.uname;
  }
  encode() {
    let t = this.encodeBody();
    if (t === "") return Buffer.allocUnsafe(0);
    let e = Buffer.byteLength(t), i = 512 * Math.ceil(1 + e / 512), r = Buffer.allocUnsafe(i);
    for (let n = 0; n < 512; n++) r[n] = 0;
    new F({ path: ("PaxHeader/" + _n(this.path ?? "")).slice(0, 99), mode: this.mode || 420, uid: this.uid, gid: this.gid, size: e, mtime: this.mtime, type: this.global ? "GlobalExtendedHeader" : "ExtendedHeader", linkpath: "", uname: this.uname || "", gname: this.gname || "", devmaj: 0, devmin: 0, atime: this.atime, ctime: this.ctime }).encode(r), r.write(t, 512, e, "utf8");
    for (let n = e + 512; n < r.length; n++) r[n] = 0;
    return r;
  }
  encodeBody() {
    return this.encodeField("path") + this.encodeField("ctime") + this.encodeField("atime") + this.encodeField("dev") + this.encodeField("ino") + this.encodeField("nlink") + this.encodeField("charset") + this.encodeField("comment") + this.encodeField("gid") + this.encodeField("gname") + this.encodeField("linkpath") + this.encodeField("mtime") + this.encodeField("size") + this.encodeField("uid") + this.encodeField("uname");
  }
  encodeField(t) {
    if (this[t] === void 0) return "";
    let e = this[t], i = e instanceof Date ? e.getTime() / 1e3 : e, r = " " + (t === "dev" || t === "ino" || t === "nlink" ? "SCHILY." : "") + t + "=" + i + `
`, n = Buffer.byteLength(r), o = Math.floor(Math.log(n) / Math.log(10)) + 1;
    return n + o >= Math.pow(10, o) && (o += 1), o + n + r;
  }
  static parse(t, e, i = false) {
    return new s(On(Tn(t), e), i);
  }
};
var On = (s3, t) => t ? Object.assign({}, t, s3) : s3;
var Tn = (s3) => s3.replace(/\n$/, "").split(`
`).reduce(xn, /* @__PURE__ */ Object.create(null));
var xn = (s3, t) => {
  let e = parseInt(t, 10);
  if (e !== Buffer.byteLength(t) + 1) return s3;
  t = t.slice((e + " ").length);
  let i = t.split("="), r = i.shift();
  if (!r) return s3;
  let n = r.replace(/^SCHILY\.(dev|ino|nlink)/, "$1"), o = i.join("=").replace(/\0.*/, "");
  switch (n) {
    case "path":
    case "linkpath":
    case "type":
    case "charset":
    case "comment":
    case "gname":
    case "uname":
      s3[n] = o;
      break;
    case "ctime":
    case "atime":
    case "mtime":
      s3[n] = new Date(Number(o) * 1e3);
      break;
    case "size":
      let h = +o;
      h >= 0 && (s3[n] = h);
      break;
    case "gid":
    case "uid":
    case "dev":
    case "ino":
    case "nlink":
    case "mode":
      s3[n] = +o;
      break;
  }
  return s3;
};
var Ln = process.env.TESTING_TAR_FAKE_PLATFORM || process.platform;
var f = Ln !== "win32" ? (s3) => String(s3) : (s3) => String(s3).replaceAll(/\\/g, "/");
var $e = class extends A {
  extended;
  globalExtended;
  header;
  startBlockSize;
  blockRemain;
  remain;
  type;
  meta = false;
  ignore = false;
  path;
  mode;
  uid;
  gid;
  uname;
  gname;
  size = 0;
  mtime;
  atime;
  ctime;
  linkpath;
  dev;
  ino;
  nlink;
  invalid = false;
  absolute;
  unsupported = false;
  constructor(t, e, i) {
    switch (super({}), this.pause(), this.extended = e, this.globalExtended = i, this.header = t, this.remain = t.size ?? 0, this.startBlockSize = 512 * Math.ceil(this.remain / 512), this.blockRemain = this.startBlockSize, this.type = t.type, this.type) {
      case "File":
      case "OldFile":
      case "Link":
      case "SymbolicLink":
      case "CharacterDevice":
      case "BlockDevice":
      case "Directory":
      case "FIFO":
      case "ContiguousFile":
      case "GNUDumpDir":
        break;
      case "NextFileHasLongLinkpath":
      case "NextFileHasLongPath":
      case "OldGnuLongPath":
      case "GlobalExtendedHeader":
      case "ExtendedHeader":
      case "OldExtendedHeader":
        this.meta = true;
        break;
      default:
        this.ignore = true;
    }
    if (!t.path) throw new Error("no path provided for tar.ReadEntry");
    this.path = f(t.path), this.mode = t.mode, this.mode && (this.mode = this.mode & 4095), this.uid = t.uid, this.gid = t.gid, this.uname = t.uname, this.gname = t.gname, this.size = this.remain, this.mtime = t.mtime, this.atime = t.atime, this.ctime = t.ctime, this.linkpath = t.linkpath ? f(t.linkpath) : void 0, this.uname = t.uname, this.gname = t.gname, e && this.#t(e), i && this.#t(i, true);
  }
  write(t) {
    let e = t.length;
    if (e > this.blockRemain) throw new Error("writing more to entry than is appropriate");
    let i = this.remain, r = this.blockRemain;
    return this.remain = Math.max(0, i - e), this.blockRemain = Math.max(0, r - e), this.ignore ? true : i >= e ? super.write(t) : super.write(t.subarray(0, i));
  }
  #t(t, e = false) {
    t.path && (t.path = f(t.path)), t.linkpath && (t.linkpath = f(t.linkpath)), Object.assign(this, Object.fromEntries(Object.entries(t).filter(([i, r]) => !(r == null || i === "path" && e))));
  }
};
var Dt = (s3, t, e, i = {}) => {
  s3.file && (i.file = s3.file), s3.cwd && (i.cwd = s3.cwd), i.code = e instanceof Error && e.code || t, i.tarCode = t, !s3.strict && i.recoverable !== false ? (e instanceof Error && (i = Object.assign(e, i), e = e.message), s3.emit("warn", t, e, i)) : e instanceof Error ? s3.emit("error", Object.assign(e, i)) : s3.emit("error", Object.assign(new Error(`${t}: ${e}`), i));
};
var Nn = 1024 * 1024;
var Xi = Buffer.from([31, 139]);
var qi = Buffer.from([40, 181, 47, 253]);
var An = Math.max(Xi.length, qi.length);
var B = /* @__PURE__ */ Symbol("state");
var Nt = /* @__PURE__ */ Symbol("writeEntry");
var it = /* @__PURE__ */ Symbol("readEntry");
var Zi = /* @__PURE__ */ Symbol("nextEntry");
var Zs = /* @__PURE__ */ Symbol("processEntry");
var V = /* @__PURE__ */ Symbol("extendedHeader");
var he = /* @__PURE__ */ Symbol("globalExtendedHeader");
var dt = /* @__PURE__ */ Symbol("meta");
var Ys = /* @__PURE__ */ Symbol("emitMeta");
var p = /* @__PURE__ */ Symbol("buffer");
var st = /* @__PURE__ */ Symbol("queue");
var ut = /* @__PURE__ */ Symbol("ended");
var Yi = /* @__PURE__ */ Symbol("emittedEnd");
var At = /* @__PURE__ */ Symbol("emit");
var w = /* @__PURE__ */ Symbol("unzip");
var Xe = /* @__PURE__ */ Symbol("consumeChunk");
var qe = /* @__PURE__ */ Symbol("consumeChunkSub");
var Ki = /* @__PURE__ */ Symbol("consumeBody");
var Ks = /* @__PURE__ */ Symbol("consumeMeta");
var Vs = /* @__PURE__ */ Symbol("consumeHeader");
var ae = /* @__PURE__ */ Symbol("consuming");
var Vi = /* @__PURE__ */ Symbol("bufferConcat");
var Qe = /* @__PURE__ */ Symbol("maybeEnd");
var Yt = /* @__PURE__ */ Symbol("writing");
var $ = /* @__PURE__ */ Symbol("aborted");
var Je = /* @__PURE__ */ Symbol("onDone");
var It = /* @__PURE__ */ Symbol("sawValidEntry");
var je = /* @__PURE__ */ Symbol("sawNullBlock");
var ti = /* @__PURE__ */ Symbol("sawEOF");
var $s = /* @__PURE__ */ Symbol("closeStream");
var In = 1e3;
var le = /* @__PURE__ */ Symbol("compressedBytesRead");
var $i = /* @__PURE__ */ Symbol("decompressedBytesRead");
var Xs = /* @__PURE__ */ Symbol("checkDecompressionRatio");
var Cn = () => true;
var rt = class extends Dn {
  file;
  strict;
  maxMetaEntrySize;
  filter;
  brotli;
  zstd;
  maxDecompressionRatio;
  writable = true;
  readable = false;
  [st] = [];
  [p];
  [it];
  [Nt];
  [B] = "begin";
  [dt] = "";
  [V];
  [he];
  [ut] = false;
  [w];
  [$] = false;
  [It];
  [je] = false;
  [ti] = false;
  [Yt] = false;
  [ae] = false;
  [Yi] = false;
  [le] = 0;
  [$i] = 0;
  constructor(t = {}) {
    super(), this.file = t.file || "", this.on(Je, () => {
      (this[B] === "begin" || this[It] === false) && this.warn("TAR_BAD_ARCHIVE", "Unrecognized archive format");
    }), t.ondone ? this.on(Je, t.ondone) : this.on(Je, () => {
      this.emit("prefinish"), this.emit("finish"), this.emit("end");
    }), this.strict = !!t.strict, this.maxDecompressionRatio = typeof t.maxDecompressionRatio == "number" ? t.maxDecompressionRatio : In, this.maxMetaEntrySize = t.maxMetaEntrySize || Nn, this.filter = typeof t.filter == "function" ? t.filter : Cn;
    let e = t.file && (t.file.endsWith(".tar.br") || t.file.endsWith(".tbr"));
    this.brotli = !(t.gzip || t.zstd) && t.brotli !== void 0 ? t.brotli : e ? void 0 : false;
    let i = t.file && (t.file.endsWith(".tar.zst") || t.file.endsWith(".tzst"));
    this.zstd = !(t.gzip || t.brotli) && t.zstd !== void 0 ? t.zstd : i ? true : void 0, this.on("end", () => this[$s]()), typeof t.onwarn == "function" && this.on("warn", t.onwarn), typeof t.onReadEntry == "function" && this.on("entry", t.onReadEntry);
  }
  warn(t, e, i = {}) {
    Dt(this, t, e, i);
  }
  [Vs](t, e) {
    this[It] === void 0 && (this[It] = false);
    let i;
    try {
      i = new F(t, e, this[V], this[he]);
    } catch (r) {
      return this.warn("TAR_ENTRY_INVALID", r);
    }
    if (i.nullBlock) this[je] ? (this[ti] = true, this[B] === "begin" && (this[B] = "header"), this[At]("eof")) : (this[je] = true, this[At]("nullBlock"));
    else if (this[je] = false, !i.cksumValid) this.warn("TAR_ENTRY_INVALID", "checksum failure", { header: i });
    else if (!i.path) this.warn("TAR_ENTRY_INVALID", "path is required", { header: i });
    else {
      let r = i.type;
      if (/^(Symbolic)?Link$/.test(r) && !i.linkpath) this.warn("TAR_ENTRY_INVALID", "linkpath required", { header: i });
      else if (!/^(Symbolic)?Link$/.test(r) && !/^(Global)?ExtendedHeader$/.test(r) && i.linkpath) this.warn("TAR_ENTRY_INVALID", "linkpath forbidden", { header: i });
      else {
        let n = this[Nt] = new $e(i, this[V], this[he]);
        if (!this[It]) if (n.remain) {
          let o = () => {
            n.invalid || (this[It] = true);
          };
          n.on("end", o);
        } else this[It] = true;
        n.meta ? n.size > this.maxMetaEntrySize ? (n.ignore = true, this[At]("ignoredEntry", n), this[B] = "ignore", n.resume()) : n.size > 0 && (this[dt] = "", n.on("data", (o) => this[dt] += o), this[B] = "meta") : (this[V] = void 0, n.ignore = n.ignore || !this.filter(n.path, n), n.ignore ? (this[At]("ignoredEntry", n), this[B] = n.remain ? "ignore" : "header", n.resume()) : (n.remain ? this[B] = "body" : (this[B] = "header", n.end()), this[it] ? this[st].push(n) : (this[st].push(n), this[Zi]())));
      }
    }
  }
  [$s]() {
    queueMicrotask(() => this.emit("close"));
  }
  [Zs](t) {
    let e = true;
    if (!t) this[it] = void 0, e = false;
    else if (Array.isArray(t)) {
      let [i, ...r] = t;
      this.emit(i, ...r);
    } else this[it] = t, this.emit("entry", t), t.emittedEnd || (t.on("end", () => this[Zi]()), e = false);
    return e;
  }
  [Zi]() {
    do
      ;
    while (this[Zs](this[st].shift()));
    if (this[st].length === 0) {
      let t = this[it];
      !t || t.flowing || t.size === t.remain ? this[Yt] || this.emit("drain") : t.once("drain", () => this.emit("drain"));
    }
  }
  [Ki](t, e) {
    let i = this[Nt];
    if (!i) throw new Error("attempt to consume body without entry??");
    let r = i.blockRemain ?? 0, n = r >= t.length && e === 0 ? t : t.subarray(e, e + r);
    return i.write(n), i.blockRemain || (this[B] = "header", this[Nt] = void 0, i.end()), n.length;
  }
  [Ks](t, e) {
    let i = this[Nt], r = this[Ki](t, e);
    return !this[Nt] && i && this[Ys](i), r;
  }
  [At](t, e, i) {
    this[st].length === 0 && !this[it] ? this.emit(t, e, i) : this[st].push([t, e, i]);
  }
  [Ys](t) {
    switch (this[At]("meta", this[dt]), t.type) {
      case "ExtendedHeader":
      case "OldExtendedHeader":
        this[V] = ft.parse(this[dt], this[V], false);
        break;
      case "GlobalExtendedHeader":
        this[he] = ft.parse(this[dt], this[he], true);
        break;
      case "NextFileHasLongPath":
      case "OldGnuLongPath": {
        let e = this[V] ?? /* @__PURE__ */ Object.create(null);
        this[V] = e, e.path = this[dt].replace(/\0.*/, "");
        break;
      }
      case "NextFileHasLongLinkpath": {
        let e = this[V] || /* @__PURE__ */ Object.create(null);
        this[V] = e, e.linkpath = this[dt].replace(/\0.*/, "");
        break;
      }
      default:
        throw new Error("unknown meta: " + t.type);
    }
  }
  abort(t) {
    if (!this[$]) {
      if (this[w]) {
        let e = this[w];
        e.write = () => true, e.end = () => e, e.emit = () => false, e.destroy?.();
      }
      this[$] = true, this.emit("abort", t), this.warn("TAR_ABORT", t, { recoverable: false });
    }
  }
  [Xs](t) {
    this[$i] += t.length;
    let e = this[$i] / this[le];
    return e > this.maxDecompressionRatio ? (this.abort(new Error(`max decompression ratio exceeded: ${e.toFixed(2)} > ${this.maxDecompressionRatio}`)), false) : true;
  }
  write(t, e, i) {
    if (typeof e == "function" && (i = e, e = void 0), typeof t == "string" && (t = Buffer.from(t, typeof e == "string" ? e : "utf8")), this[$]) return i?.(), false;
    if ((this[w] === void 0 || this.brotli === void 0 && this[w] === false) && t) {
      if (this[p] && (t = Buffer.concat([this[p], t]), this[p] = void 0), t.length < An) return this[p] = t, i?.(), true;
      for (let a = 0; this[w] === void 0 && a < Xi.length; a++) t[a] !== Xi[a] && (this[w] = false);
      let o = false;
      if (this[w] === false && this.zstd !== false) {
        o = true;
        for (let a = 0; a < qi.length; a++) if (t[a] !== qi[a]) {
          o = false;
          break;
        }
      }
      let h = this.brotli === void 0 && !o;
      if (this[w] === false && h) if (t.length < 512) if (this[ut]) this.brotli = true;
      else return this[p] = t, i?.(), true;
      else try {
        new F(t.subarray(0, 512)), this.brotli = false;
      } catch {
        this.brotli = true;
      }
      if (this[w] === void 0 || this[w] === false && (this.brotli || o)) {
        let a = this[ut];
        this[ut] = false, this[w] = this[w] === void 0 ? new Ue({}) : o ? new Ke({}) : new Ge({}), this[w].on("data", (c) => {
          this[Xs](c) && this[Xe](c);
        }), this[w].on("error", (c) => {
          this[$] || this.abort(c);
        }), this[w].on("end", () => {
          this[ut] = true, this[Xe]();
        }), this[Yt] = true, this[le] += t.length;
        let l = !!this[w][a ? "end" : "write"](t);
        return this[Yt] = false, i?.(), l;
      }
    }
    this[Yt] = true, this[w] ? (this[le] += t.length, this[w].write(t)) : this[Xe](t), this[Yt] = false;
    let n = this[st].length > 0 ? false : this[it] ? this[it].flowing : true;
    return !n && this[st].length === 0 && this[it]?.once("drain", () => this.emit("drain")), i?.(), n;
  }
  [Vi](t) {
    t && !this[$] && (this[p] = this[p] ? Buffer.concat([this[p], t]) : t);
  }
  [Qe]() {
    if (this[ut] && !this[Yi] && !this[$] && !this[ae]) {
      this[Yi] = true;
      let t = this[Nt];
      if (t?.blockRemain) {
        let e = this[p] ? this[p].length : 0;
        this.warn("TAR_BAD_ARCHIVE", `Truncated input (needed ${t.blockRemain} more bytes, only ${e} available)`, { entry: t }), this[p] && t.write(this[p]), t.end();
      }
      this[At](Je);
    }
  }
  [Xe](t) {
    if (this[ae] && t) this[Vi](t);
    else if (!t && !this[p]) this[Qe]();
    else if (t) {
      if (this[ae] = true, this[p]) {
        this[Vi](t);
        let e = this[p];
        this[p] = void 0, this[qe](e);
      } else this[qe](t);
      for (; this[p] && this[p]?.length >= 512 && !this[$] && !this[ti]; ) {
        let e = this[p];
        this[p] = void 0, this[qe](e);
      }
      this[ae] = false;
    }
    (!this[p] || this[ut]) && this[Qe]();
  }
  [qe](t) {
    let e = 0, i = t.length;
    for (; e + 512 <= i && !this[$] && !this[ti]; ) switch (this[B]) {
      case "begin":
      case "header":
        this[Vs](t, e), e += 512;
        break;
      case "ignore":
      case "body":
        e += this[Ki](t, e);
        break;
      case "meta":
        e += this[Ks](t, e);
        break;
      default:
        throw new Error("invalid state: " + this[B]);
    }
    e < i && (this[p] = this[p] ? Buffer.concat([t.subarray(e), this[p]]) : t.subarray(e));
  }
  end(t, e, i) {
    return typeof t == "function" && (i = t, e = void 0, t = void 0), typeof e == "function" && (i = e, e = void 0), typeof t == "string" && (t = Buffer.from(t, e)), i && this.once("finish", i), this[$] || (this[w] ? (t && (this[le] += t.length, this[w].write(t)), this[w].end()) : (this[ut] = true, (this.brotli === void 0 || this.zstd === void 0) && (t = t || Buffer.alloc(0)), t && this.write(t), this[Qe]())), this;
  }
};
var mt = (s3) => {
  let t = s3.length - 1, e = -1;
  for (; t > -1 && s3.charAt(t) === "/"; ) e = t, t--;
  return e === -1 ? s3 : s3.slice(0, e);
};
var vn = (s3) => {
  let t = s3.onReadEntry;
  s3.onReadEntry = t ? (e) => {
    t(e), e.resume();
  } : (e) => e.resume();
};
var Qi = (s3, t) => {
  let e = new Map(t.map((o) => [mt(o), true])), i = s3.filter, r = 100, n = (o, h = "", a = 0) => {
    if (a >= r) return e.set(o, false), false;
    let l = h || kn(o).root || ".", c;
    if (o === l) c = false;
    else {
      let d = e.get(o);
      c = d !== void 0 ? d : n(Fn(o), l, a + 1);
    }
    return e.set(o, c), c;
  };
  s3.filter = i ? (o, h) => i(o, h) && n(mt(o)) : (o) => n(mt(o));
};
var Mn = (s3) => {
  let t = new rt(s3), e = s3.file, i;
  try {
    i = Kt.openSync(e, "r");
    let r = Kt.fstatSync(i), n = s3.maxReadSize || 16 * 1024 * 1024;
    if (r.size < n) {
      let o = Buffer.allocUnsafe(r.size), h = Kt.readSync(i, o, 0, r.size, 0);
      t.end(h === o.byteLength ? o : o.subarray(0, h));
    } else {
      let o = 0, h = Buffer.allocUnsafe(n);
      for (; o < r.size; ) {
        let a = Kt.readSync(i, h, 0, n, o);
        if (a === 0) break;
        o += a, t.write(h.subarray(0, a));
      }
      t.end();
    }
  } finally {
    if (typeof i == "number") try {
      Kt.closeSync(i);
    } catch {
    }
  }
};
var Bn = (s3, t) => {
  let e = new rt(s3), i = s3.maxReadSize || 16 * 1024 * 1024, r = s3.file;
  return new Promise((o, h) => {
    e.on("error", h), e.on("end", o), Kt.stat(r, (a, l) => {
      if (a) h(a);
      else {
        let c = new _t(r, { readSize: i, size: l.size });
        c.on("error", h), c.pipe(e);
      }
    });
  });
};
var Ct = K(Mn, Bn, (s3) => new rt(s3), (s3) => new rt(s3), (s3, t) => {
  t?.length && Qi(s3, t), s3.noResume || vn(s3);
});
var Ji = (s3, t, e) => (s3 &= 4095, e && (s3 = (s3 | 384) & -19), t && (s3 & 256 && (s3 |= 64), s3 & 32 && (s3 |= 8), s3 & 4 && (s3 |= 1)), s3);
var { isAbsolute: zn, parse: qs } = Pn;
var ce = (s3) => {
  let t = "", e = qs(s3);
  for (; zn(s3) || e.root; ) {
    let i = s3.charAt(0) === "/" && s3.slice(0, 4) !== "//?/" ? "/" : e.root;
    s3 = s3.slice(i.length), t += i, e = qs(s3);
  }
  return [t, s3];
};
var ei = ["|", "<", ">", "?", ":"];
var ji = ei.map((s3) => String.fromCodePoint(61440 + Number(s3.codePointAt(0))));
var Un = new Map(ei.map((s3, t) => [s3, ji[t]]));
var Hn = new Map(ji.map((s3, t) => [s3, ei[t]]));
var ts = (s3) => ei.reduce((t, e) => t.split(e).join(Un.get(e)), s3);
var Qs = (s3) => ji.reduce((t, e) => t.split(e).join(Hn.get(e)), s3);
var rr = (s3, t) => t ? (s3 = f(s3).replace(/^\.(\/|$)/, ""), mt(t) + "/" + s3) : f(s3);
var Wn = 16 * 1024 * 1024;
var tr = /* @__PURE__ */ Symbol("process");
var er = /* @__PURE__ */ Symbol("file");
var ir = /* @__PURE__ */ Symbol("directory");
var is = /* @__PURE__ */ Symbol("symlink");
var sr = /* @__PURE__ */ Symbol("hardlink");
var fe = /* @__PURE__ */ Symbol("header");
var ii = /* @__PURE__ */ Symbol("read");
var ss = /* @__PURE__ */ Symbol("lstat");
var si = /* @__PURE__ */ Symbol("onlstat");
var rs = /* @__PURE__ */ Symbol("onread");
var ns = /* @__PURE__ */ Symbol("onreadlink");
var os = /* @__PURE__ */ Symbol("openfile");
var hs = /* @__PURE__ */ Symbol("onopenfile");
var pt = /* @__PURE__ */ Symbol("close");
var ri = /* @__PURE__ */ Symbol("mode");
var as = /* @__PURE__ */ Symbol("awaitDrain");
var es = /* @__PURE__ */ Symbol("ondrain");
var q = /* @__PURE__ */ Symbol("prefix");
var de = class extends A {
  path;
  portable;
  myuid = process.getuid && process.getuid() || 0;
  myuser = process.env.USER || "";
  maxReadSize;
  linkCache;
  statCache;
  preservePaths;
  cwd;
  strict;
  mtime;
  noPax;
  noMtime;
  prefix;
  fd;
  blockLen = 0;
  blockRemain = 0;
  buf;
  pos = 0;
  remain = 0;
  length = 0;
  offset = 0;
  win32;
  absolute;
  header;
  type;
  linkpath;
  stat;
  onWriteEntry;
  #t = false;
  constructor(t, e = {}) {
    let i = se(e);
    super(), this.path = f(t), this.portable = !!i.portable, this.maxReadSize = i.maxReadSize || Wn, this.linkCache = i.linkCache || /* @__PURE__ */ new Map(), this.statCache = i.statCache || /* @__PURE__ */ new Map(), this.preservePaths = !!i.preservePaths, this.cwd = f(i.cwd || process.cwd()), this.strict = !!i.strict, this.noPax = !!i.noPax, this.noMtime = !!i.noMtime, this.mtime = i.mtime, this.prefix = i.prefix ? f(i.prefix) : void 0, this.onWriteEntry = i.onWriteEntry, typeof i.onwarn == "function" && this.on("warn", i.onwarn);
    let r = false;
    if (!this.preservePaths) {
      let [o, h] = ce(this.path);
      o && typeof h == "string" && (this.path = h, r = o);
    }
    this.win32 = !!i.win32 || process.platform === "win32", this.win32 && (this.path = Qs(this.path.replaceAll(/\\/g, "/")), t = t.replaceAll(/\\/g, "/")), this.absolute = f(i.absolute || js.resolve(this.cwd, t)), this.path === "" && (this.path = "./"), r && this.warn("TAR_ENTRY_INFO", `stripping ${r} from absolute path`, { entry: this, path: r + this.path });
    let n = this.statCache.get(this.absolute);
    n ? this[si](n) : this[ss]();
  }
  warn(t, e, i = {}) {
    return Dt(this, t, e, i);
  }
  emit(t, ...e) {
    return t === "error" && (this.#t = true), super.emit(t, ...e);
  }
  [ss]() {
    X.lstat(this.absolute, (t, e) => {
      if (t) return this.emit("error", t);
      this[si](e);
    });
  }
  [si](t) {
    this.statCache.set(this.absolute, t), this.stat = t, t.isFile() || (t.size = 0), this.type = Gn(t), this.emit("stat", t), this[tr]();
  }
  [tr]() {
    switch (this.type) {
      case "File":
        return this[er]();
      case "Directory":
        return this[ir]();
      case "SymbolicLink":
        return this[is]();
      default:
        return this.end();
    }
  }
  [ri](t) {
    return Ji(t, this.type === "Directory", this.portable);
  }
  [q](t) {
    return rr(t, this.prefix);
  }
  [fe]() {
    if (!this.stat) throw new Error("cannot write header before stat");
    this.type === "Directory" && this.portable && (this.noMtime = true), this.onWriteEntry?.(this), this.header = new F({ path: this[q](this.path), linkpath: this.type === "Link" && this.linkpath !== void 0 ? this[q](this.linkpath) : this.linkpath, mode: this[ri](this.stat.mode), uid: this.portable ? void 0 : this.stat.uid, gid: this.portable ? void 0 : this.stat.gid, size: this.stat.size, mtime: this.noMtime ? void 0 : this.mtime || this.stat.mtime, type: this.type === "Unsupported" ? void 0 : this.type, uname: this.portable ? void 0 : this.stat.uid === this.myuid ? this.myuser : "", atime: this.portable ? void 0 : this.stat.atime, ctime: this.portable ? void 0 : this.stat.ctime }), this.header.encode() && !this.noPax && super.write(new ft({ atime: this.portable ? void 0 : this.header.atime, ctime: this.portable ? void 0 : this.header.ctime, gid: this.portable ? void 0 : this.header.gid, mtime: this.noMtime ? void 0 : this.mtime || this.header.mtime, path: this[q](this.path), linkpath: this.type === "Link" && this.linkpath !== void 0 ? this[q](this.linkpath) : this.linkpath, size: this.header.size, uid: this.portable ? void 0 : this.header.uid, uname: this.portable ? void 0 : this.header.uname, dev: this.portable ? void 0 : this.stat.dev, ino: this.portable ? void 0 : this.stat.ino, nlink: this.portable ? void 0 : this.stat.nlink }).encode());
    let t = this.header?.block;
    if (!t) throw new Error("failed to encode header");
    super.write(t);
  }
  [ir]() {
    if (!this.stat) throw new Error("cannot create directory entry without stat");
    this.path.slice(-1) !== "/" && (this.path += "/"), this.stat.size = 0, this[fe](), this.end();
  }
  [is]() {
    X.readlink(this.absolute, (t, e) => {
      if (t) return this.emit("error", t);
      this[ns](e);
    });
  }
  [ns](t) {
    this.linkpath = f(t), this[fe](), this.end();
  }
  [sr](t) {
    if (!this.stat) throw new Error("cannot create link entry without stat");
    this.type = "Link", this.linkpath = f(js.relative(this.cwd, t)), this.stat.size = 0, this[fe](), this.end();
  }
  [er]() {
    if (!this.stat) throw new Error("cannot create file entry without stat");
    if (this.stat.nlink > 1) {
      let t = `${this.stat.dev}:${this.stat.ino}`, e = this.linkCache.get(t);
      if (e?.indexOf(this.cwd) === 0) return this[sr](e);
      this.linkCache.set(t, this.absolute);
    }
    if (this[fe](), this.stat.size === 0) return this.end();
    this[os]();
  }
  [os]() {
    X.open(this.absolute, "r", (t, e) => {
      if (t) return this.emit("error", t);
      this[hs](e);
    });
  }
  [hs](t) {
    if (this.fd = t, this.#t) return this[pt]();
    if (!this.stat) throw new Error("should stat before calling onopenfile");
    this.blockLen = 512 * Math.ceil(this.stat.size / 512), this.blockRemain = this.blockLen;
    let e = Math.min(this.blockLen, this.maxReadSize);
    this.buf = Buffer.allocUnsafe(e), this.offset = 0, this.pos = 0, this.remain = this.stat.size, this.length = this.buf.length, this[ii]();
  }
  [ii]() {
    let { fd: t, buf: e, offset: i, length: r, pos: n } = this;
    if (t === void 0 || e === void 0) throw new Error("cannot read file without first opening");
    X.read(t, e, i, r, n, (o, h) => {
      if (o) return this[pt](() => this.emit("error", o));
      this[rs](h);
    });
  }
  [pt](t = () => {
  }) {
    this.fd !== void 0 && X.close(this.fd, t);
  }
  [rs](t) {
    if (t <= 0 && this.remain > 0) {
      let r = Object.assign(new Error("encountered unexpected EOF"), { path: this.absolute, syscall: "read", code: "EOF" });
      return this[pt](() => this.emit("error", r));
    }
    if (t > this.remain) {
      let r = Object.assign(new Error("did not encounter expected EOF"), { path: this.absolute, syscall: "read", code: "EOF" });
      return this[pt](() => this.emit("error", r));
    }
    if (!this.buf) throw new Error("should have created buffer prior to reading");
    if (t === this.remain) for (let r = t; r < this.length && t < this.blockRemain; r++) this.buf[r + this.offset] = 0, t++, this.remain++;
    let e = this.offset === 0 && t === this.buf.length ? this.buf : this.buf.subarray(this.offset, this.offset + t);
    this.write(e) ? this[es]() : this[as](() => this[es]());
  }
  [as](t) {
    this.once("drain", t);
  }
  write(t, e, i) {
    if (typeof e == "function" && (i = e, e = void 0), typeof t == "string" && (t = Buffer.from(t, typeof e == "string" ? e : "utf8")), this.blockRemain < t.length) {
      let r = Object.assign(new Error("writing more data than expected"), { path: this.absolute });
      return this.emit("error", r);
    }
    return this.remain -= t.length, this.blockRemain -= t.length, this.pos += t.length, this.offset += t.length, super.write(t, null, i);
  }
  [es]() {
    if (!this.remain) return this.blockRemain && super.write(Buffer.alloc(this.blockRemain)), this[pt]((t) => t ? this.emit("error", t) : this.end());
    if (!this.buf) throw new Error("buffer lost somehow in ONDRAIN");
    this.offset >= this.length && (this.buf = Buffer.allocUnsafe(Math.min(this.blockRemain, this.buf.length)), this.offset = 0), this.length = this.buf.length - this.offset, this[ii]();
  }
};
var ni = class extends de {
  sync = true;
  [ss]() {
    this[si](X.lstatSync(this.absolute));
  }
  [is]() {
    this[ns](X.readlinkSync(this.absolute));
  }
  [os]() {
    this[hs](X.openSync(this.absolute, "r"));
  }
  [ii]() {
    let t = true;
    try {
      let { fd: e, buf: i, offset: r, length: n, pos: o } = this;
      if (e === void 0 || i === void 0) throw new Error("fd and buf must be set in READ method");
      let h = X.readSync(e, i, r, n, o);
      this[rs](h), t = false;
    } finally {
      if (t) try {
        this[pt](() => {
        });
      } catch {
      }
    }
  }
  [as](t) {
    t();
  }
  [pt](t = () => {
  }) {
    this.fd !== void 0 && X.closeSync(this.fd), t();
  }
};
var oi = class extends A {
  blockLen = 0;
  blockRemain = 0;
  buf = 0;
  pos = 0;
  remain = 0;
  length = 0;
  preservePaths;
  portable;
  strict;
  noPax;
  noMtime;
  readEntry;
  type;
  prefix;
  path;
  mode;
  uid;
  gid;
  uname;
  gname;
  header;
  mtime;
  atime;
  ctime;
  linkpath;
  size;
  onWriteEntry;
  warn(t, e, i = {}) {
    return Dt(this, t, e, i);
  }
  constructor(t, e = {}) {
    let i = se(e);
    super(), this.preservePaths = !!i.preservePaths, this.portable = !!i.portable, this.strict = !!i.strict, this.noPax = !!i.noPax, this.noMtime = !!i.noMtime, this.onWriteEntry = i.onWriteEntry, this.readEntry = t;
    let { type: r } = t;
    if (r === "Unsupported") throw new Error("writing entry that should be ignored");
    this.type = r, this.type === "Directory" && this.portable && (this.noMtime = true), this.prefix = i.prefix, this.path = f(t.path), this.mode = t.mode !== void 0 ? this[ri](t.mode) : void 0, this.uid = this.portable ? void 0 : t.uid, this.gid = this.portable ? void 0 : t.gid, this.uname = this.portable ? void 0 : t.uname, this.gname = this.portable ? void 0 : t.gname, this.size = t.size, this.mtime = this.noMtime ? void 0 : i.mtime || t.mtime, this.atime = this.portable ? void 0 : t.atime, this.ctime = this.portable ? void 0 : t.ctime, this.linkpath = t.linkpath !== void 0 ? f(t.linkpath) : void 0, typeof i.onwarn == "function" && this.on("warn", i.onwarn);
    let n = false;
    if (!this.preservePaths) {
      let [h, a] = ce(this.path);
      h && typeof a == "string" && (this.path = a, n = h);
    }
    this.remain = t.size, this.blockRemain = t.startBlockSize, this.onWriteEntry?.(this), this.header = new F({ path: this[q](this.path), linkpath: this.type === "Link" && this.linkpath !== void 0 ? this[q](this.linkpath) : this.linkpath, mode: this.mode, uid: this.portable ? void 0 : this.uid, gid: this.portable ? void 0 : this.gid, size: this.size, mtime: this.noMtime ? void 0 : this.mtime, type: this.type, uname: this.portable ? void 0 : this.uname, atime: this.portable ? void 0 : this.atime, ctime: this.portable ? void 0 : this.ctime }), n && this.warn("TAR_ENTRY_INFO", `stripping ${n} from absolute path`, { entry: this, path: n + this.path }), this.header.encode() && !this.noPax && super.write(new ft({ atime: this.portable ? void 0 : this.atime, ctime: this.portable ? void 0 : this.ctime, gid: this.portable ? void 0 : this.gid, mtime: this.noMtime ? void 0 : this.mtime, path: this[q](this.path), linkpath: this.type === "Link" && this.linkpath !== void 0 ? this[q](this.linkpath) : this.linkpath, size: this.size, uid: this.portable ? void 0 : this.uid, uname: this.portable ? void 0 : this.uname, dev: this.portable ? void 0 : this.readEntry.dev, ino: this.portable ? void 0 : this.readEntry.ino, nlink: this.portable ? void 0 : this.readEntry.nlink }).encode());
    let o = this.header?.block;
    if (!o) throw new Error("failed to encode header");
    super.write(o), t.pipe(this);
  }
  [q](t) {
    return rr(t, this.prefix);
  }
  [ri](t) {
    return Ji(t, this.type === "Directory", this.portable);
  }
  write(t, e, i) {
    typeof e == "function" && (i = e, e = void 0), typeof t == "string" && (t = Buffer.from(t, typeof e == "string" ? e : "utf8"));
    let r = t.length;
    if (r > this.blockRemain) throw new Error("writing more to entry than is appropriate");
    return this.blockRemain -= r, super.write(t, i);
  }
  end(t, e, i) {
    return this.blockRemain && super.write(Buffer.alloc(this.blockRemain)), typeof t == "function" && (i = t, e = void 0, t = void 0), typeof e == "function" && (i = e, e = void 0), typeof t == "string" && (t = Buffer.from(t, e ?? "utf8")), i && this.once("finish", i), t ? super.end(t, i) : super.end(i), this;
  }
};
var Gn = (s3) => s3.isFile() ? "File" : s3.isDirectory() ? "Directory" : s3.isSymbolicLink() ? "SymbolicLink" : "Unsupported";
var hi = class s2 {
  tail;
  head;
  length = 0;
  static create(t = []) {
    return new s2(t);
  }
  constructor(t = []) {
    for (let e of t) this.push(e);
  }
  *[Symbol.iterator]() {
    for (let t = this.head; t; t = t.next) yield t.value;
  }
  removeNode(t) {
    if (t.list !== this) throw new Error("removing node which does not belong to this list");
    let e = t.next, i = t.prev;
    return e && (e.prev = i), i && (i.next = e), t === this.head && (this.head = e), t === this.tail && (this.tail = i), this.length--, t.next = void 0, t.prev = void 0, t.list = void 0, e;
  }
  unshiftNode(t) {
    if (t === this.head) return;
    t.list && t.list.removeNode(t);
    let e = this.head;
    t.list = this, t.next = e, e && (e.prev = t), this.head = t, this.tail || (this.tail = t), this.length++;
  }
  pushNode(t) {
    if (t === this.tail) return;
    t.list && t.list.removeNode(t);
    let e = this.tail;
    t.list = this, t.prev = e, e && (e.next = t), this.tail = t, this.head || (this.head = t), this.length++;
  }
  push(...t) {
    for (let e = 0, i = t.length; e < i; e++) Yn(this, t[e]);
    return this.length;
  }
  unshift(...t) {
    for (var e = 0, i = t.length; e < i; e++) Kn(this, t[e]);
    return this.length;
  }
  pop() {
    if (!this.tail) return;
    let t = this.tail.value, e = this.tail;
    return this.tail = this.tail.prev, this.tail ? this.tail.next = void 0 : this.head = void 0, e.list = void 0, this.length--, t;
  }
  shift() {
    if (!this.head) return;
    let t = this.head.value, e = this.head;
    return this.head = this.head.next, this.head ? this.head.prev = void 0 : this.tail = void 0, e.list = void 0, this.length--, t;
  }
  forEach(t, e) {
    e = e || this;
    for (let i = this.head, r = 0; i; r++) t.call(e, i.value, r, this), i = i.next;
  }
  forEachReverse(t, e) {
    e = e || this;
    for (let i = this.tail, r = this.length - 1; i; r--) t.call(e, i.value, r, this), i = i.prev;
  }
  get(t) {
    let e = 0, i = this.head;
    for (; i && e < t; e++) i = i.next;
    if (e === t && i) return i.value;
  }
  getReverse(t) {
    let e = 0, i = this.tail;
    for (; i && e < t; e++) i = i.prev;
    if (e === t && i) return i.value;
  }
  map(t, e) {
    e = e || this;
    let i = new s2();
    for (let r = this.head; r; ) i.push(t.call(e, r.value, this)), r = r.next;
    return i;
  }
  mapReverse(t, e) {
    e = e || this;
    var i = new s2();
    for (let r = this.tail; r; ) i.push(t.call(e, r.value, this)), r = r.prev;
    return i;
  }
  reduce(t, e) {
    let i, r = this.head;
    if (arguments.length > 1) i = e;
    else if (this.head) r = this.head.next, i = this.head.value;
    else throw new TypeError("Reduce of empty list with no initial value");
    for (var n = 0; r; n++) i = t(i, r.value, n), r = r.next;
    return i;
  }
  reduceReverse(t, e) {
    let i, r = this.tail;
    if (arguments.length > 1) i = e;
    else if (this.tail) r = this.tail.prev, i = this.tail.value;
    else throw new TypeError("Reduce of empty list with no initial value");
    for (let n = this.length - 1; r; n--) i = t(i, r.value, n), r = r.prev;
    return i;
  }
  toArray() {
    let t = new Array(this.length);
    for (let e = 0, i = this.head; i; e++) t[e] = i.value, i = i.next;
    return t;
  }
  toArrayReverse() {
    let t = new Array(this.length);
    for (let e = 0, i = this.tail; i; e++) t[e] = i.value, i = i.prev;
    return t;
  }
  slice(t = 0, e = this.length) {
    e < 0 && (e += this.length), t < 0 && (t += this.length);
    let i = new s2();
    if (e < t || e < 0) return i;
    t < 0 && (t = 0), e > this.length && (e = this.length);
    let r = this.head, n = 0;
    for (n = 0; r && n < t; n++) r = r.next;
    for (; r && n < e; n++, r = r.next) i.push(r.value);
    return i;
  }
  sliceReverse(t = 0, e = this.length) {
    e < 0 && (e += this.length), t < 0 && (t += this.length);
    let i = new s2();
    if (e < t || e < 0) return i;
    t < 0 && (t = 0), e > this.length && (e = this.length);
    let r = this.length, n = this.tail;
    for (; n && r > e; r--) n = n.prev;
    for (; n && r > t; r--, n = n.prev) i.push(n.value);
    return i;
  }
  splice(t, e = 0, ...i) {
    t > this.length && (t = this.length - 1), t < 0 && (t = this.length + t);
    let r = this.head;
    for (let o = 0; r && o < t; o++) r = r.next;
    let n = [];
    for (let o = 0; r && o < e; o++) n.push(r.value), r = this.removeNode(r);
    r ? r !== this.tail && (r = r.prev) : r = this.tail;
    for (let o of i) r = Zn(this, r, o);
    return n;
  }
  reverse() {
    let t = this.head, e = this.tail;
    for (let i = t; i; i = i.prev) {
      let r = i.prev;
      i.prev = i.next, i.next = r;
    }
    return this.head = e, this.tail = t, this;
  }
};
function Zn(s3, t, e) {
  let i = t, r = t ? t.next : s3.head, n = new ue(e, i, r, s3);
  return n.next === void 0 && (s3.tail = n), n.prev === void 0 && (s3.head = n), s3.length++, n;
}
function Yn(s3, t) {
  s3.tail = new ue(t, s3.tail, void 0, s3), s3.head || (s3.head = s3.tail), s3.length++;
}
function Kn(s3, t) {
  s3.head = new ue(t, void 0, s3.head, s3), s3.tail || (s3.tail = s3.head), s3.length++;
}
var ue = class {
  list;
  next;
  prev;
  value;
  constructor(t, e, i, r) {
    this.list = r, this.value = t, e ? (e.next = this, this.prev = e) : this.prev = void 0, i ? (i.prev = this, this.next = i) : this.next = void 0;
  }
};
var pi = class {
  path;
  absolute;
  entry;
  stat;
  readdir;
  pending = false;
  pendingLink = false;
  ignore = false;
  piped = false;
  constructor(t, e) {
    this.path = t || "./", this.absolute = e;
  }
};
var nr = Buffer.alloc(1024);
var li = /* @__PURE__ */ Symbol("onStat");
var me = /* @__PURE__ */ Symbol("ended");
var W = /* @__PURE__ */ Symbol("queue");
var pe = /* @__PURE__ */ Symbol("pendingLinks");
var Et = /* @__PURE__ */ Symbol("current");
var Ft = /* @__PURE__ */ Symbol("process");
var Ee = /* @__PURE__ */ Symbol("processing");
var ai = /* @__PURE__ */ Symbol("processJob");
var G = /* @__PURE__ */ Symbol("jobs");
var ls = /* @__PURE__ */ Symbol("jobDone");
var ci = /* @__PURE__ */ Symbol("addFSEntry");
var or = /* @__PURE__ */ Symbol("addTarEntry");
var ds = /* @__PURE__ */ Symbol("stat");
var us = /* @__PURE__ */ Symbol("readdir");
var fi = /* @__PURE__ */ Symbol("onreaddir");
var di = /* @__PURE__ */ Symbol("pipe");
var hr = /* @__PURE__ */ Symbol("entry");
var cs = /* @__PURE__ */ Symbol("entryOpt");
var ui = /* @__PURE__ */ Symbol("writeEntryClass");
var lr = /* @__PURE__ */ Symbol("write");
var fs = /* @__PURE__ */ Symbol("ondrain");
var wt = class extends A {
  sync = false;
  opt;
  cwd;
  maxReadSize;
  preservePaths;
  strict;
  noPax;
  prefix;
  linkCache;
  statCache;
  file;
  portable;
  zip;
  readdirCache;
  noDirRecurse;
  follow;
  noMtime;
  mtime;
  filter;
  jobs;
  [ui];
  onWriteEntry;
  [W];
  [pe] = /* @__PURE__ */ new Map();
  [G] = 0;
  [Ee] = false;
  [me] = false;
  constructor(t = {}) {
    if (super(), this.opt = t, this.file = t.file || "", this.cwd = t.cwd || process.cwd(), this.maxReadSize = t.maxReadSize, this.preservePaths = !!t.preservePaths, this.strict = !!t.strict, this.noPax = !!t.noPax, this.prefix = f(t.prefix || ""), this.linkCache = t.linkCache || /* @__PURE__ */ new Map(), this.statCache = t.statCache || /* @__PURE__ */ new Map(), this.readdirCache = t.readdirCache || /* @__PURE__ */ new Map(), this.onWriteEntry = t.onWriteEntry, this[ui] = de, typeof t.onwarn == "function" && this.on("warn", t.onwarn), this.portable = !!t.portable, t.gzip || t.brotli || t.zstd) {
      if ((t.gzip ? 1 : 0) + (t.brotli ? 1 : 0) + (t.zstd ? 1 : 0) > 1) throw new TypeError("gzip, brotli, zstd are mutually exclusive");
      if (t.gzip && (typeof t.gzip != "object" && (t.gzip = {}), this.portable && (t.gzip.portable = true), this.zip = new ze(t.gzip)), t.brotli && (typeof t.brotli != "object" && (t.brotli = {}), this.zip = new We(t.brotli)), t.zstd && (typeof t.zstd != "object" && (t.zstd = {}), this.zip = new Ye(t.zstd)), !this.zip) throw new Error("impossible");
      let e = this.zip;
      e.on("data", (i) => super.write(i)), e.on("end", () => super.end()), e.on("drain", () => this[fs]()), this.on("resume", () => e.resume());
    } else this.on("drain", this[fs]);
    this.noDirRecurse = !!t.noDirRecurse, this.follow = !!t.follow, this.noMtime = !!t.noMtime, t.mtime && (this.mtime = t.mtime), this.filter = typeof t.filter == "function" ? t.filter : () => true, this[W] = new hi(), this[G] = 0, this.jobs = Number(t.jobs) || 4, this[Ee] = false, this[me] = false;
  }
  [lr](t) {
    return super.write(t);
  }
  add(t) {
    return this.write(t), this;
  }
  end(t, e, i) {
    return typeof t == "function" && (i = t, t = void 0), typeof e == "function" && (i = e, e = void 0), t && this.add(t), this[me] = true, this[Ft](), i && i(), this;
  }
  write(t) {
    if (this[me]) throw new Error("write after end");
    return typeof t == "string" ? this[ci](t) : this[or](t), this.flowing;
  }
  [or](t) {
    let e = f(ar.resolve(this.cwd, t.path));
    if (!this.filter(t.path, t)) t.resume();
    else {
      let i = new pi(t.path, e);
      i.entry = new oi(t, this[cs](i)), i.entry.on("end", () => this[ls](i)), this[G] += 1, this[W].push(i);
    }
    this[Ft]();
  }
  [ci](t) {
    let e = f(ar.resolve(this.cwd, t));
    this[W].push(new pi(t, e)), this[Ft]();
  }
  [ds](t) {
    t.pending = true, this[G] += 1;
    let e = this.follow ? "stat" : "lstat";
    mi[e](t.absolute, (i, r) => {
      t.pending = false, this[G] -= 1, i ? this.emit("error", i) : this[li](t, r);
    });
  }
  [li](t, e) {
    if (this.statCache.set(t.absolute, e), t.stat = e, !this.filter(t.path, e)) t.ignore = true;
    else if (e.isFile() && e.nlink > 1 && !this.linkCache.get(`${e.dev}:${e.ino}`) && !this.sync) if (t === this[Et]) this[ai](t);
    else {
      let i = `${e.dev}:${e.ino}`, r = this[pe].get(i);
      r ? r.push(t) : this[pe].set(i, [t]), t.pendingLink = true, t.pending = true;
    }
    this[Ft]();
  }
  [us](t) {
    t.pending = true, this[G] += 1, mi.readdir(t.absolute, (e, i) => {
      if (t.pending = false, this[G] -= 1, e) return this.emit("error", e);
      this[fi](t, i);
    });
  }
  [fi](t, e) {
    this.readdirCache.set(t.absolute, e), t.readdir = e, this[Ft]();
  }
  [Ft]() {
    if (!this[Ee]) {
      this[Ee] = true;
      for (let t = this[W].head; t && this[G] < this.jobs; t = t.next) if (this[ai](t.value), t.value.ignore) {
        let e = t.next;
        this[W].removeNode(t), t.next = e;
      }
      this[Ee] = false, this[me] && this[W].length === 0 && this[G] === 0 && (this.zip ? this.zip.end(nr) : (super.write(nr), super.end()));
    }
  }
  get [Et]() {
    return this[W] && this[W].head && this[W].head.value;
  }
  [ls](t) {
    this[W].shift(), this[G] -= 1;
    let { stat: e } = t;
    if (e && e.isFile() && e.nlink > 1) {
      let i = `${e.dev}:${e.ino}`, r = this[pe].get(i);
      if (r) {
        this[pe].delete(i);
        for (let n of r) n.pending = false, this[ai](n);
      }
    }
    this[Ft]();
  }
  [ai](t) {
    if (t.pending && t.pendingLink && t === this[Et] && (t.pending = false, t.pendingLink = false), !t.pending) {
      if (t.entry) {
        t === this[Et] && !t.piped && this[di](t);
        return;
      }
      if (!t.stat) {
        let e = this.statCache.get(t.absolute);
        e ? this[li](t, e) : this[ds](t);
      }
      if (t.stat && !t.ignore) {
        if (!this.noDirRecurse && t.stat.isDirectory() && !t.readdir) {
          let e = this.readdirCache.get(t.absolute);
          if (e ? this[fi](t, e) : this[us](t), !t.readdir) return;
        }
        if (t.entry = this[hr](t), !t.entry) {
          t.ignore = true;
          return;
        }
        t === this[Et] && !t.piped && this[di](t);
      }
    }
  }
  [cs](t) {
    return { onwarn: (e, i, r) => this.warn(e, i, r), noPax: this.noPax, cwd: this.cwd, absolute: t.absolute, preservePaths: this.preservePaths, maxReadSize: this.maxReadSize, strict: this.strict, portable: this.portable, linkCache: this.linkCache, statCache: this.statCache, noMtime: this.noMtime, mtime: this.mtime, prefix: this.prefix, onWriteEntry: this.onWriteEntry };
  }
  [hr](t) {
    this[G] += 1;
    try {
      return new this[ui](t.path, this[cs](t)).on("end", () => this[ls](t)).on("error", (i) => this.emit("error", i));
    } catch (e) {
      this.emit("error", e);
    }
  }
  [fs]() {
    this[Et] && this[Et].entry && this[Et].entry.resume();
  }
  [di](t) {
    t.piped = true, t.readdir && t.readdir.forEach((r) => {
      let n = t.path, o = n === "./" ? "" : n.replace(/\/*$/, "/");
      this[ci](o + r);
    });
    let e = t.entry, i = this.zip;
    if (!e) throw new Error("cannot pipe without source");
    i ? e.on("data", (r) => {
      i.write(r) || e.pause();
    }) : e.on("data", (r) => {
      super.write(r) || e.pause();
    });
  }
  pause() {
    return this.zip && this.zip.pause(), super.pause();
  }
  warn(t, e, i = {}) {
    Dt(this, t, e, i);
  }
};
var kt = class extends wt {
  sync = true;
  constructor(t) {
    super(t), this[ui] = ni;
  }
  pause() {
  }
  resume() {
  }
  [ds](t) {
    let e = this.follow ? "statSync" : "lstatSync";
    this[li](t, mi[e](t.absolute));
  }
  [us](t) {
    this[fi](t, mi.readdirSync(t.absolute));
  }
  [di](t) {
    let e = t.entry, i = this.zip;
    if (t.readdir && t.readdir.forEach((r) => {
      let n = t.path, o = n === "./" ? "" : n.replace(/\/*$/, "/");
      this[ci](o + r);
    }), !e) throw new Error("Cannot pipe without source");
    i ? e.on("data", (r) => {
      i.write(r);
    }) : e.on("data", (r) => {
      super[lr](r);
    });
  }
};
var Vn = (s3, t) => {
  let e = new kt(s3), i = new Wt(s3.file, { mode: s3.mode || 438 });
  e.pipe(i), fr(e, t);
};
var $n = (s3, t) => {
  let e = new wt(s3), i = new et(s3.file, { mode: s3.mode || 438 });
  e.pipe(i);
  let r = new Promise((n, o) => {
    i.on("error", o), i.on("close", n), e.on("error", o);
  });
  return dr(e, t).catch((n) => e.emit("error", n)), r;
};
var fr = (s3, t) => {
  t.forEach((e) => {
    e.charAt(0) === "@" ? Ct({ file: cr.resolve(s3.cwd, e.slice(1)), sync: true, noResume: true, onReadEntry: (i) => s3.add(i) }) : s3.add(e);
  }), s3.end();
};
var dr = async (s3, t) => {
  for (let e of t) e.charAt(0) === "@" ? await Ct({ file: cr.resolve(String(s3.cwd), e.slice(1)), noResume: true, onReadEntry: (i) => {
    s3.add(i);
  } }) : s3.add(e);
  s3.end();
};
var Xn = (s3, t) => {
  let e = new kt(s3);
  return fr(e, t), e;
};
var qn = (s3, t) => {
  let e = new wt(s3);
  return dr(e, t).catch((i) => e.emit("error", i)), e;
};
var Qn = K(Vn, $n, Xn, qn, (s3, t) => {
  if (!t?.length) throw new TypeError("no paths specified to add to archive");
});
var Jn = process.env.__FAKE_PLATFORM__ || process.platform;
var Er = Jn === "win32";
var { O_CREAT: wr, O_NOFOLLOW: ur, O_TRUNC: Sr, O_WRONLY: yr } = pr.constants;
var Rr = Number(process.env.__FAKE_FS_O_FILENAME__) || pr.constants.UV_FS_O_FILEMAP || 0;
var jn = Er && !!Rr;
var to = 512 * 1024;
var eo = Rr | Sr | wr | yr;
var mr = !Er && typeof ur == "number" ? ur | Sr | wr | yr : null;
var ms = mr !== null ? () => mr : jn ? (s3) => s3 < to ? eo : "w" : () => "w";
var ps = (s3, t, e) => {
  try {
    return wi.lchownSync(s3, t, e);
  } catch (i) {
    if (i?.code !== "ENOENT") throw i;
  }
};
var Ei = (s3, t, e, i) => {
  wi.lchown(s3, t, e, (r) => {
    i(r && r?.code !== "ENOENT" ? r : null);
  });
};
var io = (s3, t, e, i, r) => {
  if (t.isDirectory()) Es(we.resolve(s3, t.name), e, i, (n) => {
    if (n) return r(n);
    let o = we.resolve(s3, t.name);
    Ei(o, e, i, r);
  });
  else {
    let n = we.resolve(s3, t.name);
    Ei(n, e, i, r);
  }
};
var Es = (s3, t, e, i) => {
  wi.readdir(s3, { withFileTypes: true }, (r, n) => {
    if (r) {
      if (r.code === "ENOENT") return i();
      if (r.code !== "ENOTDIR" && r.code !== "ENOTSUP") return i(r);
    }
    if (r || !n.length) return Ei(s3, t, e, i);
    let o = n.length, h = null, a = (l) => {
      if (!h) {
        if (l) return i(h = l);
        if (--o === 0) return Ei(s3, t, e, i);
      }
    };
    for (let l of n) io(s3, l, t, e, a);
  });
};
var so = (s3, t, e, i) => {
  t.isDirectory() && ws(we.resolve(s3, t.name), e, i), ps(we.resolve(s3, t.name), e, i);
};
var ws = (s3, t, e) => {
  let i;
  try {
    i = wi.readdirSync(s3, { withFileTypes: true });
  } catch (r) {
    let n = r;
    if (n?.code === "ENOENT") return;
    if (n?.code === "ENOTDIR" || n?.code === "ENOTSUP") return ps(s3, t, e);
    throw n;
  }
  for (let r of i) so(s3, r, t, e);
  return ps(s3, t, e);
};
var Se = class extends Error {
  path;
  code;
  syscall = "chdir";
  constructor(t, e) {
    super(`${e}: Cannot cd into '${t}'`), this.path = t, this.code = e;
  }
  get name() {
    return "CwdError";
  }
};
var St = class extends Error {
  path;
  symlink;
  syscall = "symlink";
  code = "TAR_SYMLINK_ERROR";
  constructor(t, e) {
    super("TAR_SYMLINK_ERROR: Cannot extract through symbolic link"), this.symlink = t, this.path = e;
  }
  get name() {
    return "SymlinkError";
  }
};
var no = (s3, t) => {
  k.stat(s3, (e, i) => {
    (e || !i.isDirectory()) && (e = new Se(s3, e?.code || "ENOTDIR")), t(e);
  });
};
var gr = (s3, t, e) => {
  s3 = f(s3);
  let i = t.umask ?? 18, r = t.mode | 448, n = (r & i) !== 0, o = t.uid, h = t.gid, a = typeof o == "number" && typeof h == "number" && (o !== t.processUid || h !== t.processGid), l = t.preserve, c = t.unlink, d = f(t.cwd), y = (E, x) => {
    E ? e(E) : x && a ? Es(x, o, h, (Le) => y(Le)) : n ? k.chmod(s3, r, e) : e();
  };
  if (s3 === d) return no(s3, y);
  if (l) return ro.mkdir(s3, { mode: r, recursive: true }).then((E) => y(null, E ?? void 0), y);
  let D = f(Si.relative(d, s3)).split("/");
  Ss(d, D, r, c, d, void 0, y);
};
var Ss = (s3, t, e, i, r, n, o) => {
  if (t.length === 0) return o(null, n);
  let h = t.shift(), a = f(Si.resolve(s3 + "/" + h));
  k.mkdir(a, e, br(a, t, e, i, r, n, o));
};
var br = (s3, t, e, i, r, n, o) => (h) => {
  h ? k.lstat(s3, (a, l) => {
    if (a) a.path = a.path && f(a.path), o(a);
    else if (l.isDirectory()) Ss(s3, t, e, i, r, n, o);
    else if (i) k.unlink(s3, (c) => {
      if (c) return o(c);
      k.mkdir(s3, e, br(s3, t, e, i, r, n, o));
    });
    else {
      if (l.isSymbolicLink()) return o(new St(s3, s3 + "/" + t.join("/")));
      o(h);
    }
  }) : (n = n || s3, Ss(s3, t, e, i, r, n, o));
};
var oo = (s3) => {
  let t = false, e;
  try {
    t = k.statSync(s3).isDirectory();
  } catch (i) {
    e = i?.code;
  } finally {
    if (!t) throw new Se(s3, e ?? "ENOTDIR");
  }
};
var _r = (s3, t) => {
  s3 = f(s3);
  let e = t.umask ?? 18, i = t.mode | 448, r = (i & e) !== 0, n = t.uid, o = t.gid, h = typeof n == "number" && typeof o == "number" && (n !== t.processUid || o !== t.processGid), a = t.preserve, l = t.unlink, c = f(t.cwd), d = (E) => {
    E && h && ws(E, n, o), r && k.chmodSync(s3, i);
  };
  if (s3 === c) return oo(c), d();
  if (a) return d(k.mkdirSync(s3, { mode: i, recursive: true }) ?? void 0);
  let T = f(Si.relative(c, s3)).split("/"), D;
  for (let E = T.shift(), x = c; E && (x += "/" + E); E = T.shift()) {
    x = f(Si.resolve(x));
    try {
      k.mkdirSync(x, i), D = D || x;
    } catch {
      let Le = k.lstatSync(x);
      if (Le.isDirectory()) continue;
      if (l) {
        k.unlinkSync(x), k.mkdirSync(x, i), D = D || x;
        continue;
      } else if (Le.isSymbolicLink()) return new St(x, x + "/" + T.join("/"));
    }
  }
  return d(D);
};
var ys = /* @__PURE__ */ Object.create(null);
var Or = 1e4;
var Vt = /* @__PURE__ */ new Set();
var Tr = (s3) => {
  Vt.has(s3) ? Vt.delete(s3) : ys[s3] = s3.normalize("NFD").toLocaleLowerCase("en").toLocaleUpperCase("en"), Vt.add(s3);
  let t = ys[s3], e = Vt.size - Or;
  if (e > Or / 10) {
    for (let i of Vt) if (Vt.delete(i), delete ys[i], --e <= 0) break;
  }
  return t;
};
var ho = process.env.TESTING_TAR_FAKE_PLATFORM || process.platform;
var ao = ho === "win32";
var lo = (s3) => s3.split("/").slice(0, -1).reduce((e, i) => {
  let r = e.at(-1);
  return r !== void 0 && (i = xr(r, i)), e.push(i || "/"), e;
}, []);
var yi = class {
  #t = /* @__PURE__ */ new Map();
  #i = /* @__PURE__ */ new Map();
  #s = /* @__PURE__ */ new Set();
  reserve(t, e) {
    t = ao ? ["win32 parallelization disabled"] : t.map((r) => mt(xr(Tr(r))));
    let i = new Set(t.map((r) => lo(r)).reduce((r, n) => r.concat(n)));
    this.#i.set(e, { dirs: i, paths: t });
    for (let r of t) {
      let n = this.#t.get(r);
      n ? n.push(e) : this.#t.set(r, [e]);
    }
    for (let r of i) {
      let n = this.#t.get(r);
      if (!n) this.#t.set(r, [/* @__PURE__ */ new Set([e])]);
      else {
        let o = n.at(-1);
        o instanceof Set ? o.add(e) : n.push(/* @__PURE__ */ new Set([e]));
      }
    }
    return this.#r(e);
  }
  #n(t) {
    let e = this.#i.get(t);
    if (!e) throw new Error("function does not have any path reservations");
    return { paths: e.paths.map((i) => this.#t.get(i)), dirs: [...e.dirs].map((i) => this.#t.get(i)) };
  }
  check(t) {
    let { paths: e, dirs: i } = this.#n(t);
    return e.every((r) => r && r[0] === t) && i.every((r) => r && r[0] instanceof Set && r[0].has(t));
  }
  #r(t) {
    return this.#s.has(t) || !this.check(t) ? false : (this.#s.add(t), t(() => this.#e(t)), true);
  }
  #e(t) {
    if (!this.#s.has(t)) return false;
    let e = this.#i.get(t);
    if (!e) throw new Error("invalid reservation");
    let { paths: i, dirs: r } = e, n = /* @__PURE__ */ new Set();
    for (let o of i) {
      let h = this.#t.get(o);
      if (!h || h?.[0] !== t) continue;
      let a = h[1];
      if (!a) {
        this.#t.delete(o);
        continue;
      }
      if (h.shift(), typeof a == "function") n.add(a);
      else for (let l of a) n.add(l);
    }
    for (let o of r) {
      let h = this.#t.get(o), a = h?.[0];
      if (!(!h || !(a instanceof Set))) if (a.size === 1 && h.length === 1) {
        this.#t.delete(o);
        continue;
      } else if (a.size === 1) {
        h.shift();
        let l = h[0];
        typeof l == "function" && n.add(l);
      } else a.delete(t);
    }
    return this.#s.delete(t), n.forEach((o) => this.#r(o)), true;
  }
};
var Lr = () => process.umask();
var Dr = /* @__PURE__ */ Symbol("onEntry");
var _s = /* @__PURE__ */ Symbol("checkFs");
var Nr = /* @__PURE__ */ Symbol("checkFs2");
var Os = /* @__PURE__ */ Symbol("isReusable");
var P = /* @__PURE__ */ Symbol("makeFs");
var Ts = /* @__PURE__ */ Symbol("file");
var xs = /* @__PURE__ */ Symbol("directory");
var gi = /* @__PURE__ */ Symbol("link");
var Ar = /* @__PURE__ */ Symbol("symlink");
var Ir = /* @__PURE__ */ Symbol("hardlink");
var Re = /* @__PURE__ */ Symbol("ensureNoSymlink");
var Cr = /* @__PURE__ */ Symbol("unsupported");
var Fr = /* @__PURE__ */ Symbol("checkPath");
var Rs = /* @__PURE__ */ Symbol("stripAbsolutePath");
var yt = /* @__PURE__ */ Symbol("mkdir");
var O = /* @__PURE__ */ Symbol("onError");
var Ri = /* @__PURE__ */ Symbol("pending");
var kr = /* @__PURE__ */ Symbol("pend");
var $t = /* @__PURE__ */ Symbol("unpend");
var gs = /* @__PURE__ */ Symbol("ended");
var bs = /* @__PURE__ */ Symbol("maybeClose");
var Ls = /* @__PURE__ */ Symbol("skip");
var ge = /* @__PURE__ */ Symbol("doChown");
var be = /* @__PURE__ */ Symbol("uid");
var _e = /* @__PURE__ */ Symbol("gid");
var Oe = /* @__PURE__ */ Symbol("checkedCwd");
var fo = process.env.TESTING_TAR_FAKE_PLATFORM || process.platform;
var Te = fo === "win32";
var uo = 1024;
var mo = (s3, t) => {
  if (!Te) return u.unlink(s3, t);
  let e = s3 + ".DELETE." + Mr(16).toString("hex");
  u.rename(s3, e, (i) => {
    if (i) return t(i);
    u.unlink(e, t);
  });
};
var po = (s3) => {
  if (!Te) return u.unlinkSync(s3);
  let t = s3 + ".DELETE." + Mr(16).toString("hex");
  u.renameSync(s3, t), u.unlinkSync(t);
};
var vr = (s3, t, e) => s3 !== void 0 && s3 === s3 >>> 0 ? s3 : t !== void 0 && t === t >>> 0 ? t : e;
var Xt = class extends rt {
  [gs] = false;
  [Oe] = false;
  [Ri] = 0;
  reservations = new yi();
  transform;
  writable = true;
  readable = false;
  uid;
  gid;
  setOwner;
  preserveOwner;
  processGid;
  processUid;
  maxDepth;
  forceChown;
  win32;
  newer;
  keep;
  noMtime;
  preservePaths;
  unlink;
  cwd;
  strip;
  processUmask;
  umask;
  dmode;
  fmode;
  chmod;
  constructor(t = {}) {
    if (t.ondone = () => {
      this[gs] = true, this[bs]();
    }, super(t), this.transform = t.transform, this.chmod = !!t.chmod, typeof t.uid == "number" || typeof t.gid == "number") {
      if (typeof t.uid != "number" || typeof t.gid != "number") throw new TypeError("cannot set owner without number uid and gid");
      if (t.preserveOwner) throw new TypeError("cannot preserve owner in archive and also set owner explicitly");
      this.uid = t.uid, this.gid = t.gid, this.setOwner = true;
    } else this.uid = void 0, this.gid = void 0, this.setOwner = false;
    this.preserveOwner = t.preserveOwner === void 0 && typeof t.uid != "number" ? process.getuid?.() === 0 : !!t.preserveOwner, this.processUid = (this.preserveOwner || this.setOwner) && process.getuid ? process.getuid() : void 0, this.processGid = (this.preserveOwner || this.setOwner) && process.getgid ? process.getgid() : void 0, this.maxDepth = typeof t.maxDepth == "number" ? t.maxDepth : uo, this.forceChown = t.forceChown === true, this.win32 = !!t.win32 || Te, this.newer = !!t.newer, this.keep = !!t.keep, this.noMtime = !!t.noMtime, this.preservePaths = !!t.preservePaths, this.unlink = !!t.unlink, this.cwd = f(R.resolve(t.cwd || process.cwd())), this.strip = Number(t.strip) || 0, this.processUmask = this.chmod ? typeof t.processUmask == "number" ? t.processUmask : Lr() : 0, this.umask = typeof t.umask == "number" ? t.umask : this.processUmask, this.dmode = t.dmode || 511 & ~this.umask, this.fmode = t.fmode || 438 & ~this.umask, this.on("entry", (e) => this[Dr](e));
  }
  warn(t, e, i = {}) {
    return (t === "TAR_BAD_ARCHIVE" || t === "TAR_ABORT") && (i.recoverable = false), super.warn(t, e, i);
  }
  [bs]() {
    this[gs] && this[Ri] === 0 && (this.emit("prefinish"), this.emit("finish"), this.emit("end"));
  }
  [Rs](t, e) {
    let i = t[e], { type: r } = t;
    if (!i || this.preservePaths) return true;
    let [n, o] = ce(i), h = o.replaceAll(/\\/g, "/").split("/");
    if (h.includes("..") || Te && /^[a-z]:\.\.$/i.test(h[0] ?? "")) {
      if (e === "path" || r === "Link") return this.warn("TAR_ENTRY_ERROR", `${e} contains '..'`, { entry: t, [e]: i }), false;
      let a = R.posix.dirname(t.path), l = R.posix.normalize(R.posix.join(a, h.join("/")));
      if (l.startsWith("../") || l === "..") return this.warn("TAR_ENTRY_ERROR", `${e} escapes extraction directory`, { entry: t, [e]: i }), false;
    }
    return n && (t[e] = String(o), this.warn("TAR_ENTRY_INFO", `stripping ${n} from absolute ${e}`, { entry: t, [e]: i })), true;
  }
  [Fr](t) {
    let e = f(t.path), i = e.split("/");
    if (this.strip) {
      if (i.length < this.strip) return false;
      if (t.type === "Link") {
        let r = f(String(t.linkpath)).split("/");
        if (r.length >= this.strip) t.linkpath = r.slice(this.strip).join("/");
        else return false;
      }
      i.splice(0, this.strip), t.path = i.join("/");
    }
    if (isFinite(this.maxDepth) && i.length > this.maxDepth) return this.warn("TAR_ENTRY_ERROR", "path excessively deep", { entry: t, path: e, depth: i.length, maxDepth: this.maxDepth }), false;
    if (!this[Rs](t, "path") || !this[Rs](t, "linkpath")) return false;
    if (t.absolute = R.isAbsolute(t.path) ? f(R.resolve(t.path)) : f(R.resolve(this.cwd, t.path)), !this.preservePaths && typeof t.absolute == "string" && t.absolute.indexOf(this.cwd + "/") !== 0 && t.absolute !== this.cwd) return this.warn("TAR_ENTRY_ERROR", "path escaped extraction target", { entry: t, path: f(t.path), resolvedPath: t.absolute, cwd: this.cwd }), false;
    if (t.absolute === this.cwd && t.type !== "Directory" && t.type !== "GNUDumpDir") return false;
    if (this.win32) {
      let { root: r } = R.win32.parse(String(t.absolute));
      t.absolute = r + ts(String(t.absolute).slice(r.length));
      let { root: n } = R.win32.parse(t.path);
      t.path = n + ts(t.path.slice(n.length));
    }
    return true;
  }
  [Dr](t) {
    if (!this[Fr](t)) return t.resume();
    switch (co.equal(typeof t.absolute, "string"), t.type) {
      case "Directory":
      case "GNUDumpDir":
        t.mode && (t.mode = t.mode | 448);
      case "File":
      case "OldFile":
      case "ContiguousFile":
      case "Link":
      case "SymbolicLink":
        return this[_s](t);
      default:
        return this[Cr](t);
    }
  }
  [O](t, e) {
    t.name === "CwdError" ? this.emit("error", t) : (this.warn("TAR_ENTRY_ERROR", t, { entry: e }), this[$t](), e.resume());
  }
  [yt](t, e, i) {
    gr(f(t), { uid: this.uid, gid: this.gid, processUid: this.processUid, processGid: this.processGid, umask: this.processUmask, preserve: this.preservePaths, unlink: this.unlink, cwd: this.cwd, mode: e }, i);
  }
  [ge](t) {
    return this.forceChown || this.preserveOwner && (typeof t.uid == "number" && t.uid !== this.processUid || typeof t.gid == "number" && t.gid !== this.processGid) || typeof this.uid == "number" && this.uid !== this.processUid || typeof this.gid == "number" && this.gid !== this.processGid;
  }
  [be](t) {
    return vr(this.uid, t.uid, this.processUid);
  }
  [_e](t) {
    return vr(this.gid, t.gid, this.processGid);
  }
  [Ts](t, e) {
    let i = typeof t.mode == "number" ? t.mode & 4095 : this.fmode, r = new et(String(t.absolute), { flags: ms(t.size), mode: i, autoClose: false });
    r.on("error", (a) => {
      r.fd && u.close(r.fd, () => {
      }), r.write = () => true, this[O](a, t), e();
    });
    let n = 1, o = (a) => {
      if (a) {
        r.fd && u.close(r.fd, () => {
        }), this[O](a, t), e();
        return;
      }
      --n === 0 && r.fd !== void 0 && u.close(r.fd, (l) => {
        l ? this[O](l, t) : this[$t](), e();
      });
    };
    r.on("finish", () => {
      let a = String(t.absolute), l = r.fd;
      if (typeof l == "number" && t.mtime && !this.noMtime) {
        n++;
        let c = t.atime || /* @__PURE__ */ new Date(), d = t.mtime;
        u.futimes(l, c, d, (y) => y ? u.utimes(a, c, d, (T) => o(T && y)) : o());
      }
      if (typeof l == "number" && this[ge](t)) {
        n++;
        let c = this[be](t), d = this[_e](t);
        typeof c == "number" && typeof d == "number" && u.fchown(l, c, d, (y) => y ? u.chown(a, c, d, (T) => o(T && y)) : o());
      }
      o();
    });
    let h = this.transform && this.transform(t) || t;
    h !== t && (h.on("error", (a) => {
      this[O](a, t), e();
    }), t.pipe(h)), h.pipe(r);
  }
  [xs](t, e) {
    let i = typeof t.mode == "number" ? t.mode & 4095 : this.dmode;
    this[yt](String(t.absolute), i, (r) => {
      if (r) {
        this[O](r, t), e();
        return;
      }
      let n = 1, o = () => {
        --n === 0 && (e(), this[$t](), t.resume());
      };
      t.mtime && !this.noMtime && (n++, u.utimes(String(t.absolute), t.atime || /* @__PURE__ */ new Date(), t.mtime, o)), this[ge](t) && (n++, u.chown(String(t.absolute), Number(this[be](t)), Number(this[_e](t)), o)), o();
    });
  }
  [Cr](t) {
    t.unsupported = true, this.warn("TAR_ENTRY_UNSUPPORTED", `unsupported entry type: ${t.type}`, { entry: t }), t.resume();
  }
  [Ar](t, e) {
    let i = f(R.relative(this.cwd, R.resolve(R.dirname(String(t.absolute)), String(t.linkpath)))).split("/");
    this[Re](t, this.cwd, i, () => this[gi](t, String(t.linkpath), "symlink", e), (r) => {
      this[O](r, t), e();
    });
  }
  [Ir](t, e) {
    let i = f(R.resolve(this.cwd, String(t.linkpath))), r = f(String(t.linkpath)).split("/");
    this[Re](t, this.cwd, r, () => this[gi](t, i, "link", e), (n) => {
      this[O](n, t), e();
    });
  }
  [Re](t, e, i, r, n) {
    let o = i.shift();
    if (this.preservePaths || o === void 0) return r();
    let h = R.resolve(e, o);
    u.lstat(h, (a, l) => {
      if (a) return r();
      if (l?.isSymbolicLink()) return n(new St(h, R.resolve(h, i.join("/"))));
      this[Re](t, h, i, r, n);
    });
  }
  [kr]() {
    this[Ri]++;
  }
  [$t]() {
    this[Ri]--, this[bs]();
  }
  [Ls](t) {
    this[$t](), t.resume();
  }
  [Os](t, e) {
    return t.type === "File" && !this.unlink && e.isFile() && e.nlink <= 1 && !Te;
  }
  [_s](t) {
    this[kr]();
    let e = [t.path];
    t.linkpath && e.push(t.linkpath), this.reservations.reserve(e, (i) => this[Nr](t, i));
  }
  [Nr](t, e) {
    let i = (h) => {
      e(h);
    }, r = () => {
      this[yt](this.cwd, this.dmode, (h) => {
        if (h) {
          this[O](h, t), i();
          return;
        }
        this[Oe] = true, n();
      });
    }, n = () => {
      if (t.absolute !== this.cwd) {
        let h = f(R.dirname(String(t.absolute)));
        if (h !== this.cwd) return this[yt](h, this.dmode, (a) => {
          if (a) {
            this[O](a, t), i();
            return;
          }
          o();
        });
      }
      o();
    }, o = () => {
      u.lstat(String(t.absolute), (h, a) => {
        if (a && (this.keep || this.newer && a.mtime > (t.mtime ?? a.mtime))) {
          this[Ls](t), i();
          return;
        }
        if (h || this[Os](t, a)) return this[P](null, t, i);
        if (a.isDirectory()) {
          if (t.type === "Directory") {
            let l = this.chmod && t.mode && (a.mode & 4095) !== t.mode, c = (d) => this[P](d ?? null, t, i);
            return l ? u.chmod(String(t.absolute), Number(t.mode), c) : c();
          }
          if (t.absolute !== this.cwd) return u.rmdir(String(t.absolute), (l) => this[P](l ?? null, t, i));
        }
        if (t.absolute === this.cwd) return this[P](null, t, i);
        mo(String(t.absolute), (l) => this[P](l ?? null, t, i));
      });
    };
    this[Oe] ? n() : r();
  }
  [P](t, e, i) {
    if (t) {
      this[O](t, e), i();
      return;
    }
    switch (e.type) {
      case "File":
      case "OldFile":
      case "ContiguousFile":
        return this[Ts](e, i);
      case "Link":
        return this[Ir](e, i);
      case "SymbolicLink":
        return this[Ar](e, i);
      case "Directory":
      case "GNUDumpDir":
        return this[xs](e, i);
    }
  }
  [gi](t, e, i, r) {
    u[i](e, String(t.absolute), (n) => {
      n ? this[O](n, t) : (this[$t](), t.resume()), r();
    });
  }
};
var ye = (s3) => {
  try {
    return [null, s3()];
  } catch (t) {
    return [t, null];
  }
};
var xe = class extends Xt {
  sync = true;
  [P](t, e) {
    return super[P](t, e, () => {
    });
  }
  [_s](t) {
    if (!this[Oe]) {
      let n = this[yt](this.cwd, this.dmode);
      if (n) return this[O](n, t);
      this[Oe] = true;
    }
    if (t.absolute !== this.cwd) {
      let n = f(R.dirname(String(t.absolute)));
      if (n !== this.cwd) {
        let o = this[yt](n, this.dmode);
        if (o) return this[O](o, t);
      }
    }
    let [e, i] = ye(() => u.lstatSync(String(t.absolute)));
    if (i && (this.keep || this.newer && i.mtime > (t.mtime ?? i.mtime))) return this[Ls](t);
    if (e || this[Os](t, i)) return this[P](null, t);
    if (i.isDirectory()) {
      if (t.type === "Directory") {
        let o = this.chmod && t.mode && (i.mode & 4095) !== t.mode, [h] = o ? ye(() => {
          u.chmodSync(String(t.absolute), Number(t.mode));
        }) : [];
        return this[P](h, t);
      }
      let [n] = ye(() => u.rmdirSync(String(t.absolute)));
      this[P](n, t);
    }
    let [r] = t.absolute === this.cwd ? [] : ye(() => po(String(t.absolute)));
    this[P](r, t);
  }
  [Ts](t, e) {
    let i = typeof t.mode == "number" ? t.mode & 4095 : this.fmode, r = (h) => {
      let a;
      try {
        u.closeSync(n);
      } catch (l) {
        a = l;
      }
      (h || a) && this[O](h || a, t), e();
    }, n;
    try {
      n = u.openSync(String(t.absolute), ms(t.size), i);
    } catch (h) {
      return r(h);
    }
    let o = this.transform && this.transform(t) || t;
    o !== t && (o.on("error", (h) => this[O](h, t)), t.pipe(o)), o.on("data", (h) => {
      try {
        u.writeSync(n, h, 0, h.length);
      } catch (a) {
        r(a);
      }
    }), o.on("end", () => {
      let h = null;
      if (t.mtime && !this.noMtime) {
        let a = t.atime || /* @__PURE__ */ new Date(), l = t.mtime;
        try {
          u.futimesSync(n, a, l);
        } catch (c) {
          try {
            u.utimesSync(String(t.absolute), a, l);
          } catch {
            h = c;
          }
        }
      }
      if (this[ge](t)) {
        let a = this[be](t), l = this[_e](t);
        try {
          u.fchownSync(n, Number(a), Number(l));
        } catch (c) {
          try {
            u.chownSync(String(t.absolute), Number(a), Number(l));
          } catch {
            h = h || c;
          }
        }
      }
      r(h);
    });
  }
  [xs](t, e) {
    let i = typeof t.mode == "number" ? t.mode & 4095 : this.dmode, r = this[yt](String(t.absolute), i);
    if (r) {
      this[O](r, t), e();
      return;
    }
    if (t.mtime && !this.noMtime) try {
      u.utimesSync(String(t.absolute), t.atime || /* @__PURE__ */ new Date(), t.mtime);
    } catch {
    }
    if (this[ge](t)) try {
      u.chownSync(String(t.absolute), Number(this[be](t)), Number(this[_e](t)));
    } catch {
    }
    e(), t.resume();
  }
  [yt](t, e) {
    try {
      return _r(f(t), { uid: this.uid, gid: this.gid, processUid: this.processUid, processGid: this.processGid, umask: this.processUmask, preserve: this.preservePaths, unlink: this.unlink, cwd: this.cwd, mode: e });
    } catch (i) {
      return i;
    }
  }
  [Re](t, e, i, r, n) {
    if (this.preservePaths || i.length === 0) return r();
    let o = e;
    for (let h of i) {
      o = R.resolve(o, h);
      let [a, l] = ye(() => u.lstatSync(o));
      if (a) return r();
      if (l.isSymbolicLink()) return n(new St(o, R.resolve(e, i.join("/"))));
    }
    r();
  }
  [gi](t, e, i, r) {
    let n = `${i}Sync`;
    try {
      u[n](e, String(t.absolute)), r(), t.resume();
    } catch (o) {
      return this[O](o, t);
    }
  }
};
var Eo = (s3) => {
  let t = new xe(s3), e = s3.file, i = Br.statSync(e), r = s3.maxReadSize || 16 * 1024 * 1024;
  new Be(e, { readSize: r, size: i.size }).pipe(t);
};
var wo = (s3, t) => {
  let e = new Xt(s3), i = s3.maxReadSize || 16 * 1024 * 1024, r = s3.file;
  return new Promise((o, h) => {
    e.on("error", h), e.on("close", o), Br.stat(r, (a, l) => {
      if (a) h(a);
      else {
        let c = new _t(r, { readSize: i, size: l.size });
        c.on("error", h), c.pipe(e);
      }
    });
  });
};
var So = K(Eo, wo, (s3) => new xe(s3), (s3) => new Xt(s3), (s3, t) => {
  t?.length && Qi(s3, t);
});
var yo = (s3, t) => {
  let e = new kt(s3), i = true, r, n;
  try {
    try {
      r = v.openSync(s3.file, "r+");
    } catch (a) {
      if (a?.code === "ENOENT") r = v.openSync(s3.file, "w+");
      else throw a;
    }
    let o = v.fstatSync(r), h = Buffer.alloc(512);
    t: for (n = 0; n < o.size; n += 512) {
      for (let c = 0, d = 0; c < 512; c += d) {
        if (d = v.readSync(r, h, c, h.length - c, n + c), n === 0 && h[0] === 31 && h[1] === 139) throw new Error("cannot append to compressed archives");
        if (!d) break t;
      }
      let a = new F(h);
      if (!a.cksumValid) break;
      let l = 512 * Math.ceil((a.size || 0) / 512);
      if (n + l + 512 > o.size) break;
      n += l, s3.mtimeCache && a.mtime && s3.mtimeCache.set(String(a.path), a.mtime);
    }
    i = false, Ro(s3, e, n, r, t);
  } finally {
    if (i) try {
      v.closeSync(r);
    } catch {
    }
  }
};
var Ro = (s3, t, e, i, r) => {
  let n = new Wt(s3.file, { fd: i, start: e });
  t.pipe(n), bo(t, r);
};
var go = (s3, t) => {
  t = Array.from(t);
  let e = new wt(s3), i = (n, o, h) => {
    let a = (T, D) => {
      T ? v.close(n, (E) => h(T)) : h(null, D);
    }, l = 0;
    if (o === 0) return a(null, 0);
    let c = 0, d = Buffer.alloc(512), y = (T, D) => {
      if (T || D === void 0) return a(T);
      if (c += D, c < 512 && D) return v.read(n, d, c, d.length - c, l + c, y);
      if (l === 0 && d[0] === 31 && d[1] === 139) return a(new Error("cannot append to compressed archives"));
      if (c < 512) return a(null, l);
      let E = new F(d);
      if (!E.cksumValid) return a(null, l);
      let x = 512 * Math.ceil((E.size ?? 0) / 512);
      if (l + x + 512 > o || (l += x + 512, l >= o)) return a(null, l);
      s3.mtimeCache && E.mtime && s3.mtimeCache.set(String(E.path), E.mtime), c = 0, v.read(n, d, 0, 512, l, y);
    };
    v.read(n, d, 0, 512, l, y);
  };
  return new Promise((n, o) => {
    e.on("error", o);
    let h = "r+", a = (l, c) => {
      if (l && l.code === "ENOENT" && h === "r+") return h = "w+", v.open(s3.file, h, a);
      if (l || !c) return o(l);
      v.fstat(c, (d, y) => {
        if (d) return v.close(c, () => o(d));
        i(c, y.size, (T, D) => {
          if (T) return o(T);
          let E = new et(s3.file, { fd: c, start: D });
          e.pipe(E), E.on("error", o), E.on("close", n), _o(e, t);
        });
      });
    };
    v.open(s3.file, h, a);
  });
};
var bo = (s3, t) => {
  t.forEach((e) => {
    e.charAt(0) === "@" ? Ct({ file: Pr.resolve(s3.cwd, e.slice(1)), sync: true, noResume: true, onReadEntry: (i) => s3.add(i) }) : s3.add(e);
  }), s3.end();
};
var _o = async (s3, t) => {
  for (let e of t) e.charAt(0) === "@" ? await Ct({ file: Pr.resolve(String(s3.cwd), e.slice(1)), noResume: true, onReadEntry: (i) => s3.add(i) }) : s3.add(e);
  s3.end();
};
var vt = K(yo, go, () => {
  throw new TypeError("file is required");
}, () => {
  throw new TypeError("file is required");
}, (s3, t) => {
  if (!Bs(s3)) throw new TypeError("file is required");
  if (s3.gzip || s3.brotli || s3.zstd || s3.file.endsWith(".br") || s3.file.endsWith(".tbr")) throw new TypeError("cannot append to compressed archives");
  if (!t?.length) throw new TypeError("no paths specified to add/replace");
});
var Oo = K(vt.syncFile, vt.asyncFile, vt.syncNoFile, vt.asyncNoFile, (s3, t = []) => {
  vt.validate?.(s3, t), To(s3);
});
var To = (s3) => {
  let t = s3.filter;
  s3.mtimeCache || (s3.mtimeCache = /* @__PURE__ */ new Map()), s3.filter = t ? (e, i) => t(e, i) && !((s3.mtimeCache?.get(e) ?? i.mtime ?? 0) > (i.mtime ?? 0)) : (e, i) => !((s3.mtimeCache?.get(e) ?? i.mtime ?? 0) > (i.mtime ?? 0));
};

// packages/inspect-core/src/inspect.mjs
var InspectError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function parsePatchIds(text) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const m2 = /^\s*- id: ([A-Za-z0-9_.-]+)\s*$/.exec(line);
    if (m2 && !seen.has(m2[1])) {
      seen.add(m2[1]);
      ids.push(m2[1]);
    }
  }
  return ids;
}
async function inspectTarball(file, { maxEntryBytes = 4 * 1024 * 1024, maxEntries = 4096 } = {}) {
  let pkgText = null, patchText = null, entries = 0, fail = null;
  const badPath = /(^|\/)\.\.(\/|$)|^\/|\\/;
  await Ct({
    file,
    onReadEntry(entry) {
      if (fail) return;
      try {
        entries++;
        if (entries > maxEntries) {
          fail = new InspectError("TOO_MANY_ENTRIES", "tar has too many entries");
          return;
        }
        if (badPath.test(entry.path)) {
          fail = new InspectError("BAD_PATH", "unsafe tar path: " + entry.path);
          return;
        }
        const size = Number(entry.size || 0);
        if (size > maxEntryBytes) {
          fail = new InspectError("ENTRY_TOO_LARGE", "tar entry too large: " + entry.path);
          return;
        }
      } catch (e) {
        fail = e;
        return;
      }
      const wanted = entry.path === "package/package.json" || entry.path === "package/cordis.patch.yml";
      if (!wanted) return;
      const chunks = [];
      entry.on("data", (c) => {
        if (fail) return;
        chunks.push(c);
        if (chunks.reduce((n, b2) => n + b2.length, 0) > maxEntryBytes) fail = new InspectError("ENTRY_TOO_LARGE", "entry exceeded limit while reading");
      });
      entry.on("end", () => {
        if (fail) return;
        const text = Buffer.concat(chunks).toString("utf8");
        if (entry.path === "package/package.json") pkgText = text;
        else patchText = text;
      });
    }
  });
  if (fail) throw fail;
  if (!pkgText) throw new InspectError("BAD_MANIFEST", "package/package.json not found in tarball");
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch {
    throw new InspectError("BAD_MANIFEST", "package.json is invalid JSON");
  }
  return normalizeInspect(pkg, patchText);
}
function normalizeInspect(pkg, patchText) {
  const dsh = pkg.dsh || {};
  const platforms = Array.isArray(dsh.platforms) ? dsh.platforms : ["unknown"];
  const hasBundlePatch = typeof dsh.bundle?.patch === "string";
  const hasClient = dsh.client !== void 0;
  return {
    packageName: typeof pkg.name === "string" ? pkg.name : null,
    version: typeof pkg.version === "string" ? pkg.version : null,
    entryIds: patchText ? parsePatchIds(patchText) : [],
    platforms,
    hasBundlePatch,
    hasClient,
    patch: patchText
  };
}

// packages/inspect-core/src/http-inspector.mjs
import { mkdtempSync, writeFileSync as writeFileSync3, mkdirSync as mkdirSync5, existsSync as existsSync7, rmSync as rmSync3, createWriteStream } from "node:fs";
import { join as join7 } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes as randomBytes6, createHash as createHash2 } from "node:crypto";
var HttpArtifactInspector = class {
  constructor({ cacheDir = null, fetchImpl = fetch, maxBytes = 128 * 1024 * 1024 } = {}) {
    this.cacheDir = cacheDir;
    this.fetchImpl = fetchImpl;
    this.maxBytes = maxBytes;
    if (cacheDir) mkdirSync5(cacheDir, { recursive: true, mode: 448 });
  }
  async inspectArtifact(artifact) {
    if (!artifact?.tarball) throw new InspectError("BAD_ARTIFACT", "artifact.tarball is required for inspection");
    if (typeof artifact.integrity !== "string" || !artifact.integrity.startsWith("sha512-")) throw new InspectError("BAD_ARTIFACT", "artifact.integrity (sha512) is required");
    const res = await this.fetchImpl(artifact.tarball, { redirect: "error" });
    if (!res.ok) throw new InspectError("FETCH_FAILED", `tarball fetch failed: HTTP ${res.status}`);
    const dir = this.cacheDir || mkdtempSync(join7(tmpdir(), "cordis-artifact-"));
    const stagedPath = join7(dir, `artifact-${randomBytes6(6).toString("hex")}.tgz`);
    const hash = createHash2("sha512");
    let bytes = 0;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const out = createWriteStream(stagedPath, { mode: 384 });
      let streamError = null;
      out.on("error", (e) => {
        streamError = e;
      });
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > this.maxBytes) throw new InspectError("ARTIFACT_TOO_LARGE", `tarball exceeds ${this.maxBytes} bytes`);
          hash.update(value);
          if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        }
      } catch (e) {
        try {
          reader.cancel?.();
        } catch {
        }
        out.destroy();
        try {
          rmSync3(stagedPath, { force: true });
        } catch {
        }
        throw e;
      } finally {
        reader.releaseLock?.();
      }
      out.end();
      await new Promise((resolve, reject) => {
        out.once("finish", resolve);
        out.once("error", reject);
      });
      if (streamError) throw streamError;
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf.length;
      if (bytes > this.maxBytes) throw new InspectError("ARTIFACT_TOO_LARGE", `tarball exceeds ${this.maxBytes} bytes`);
      hash.update(buf);
      writeFileSync3(stagedPath, buf, { mode: 384 });
    }
    const actual = "sha512-" + hash.digest("base64");
    if (actual !== artifact.integrity) {
      try {
        rmSync3(stagedPath, { force: true });
      } catch {
      }
      throw new InspectError("INTEGRITY_MISMATCH", `tarball sha512 does not match catalog integrity`);
    }
    const inspected = await inspectTarball(stagedPath);
    return { ...inspected, stagedPath, bytes };
  }
  cleanup(path) {
    try {
      if (existsSync7(path)) rmSync3(path, { force: true });
    } catch {
    }
  }
};

// apps/web/src/index.js
var name = "cordis-mp";
var inject = ["webServer"];
function loadSnapshot() {
  try {
    return JSON.parse(readFileSync8(new URL("../data/registry-snapshot.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}
function loadSelfPackageName() {
  try {
    const manifest = JSON.parse(readFileSync8(new URL("../package.json", import.meta.url), "utf8"));
    return typeof manifest.name === "string" && manifest.name.trim().length > 0 ? manifest.name.trim() : null;
  } catch {
    return null;
  }
}
function loadSelfEntryIds() {
  try {
    const patch = readFileSync8(new URL("../cordis.patch.yml", import.meta.url), "utf8");
    return [...new Set([...patch.matchAll(/^\s*-\s+id:\s*([A-Za-z0-9_.-]+)\s*$/gm)].map((match) => match[1]))];
  } catch {
    return [];
  }
}
function createRuntime({ dir = null, baseUrl = null, dshHome = null, profile = null } = {}) {
  const resolvedDir = dir || (() => {
    if (process.env.CORDIS_MP_PROFILE_DIR) return process.env.CORDIS_MP_PROFILE_DIR;
    const home = dshHome || process.env.DSH_HOME || join8(process.env.HOME || ".", ".dsh");
    return join8(home, "profiles", profile || process.env.CORDIS_MP_PROFILE || "web");
  })();
  const base = (baseUrl || process.env.CORDIS_RUN_API || "https://cordis.run/api/v1").replace(/\/+$/, "");
  const catalog = new CatalogClient({ baseUrl: base, snapshot: loadSnapshot() });
  const runner = new DshRunner({ dshHome: dshHome ?? process.env.DSH_HOME, profile: profile ?? process.env.CORDIS_MP_PROFILE ?? "web" });
  const packageManager = new DshPackageManagerPort({ runner, profileDir: resolvedDir });
  const journalRoot = join8(resolvedDir, ".cordis-mp");
  const profileLock = new FileLock(journalRoot);
  const journal = new Journal({ journalRoot, profileRoot: resolvedDir, lock: profileLock });
  const activation = new DshActivationPort({ patchPath: join8(resolvedDir, "cordis.patch.yml") });
  const inspect = new HttpArtifactInspector({ cacheDir: join8(resolvedDir, ".cordis-mp", "artifacts") });
  const installService = new InstallService({ catalog, journal, packageManager, activation, inspect, pendingPath: join8(resolvedDir, ".cordis-mp"), lock: profileLock, selfPackageName: loadSelfPackageName(), selfEntryIds: loadSelfEntryIds() });
  return { dir: resolvedDir, base, catalog, journal, profileLock, packageManager, activation, inspect, installService };
}
function apply(ctx) {
  ctx.inject(["webServer"], (hostCtx) => {
    const webServer = hostCtx.webServer;
    const { installService, catalog, journal, profileLock } = createRuntime();
    const guard = new MutationGuard();
    hostCtx.effect(async () => {
      await withFileLock(profileLock, "recovery", async () => {
        await journal.recover();
        await installService.recoverPending();
      });
      const a = mountCatalogRoutes(webServer, catalog);
      const b2 = mountMutationRoutes(webServer, { installService, platform: "web", guard });
      const c = mountSessionRoute(webServer, guard);
      return () => {
        a();
        b2();
        c();
      };
    }, "cordis-mp: recover + http routes");
  });
}
export {
  apply,
  createRuntime,
  inject,
  name
};
