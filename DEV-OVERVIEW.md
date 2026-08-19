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
   cursor + JSON error、以及校验后同域 preset ZIP 直出；生产部署仍待授权操作员执行。

## 关键决策
- 在线安装只支持 npm source；GitHub-only 只浏览/侧载。
- 目录契约嵌套 `source`，description `{zh,en}`，分页 `count + page` 对象。
- 安全：loopback + Origin/Host + mutation token（anti-CSRF），默认禁止构建脚本。
- 安装后默认 disabled，用户显式 activate。
- journal 文件事务只保证 profile 文本文件一致性。
- Windows 为 BEST_EFFORT，POSIX FULL。

## 当前状态
- 151 tests / 151 pass。
- 真实 DSH E2E PASS：install → patch disable → activate → restart → dsh-market
  路由 200。
- `verifyInstalled` 已复核 `node_modules` manifest 的 name/version，及
  `pnpm-lock.yaml` 中该精确 artifact 的 `resolution.integrity`；任何缺失、
  不匹配、非普通文件或超限 lockfile 均 fail-closed 并触发既有回滚路径。
- 父仓库 `/home/ivmm/daohang/toolso-ai-open` 已实现 cordis.run v4 后端：只有完整、精确
  npm registry 工件快照才会进入安装目录；列表/详情支持 ETag/304、cursor、JSON 404，
  `quarantined` 条目以 `blocked:true` 保留 kill switch；preset 下载在 SHA-256/大小复核后
  同域 `200 application/zip` 直出，不再 302。后续安全 review 已补上 R2 流式上限、审批状态
  的计数事务复核、异常 JSON/503 回退和分类成员变更 revision；父仓库 357/357 单测、生产构建
  和临时 PostgreSQL 的真实 Next 契约探针均已通过。
- 生产 cordis.run API **尚未由本工作流部署**：基线时 list/detail 为 Next.js 404 HTML，
  尚未执行生产 schema 变更、快照回填或生产域探针。因此 fixture E2E 和本机 API 探针都不是
  生产 API E2E。
- fixture 已对齐 cursor + `count/page`、`page/per_page` 兼容、ETag/304、JSON
  error、canonical screenshot；`scripts/cordis-run-contract-probe.mjs` 可在
  部署后做无 mutation 的目标验收，DSH E2E 也可显式通过 `CORDIS_RUN_API` 切换。
- Desktop 团队已报告 `feat/cordis-v4-desktop` 完成嵌套 DTO、`platform=desktop`、cursor、
  ETag/304、JSON 404、严格 pending/explicit activate 与 preset 200 直出适配（该源码不在
  本仓库，未在本 checkout 独立复验）。迁移背景与契约仍见 `docs/desktop-dto-migration.md`。
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
- 发布准备已完成：所有 workspace 的版本均为 `0.1.0`，`pnpm run pack:check` 会对每个
  候选包执行无脚本、无落盘的 `npm pack --dry-run` 预检。所有包仍是 `private`；Web 的
  可分发 DSH artifact 仍是经 smoke/E2E 验证的自包含 `pack-smoke` tarball，公开 npm
  发布、tag 和取消 private 均需 owner 明确授权，详见 `RELEASE.md`。

## 未完成事项
1. 由已授权操作员按父仓库 `docs/CORDIS-API-V4.md` 执行生产 schema、快照回填、部署、目标
   契约探针和专用 E2E 插件验证。
2. Desktop 分支提交/推送后，与已部署测试目标做一次端到端兼容性 smoke（不重复开发其已报告的
   DTO/门禁实现）。
3. 公开 npm 发布授权：确定 package scope、license/provenance、workspace 依赖发布顺序和
   release tag/version。
4. 触发并记录 `windows-best-effort` 的首个 GitHub Actions green run；Windows 保持 BEST_EFFORT。
5. 8/24 后 codex 对 fc668e4..HEAD 补独立评审。

## 关键命令
- 全部测试：`pnpm -r test`（当前 151 tests）
- 冒烟：`node scripts/dsh-smoke.mjs`
- 真实 E2E：`node scripts/dsh-e2e-install.mjs`
- 目标 API 无 mutation 验收：`CORDIS_RUN_API=https://<target>/api/v1 node scripts/cordis-run-contract-probe.mjs`
- 父仓库 v4 上线 runbook：`../docs/CORDIS-API-V4.md`
- 构建：`node apps/web/scripts/build.mjs`
- 打包 smoke tarball：`node apps/web/scripts/pack-smoke.mjs`
- npm pack 预检：`pnpm run pack:check`
- CI 工作流静态校验：`actionlint .github/workflows/ci.yml`

## 关键文档
- PLAN-*.md / M2A-*.md / JOURNAL-SPEC.md / REVIEWS.md / SELF-REVIEW-*.md
- docs/cordis-run-api-contract.md
- RELEASE.md
- FAILPOINT-COVERAGE.md
- codex-review-latest.md
