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

## 4. 预设下载（已存在，需调整重定向策略）
当前实际：
```
GET https://cordis.run/api/presets/code/download
302 -> https://statics.xlayers.dev/presets/official/code.dshpreset
```
建议二选一：
- A（推荐）：cordis.run 直出或反代，最终响应 host 仍为 cordis.run；
- B：客户端改为“初始 host 白名单 + 逐跳重定向白名单”：
  `https://cordis.run` → `https://statics.xlayers.dev`，最多 3 跳、仅 https、
  禁跨 host 传递凭据、下载后仍需大小/zip 校验。

## 5. 联调验收清单
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
