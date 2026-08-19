# cordis.run Market API 契约 v4（Web / Desktop 共用）

> 状态（2026-08-20）：后端已部署到 `https://cordis.run`。`GET /api/v1/plugins`、
> `GET /api/v1/plugins/{slug}` 已验证直接 JSON、ETag/304 与 JSON 404；preset 下载也已验证
> 同域直出 `200 application/zip`、无 `Location`。`@webcasa/web@0.1.0` 已通过 strict registry
> preflight 并同步，生产 probe 返回 `count=1`。fixture 仍用于独立测试；不得把 fixture E2E、
> 结构 probe 或市场宿主的 self-refusal 表述为独立插件的生产安装 E2E。

## 0. 基础约定
- Base：`https://cordis.run/api/v1`
- 列表、详情与 JSON error 响应使用 `Content-Type: application/json; charset=utf-8`；
  `304` 无响应体，§4 的 preset 下载是 `application/zip` 例外。
- 支持 `ETag` / `If-None-Match`（304）
- 错误统一：
  ```json
  { "error": { "code": "NOT_FOUND", "message": "...", "retryAfter": 0, "requestId": "..." } }
  ```
- 分页用不透明 cursor；`limit` 默认 50，上限 100。

## 1. 列表 / 搜索
```
GET /plugins?q=&category=&platform=&sort=stars|added&order=desc|asc&cursor=&limit=
```
- `platform`：`web` / `desktop` / 缺省（返回全部，由客户端过滤）。
- 分页以 `page` 对象返回：`{ cursor, hasMore, limit }`；顶部 `count` 为过滤后总数。
- 过渡兼容：服务端/夹具**接受** `page` / `per_page` 查询参数（等价于
  `cursor` / `limit`），但响应保持 `count + page` 对象，不再平铺 `total/page/per_page`。
- 响应 200：
```json
{
  "schemaVersion": 1,
  "catalogRevision": "2026-08-18T00:00:00Z-8f3a",
  "updated": "2026-08-18T00:00:00Z",
  "page": { "cursor": "opaque", "hasMore": false, "limit": 50 },
  "categories": { "agent": { "zh": "Agent", "en": "Agent" } },
  "items": [
    {
      "slug": "dsh-agent-teams",
      "name": "@nanmicoder/dsh-agent-teams",
      "entryRevision": "2026-08-18T00:00:00Z-a1b2",
      "description": { "zh": "...", "en": "..." },
      "category": "agent",
      "homepage": "https://github.com/NanmiCoder/dsh-agent-teams",
      "source": {
        "type": "npm",
        "packageName": "@nanmicoder/dsh-agent-teams",
        "version": "1.2.3",
        "integrity": "sha512-...",
        "registry": "https://registry.npmjs.org",
        "tarball": "https://registry.npmjs.org/@nanmicoder/dsh-agent-teams/-/dsh-agent-teams-1.2.3.tgz"
      },
      "platforms": ["web", "desktop"],
      "engines": { "dsh": ">=0.1.0-rc.6 <0.2.0" },
      "stars": 0,
      "added": "2026-08-18",
      "deprecated": false,
      "replacementSlug": null,
      "blocked": false,
      "installHint": "dsh plugin --profile web add @nanmicoder/dsh-agent-teams",
      "updatedAt": "2026-08-18T00:00:00Z"
    }
  ]
}
```

### 字段规则
- `platforms` 必填；`["unknown"]` 只浏览不安装。
- `source` 是唯一的安装证据，必须完整嵌套提供；兼容显示的顶层 `npm` / `version` 等旧字段
  不能授权安装。`source.type` v1 只接受 `npm`；GitHub-only 条目浏览/侧载。
- `source.integrity` 必填且必须等于 registry `dist.integrity`（安装后复核
  lockfile integrity）。
- `source.registry` 必须显式为批准的 HTTPS registry；`source.tarball` 必须与其 protocol、host
  与 port 一致。
- `engines.dsh` 必填。
- 安装和显式 Activate 都必须重新获取详情，并要求用户确认的非空 `entryRevision` 与当前值一致。
  list、snapshot、stale cache 或异常的 fresh `304` 不能授权 mutation。
