# cordis.run Market API 契约 v4（Web / Desktop 共用）

> 状态：待 cordis.run 后端实现。
> 当前生产状态：`GET /api/v1/plugins` 返回 Next.js 404；插件数据嵌在页面 RSC
> HTML 中，没有公开 JSON API。未实现前，两端开发请使用本地 fixture：
> `spikes/S1/fixture-server.mjs`，并通过 `CORDIS_RUN_API` 覆盖 base URL。

## 0. 基础约定
- Base：`https://cordis.run/api/v1`
- 所有响应 `Content-Type: application/json; charset=utf-8`
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
- `source.type` v1 只接受 `npm`；GitHub-only 条目浏览/侧载。
- `source.integrity` 必填且必须等于 registry `dist.integrity`（安装后复核
  lockfile integrity）。
- `source.tarball` 必须与 `source.registry` 同 host。
- `engines.dsh` 必填。
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
host 仍为 `cordis.run`。当前 `302 -> statics.xlayers.dev` 行为必须改造。

## 5. 桌面端 DTO 迁移要求（已确认）
桌面当前为平铺 `npm/version`、`description: String`、`page/total/per_page: u32`。
按本轮结论，桌面需改为：
- 解析嵌套 `source: { type, packageName, version, integrity, registry, tarball }`
  （同时可保留 `npm/version` 作为 deprecated 兼容字段，但不作为安装依据）；
- `description: { zh, en }` 或 `Option<LocalizedText>`；
- 搜索响应解析 `count: u32` + `page: { cursor, hasMore, limit }`；
- 404 建议解析 `{ error: { code, message } }` 并透出 `message`；
- 桌面仍发送 `page` / `per_page` 查询参数可以，fixture 已兼容。

## 6. 联调验收清单
- [ ] 列表：`platform=web` / `platform=desktop` / 无 platform 三种返回正确
- [ ] 搜索 q、分类、排序、cursor 分页
- [ ] 详情 slug 404 时返回 JSON 错误，不是 Next.js HTML
- [ ] npm 条目带精确 version + integrity + tarball
- [ ] blocked 条目在列表中可展示但 installable=false
- [ ] 304 缓存链路可用
- [ ] 生产域名确认；如需测试域名 / Host / Token 请一并提供

## 6. 联调前本地替代
```bash
cd spikes/S1
node fixture-server.mjs   # 打印本地端口
CORDIS_RUN_API=http://127.0.0.1:<port>/api/v1 <客户端>
```
当前 fixture 含 `dsh-market`（web+desktop）与 `desktop-only` 两条目，可直接
驱动 Web/Desktop 市场 UI 和安装决策逻辑。
