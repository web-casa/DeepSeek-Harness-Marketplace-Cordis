# cordis-mp 开发总览（交接文档）

## 项目目标
为 DeepSeek Harness Web 版构建 cordis.run 插件市场 harness，并让未来 Desktop
复用同一契约与核心。

## 仓库位置与结构
- 当前仓库：`/home/ivmm/daohang/toolso-ai-open/cordis-mp`
- monorepo：pnpm workspaces（packages/*, apps/*）
- packages:
  - journal-core：持久化事务 / 恢复 / 锁 / resolution（10/10 gate，POSIX FULL 冻结）
  - catalog-core：cordis.run API 客户端、schema 归一化、snapshot
  - install-core：安装事务 + pending activation
  - web-harness：本地 HTTP 路由 + mutation guard
  - dsh-runner：真实 dsh CLI 适配 + patch 激活端口
  - inspect-core：tarball/entryIds/integrity 检查
- apps/web：DSH 插件壳 + 客户端市场 UI（搜索、详情、分页、安装/显式启用）

## 时间线
1. 调研 dsh-market / dsh-plugin-hub / DSH 机制。
2. M0 spikes S1-S6：fixture、dsh CLI、激活时序、session token、journal
   crash、desktop-shaped adapter。
3. JOURNAL-SPEC v1-v7，codex 多轮评审。
4. M2a journal-core 实现，S5a/S5b/S6-S9 关闭 10/10 gate（POSIX FULL）。
5. 上层开发：catalog-core → web-harness → dsh-runner → install-core →
   apps/web host/client。
6. M2b 安装门禁：inspect → pre-disable → install → verify → pending →
   activate，真实 E2E install/activate/restart 通过。
7. codex review（mulerun）发现的阻断项已修复。
8. 父仓库 cordis.run 后端补齐 v4 API：严格 registry 工件快照、列表/详情 ETag +
   cursor + JSON error、以及校验后同域 preset ZIP 直出；已完成生产 schema、部署和无重定向
   preset 验证，目录数据仍受严格 registry 工件元数据门禁约束。

## 关键决策
- 在线安装只支持 npm source；GitHub-only 只浏览/侧载。
- 目录契约嵌套 `source`，description `{zh,en}`，分页 `count + page` 对象。
- 安全：loopback + Origin/Host + mutation token（anti-CSRF），默认禁止构建脚本。
- profile 文本变更另有 `FileLock`：Web runtime 的 startup recovery、install、uninstall、
  activate 以及 repair CLI 都必须持有同一把 lock；`InstallService` 拒绝缺失或与 Journal
  不同的 lock，`LOCK_BUSY` / fencing 丢失 fail-closed。它与 HTTP mutation guard 职责不同、
  共同防止未授权请求或并发/失租写入。
- 安装后默认 disabled，用户显式 activate。
- journal 文件事务只保证 profile 文本文件一致性。
- Windows 为 BEST_EFFORT，POSIX FULL。

## 当前状态
- 161 tests / 161 pass。
- 真实 DSH E2E PASS：install → patch disable → activate → restart → dsh-market
  路由 200。
- `verifyInstalled` 已复核 `node_modules` manifest 的 name/version，及
  `pnpm-lock.yaml` 中该精确 artifact 的 `resolution.integrity`；任何缺失、
  不匹配、非普通文件或超限 lockfile 均 fail-closed 并触发既有回滚路径。
- Desktop 的同一 integrity 复核现也识别 pnpm 9 对带 peer dependency 的
  `name@version(peer@version)` key，但仍要求精确 `name@version` 前缀和受限的
  peer context；不会把相邻版本或任意前缀误判为已审阅 artifact。
- 父仓库 `/home/ivmm/daohang/toolso-ai-open` 已实现并部署 cordis.run v4 后端：只有完整、精确
  npm registry 工件快照才会进入安装目录；列表/详情支持 ETag/304、cursor、JSON 404，
  `quarantined` 条目以 `blocked:true` 保留 kill switch；preset 下载在 SHA-256/大小复核后
  同域 `200 application/zip` 直出，不再 302。后续安全 review 已补上 R2 流式上限、审批状态
  的计数事务复核、异常 JSON/503 回退和分类成员变更 revision；父仓库 357/357 单测、生产构建
  、Docker `next start` 健康探针和临时 PostgreSQL 的真实 Next 契约探针均已通过。
- 生产验收（2026-08-19）：`https://cordis.run/api/presets/code/download` 直接返回
  `200 application/zip`（无 `Location`）；`/api/v1/plugins` 返回 v1 契约 JSON（含
  `schemaVersion`、`count`、`page`、`items`）。当前严格目录 `count=0`，不是客户端或 DTO
  问题：生产同步到的候选 npm metadata 缺少 API 发布所需的明确 DSH engine/platform + 完整
  registry artifact 证据，因而被 fail-closed 排除。真实生产 API DSH E2E 尚不能声明通过。
- fixture 已对齐 cursor + `count/page`、`page/per_page` 兼容、ETag/304、JSON
  error、canonical screenshot；`scripts/cordis-run-contract-probe.mjs` 可在
  部署后做无 mutation 的目标验收，DSH E2E 也可显式通过 `CORDIS_RUN_API` 切换。
- Desktop 的 `feat/cordis-v4-desktop` 已在独立源码树复验：嵌套 DTO、`platform=desktop`、cursor、
  ETag/304、JSON 404、严格 pending/explicit activate 与 preset 200 直出适配仍在。新增
  `pnpm verify:cordis-market` 只读生产 smoke，实际通过直接 JSON、ETag/304、JSON 404；
  `pnpm verify:cordis-preset` 也通过同域 `200 application/zip`；Rust nextest 为 sidecar 35/35、
  Tauri 97/97，覆盖率门槛也已复核。当前 `count=0`，因此没有把
  这次结构联调表述为 Desktop 安装 E2E；Microsoft Store allowlist 也保持不变。
- Web 市场已提供详情弹窗、仅渲染 `https://cdn.cordis.run` 截图、cursor 历史分页、
  Web/Desktop 平台徽章及可展开的错误诊断（code/HTTP/request ID/retry）。安装和启用
  仍只经既有 guard-backed controller/API；页面不新增 mutation 通道。
- 已接入 `.github/workflows/ci.yml`：两个无凭据 Ubuntu job 分别执行 test/build/host
  smoke 与真实 DSH smoke/E2E；Node 24.18.0、pnpm 11.10.0、DSH 0.1.0-rc.7 和
  Actions 提交均固定。CI 的 DSH integration 只使用临时 profile 与本地 fixture，
  不把生产 API 当作可用依赖。
- 父仓库的 PostgreSQL live-server smoke 现 seed 两个严格 registry fixture，以和 Docker 一致的
  `next start` 生产构建启动；v4 列表 cursor、ETag/304、web/desktop 筛选、
  `quarantined` kill switch、详情、JSON 404 与静态 chunk 都是硬门禁。启动未就绪立即失败；既有
  站点 UX smoke 也在显式 IPv4 loopback 上成为 Host/locale/canonical/security 的硬门禁。它同样
  不访问生产 API/R2。
- `windows-best-effort` CI job 已配置为 Windows 原生目录 fsync 降级、锁 fencing、journal rollback
  和 Web build smoke；首个 GitHub Actions green run 前仍不宣称 Windows 已实证，更不改变其
  BEST_EFFORT 分级。
- pnpm 仅显式批准 `esbuild` 的构建脚本（`allowBuilds.esbuild: true`）；这是 Web
  打包所需的已声明 devDependency，其余依赖仍不获隐式构建脚本授权。
- 发布候选已补齐：`@cordis-mp/web` 的私有源码 manifest 明确声明
  `dsh.platforms: [web, desktop]` 与 `dsh.engines.dsh: >=0.1.0-rc.7 <0.2.0`；
  `pack-smoke` 生成无 workspace 依赖、可公开打包的独立候选，且保留 `dist/`，从而修复 host
  的 `../data/registry-snapshot.json` 离线 fallback 路径。新增测试会实际解包、强制网络失败并
  验证该 snapshot fallback；真实 DSH E2E 仍通过。`pnpm run pack:check` 现同时对各 workspace
  和该临时候选执行无脚本 `npm pack --dry-run`。源码包依旧 `private: true`；没有 npm 发布、tag
  或可见性变更，也不会把本地 pack integrity 当作 registry integrity。

## 未完成事项
1. Owner 决定 `@cordis-mp/web` 的 npm scope/access、适用 license、maintainers、provenance 和
   release version，并以其 npm 身份发布经审阅的候选。父仓库的 Apache-2.0 文件不能在未确认
   授权范围时自动套用到这个嵌套独立工作树。
2. 发布后，通过父仓库 `pnpm plugins:sync -- --pkg=@cordis-mp/web --no-assets` 取得 npm 的精确
   version/sha512/tarball，再确认生产 `count>0`、运行目标 API probe 和真实生产 API DSH E2E。
   不得从包名、README 或 `bundle.patch` 反推这些字段。
3. 以已审核公开 slug 运行 Desktop 的 `CORDIS_MARKET_PROBE_SLUG=<slug> pnpm verify:cordis-market`；
   再执行用户确认的 Desktop 安装→pending→显式 Activate→重启 E2E。若需 Microsoft Store
   发布，还要走独立审查后更新 `store-curated-plugins.json`，不得提前放宽 allowlist。
4. 触发并记录 `windows-best-effort` 的首个 GitHub Actions green run；Windows 保持 BEST_EFFORT。
5. 8/24 后 codex 对 fc668e4..HEAD 补独立评审。

## 关键命令
- 全部测试：`pnpm -r test`（当前 161 tests）
- 冒烟：`node scripts/dsh-smoke.mjs`
- 真实 E2E：`node scripts/dsh-e2e-install.mjs`
- 目标 API 无 mutation 验收：`CORDIS_RUN_API=https://<target>/api/v1 node scripts/cordis-run-contract-probe.mjs`
- 父仓库 v4 上线 runbook：`../docs/CORDIS-API-V4.md`
- 构建：`node apps/web/scripts/build.mjs`
- 打包 smoke tarball：`node apps/web/scripts/pack-smoke.mjs`
- npm pack 预检：`pnpm run pack:check`
- Desktop 生产只读 smoke（在 Desktop 仓库）：`pnpm verify:cordis-preset && pnpm verify:cordis-market`
- CI 工作流静态校验：`actionlint .github/workflows/ci.yml`

## 关键文档
- PLAN-*.md / M2A-*.md / JOURNAL-SPEC.md / REVIEWS.md / SELF-REVIEW-*.md
- docs/cordis-run-api-contract.md
- RELEASE.md
- FAILPOINT-COVERAGE.md
- codex-review-latest.md