- `blocked=true` 为 kill switch：不可安装、不可更新、不可重新启用。

## 2. 详情
```
GET /plugins/{slug}
```
- 200 返回列表条目全部字段 +：
```json
{
  "screenshots": ["https://cdn.cordis.run/screenshots/<slug>/1.webp"],
  "versions": [
    {
      "version": "1.2.3",
      "source": { "...": "同上" },
      "platforms": ["web", "desktop"],
      "engines": { "dsh": "..." },
      "blocked": false,
      "deprecated": false,
      "publishedAt": "2026-08-18T00:00:00Z"
    }
  ]
}
```
- 截图只允许 `https://cdn.cordis.run/`；前端使用 `referrerpolicy="no-referrer"`。

## 3. 更新检查
```
GET /plugins/{slug}?fields=versions,blocked,entryRevision
```
或客户端直接复用列表；版本级 `blocked` 必须可查。

## 4. 预设下载（最终决定：方案 A）
最终决策：**cordis.run 直出/反代 preset，禁止 302 到 CDN/对象存储**。
桌面端 deep-link 当前实现：
- 仅接受 `https://cordis.run/api/presets/<slug>/download`；
- `reqwest::redirect::Policy::none()`，不跟随重定向。
因此 cordis.run 后端必须让该 URL 直接返回 `200 application/zip`，最终响应
host 仍为 `cordis.run`。生产已在 2026-08-19 验证这一点（无重定向）。

## 5. 桌面端 DTO 要求（已实现并保持为契约）
Desktop 的 `feat/cordis-v4-desktop` 已采用以下 wire shape；这些规则仍是安装边界，不能为
兼容旧条目放宽：
- 解析嵌套 `source: { type, packageName, version, integrity, registry, tarball }`
  （同时可保留 `npm/version` 作为 deprecated 兼容字段，但不作为安装依据）；
- `description: { zh, en }` 或 `Option<LocalizedText>`；
- 搜索响应解析 `count: u32` + `page: { cursor, hasMore, limit }`；
- 404 建议解析 `{ error: { code, message } }` 并透出 `message`；
- 已完成的 Desktop 客户端发送 `cursor` / `limit`；服务端与 fixture 保留
  `page` / `per_page` 仅供旧客户端短期兼容，不能成为新的安装客户端实现依据。

## 6. 联调验收清单
- [x] 生产 `platform=desktop&limit=1` 返回直接 JSON、ETag/304、`count + page`；Desktop
  `pnpm verify:cordis-market` 已实际探测。
- [x] 生产缺失 slug 返回 JSON `NOT_FOUND`，不是 Next.js HTML。
- [x] 生产 preset download 返回无重定向 `200 application/zip`；Desktop
  `pnpm verify:cordis-preset` 已实际探测。
- [x] `@webcasa/web@0.1.0` 已完成 strict registry preflight 与 `dev-assistant` 同步；生产 probe
  已验证 `platform=web` / `platform=desktop`、无 platform、ETag/304、详情与 JSON 404，且 `count=1`。
  exact version/SHA-512/tarball 均来自 registry，不从 manifest 推断。
- [ ] 对独立公开 slug 做生产 DSH install → pending → explicit Activate → restart E2E。市场宿主自身
  不能作为目标：`0.1.1` 候选会以 `SELF_INSTALL_FORBIDDEN` 拒绝自身包名，并以
  `HOST_ENTRY_CONFLICT` 拒绝包含 `cordis-mp` entry id 的外部 bundle；它尚未发布。
- [ ] 以公开 slug 运行 `CORDIS_MARKET_PROBE_SLUG=<slug> pnpm verify:cordis-market`，再做经过
  用户确认的 Desktop install → pending → explicit Activate → restart E2E。

## 7. 联调前本地替代
```bash
cd spikes/S1
node fixture-server.mjs   # 打印本地端口
CORDIS_RUN_API=http://127.0.0.1:<port>/api/v1 <客户端>
```
当前 fixture 含 `dsh-market`（web+desktop）与 `desktop-only` 两条目，可直接
驱动 Web/Desktop 市场 UI 和安装决策逻辑。
