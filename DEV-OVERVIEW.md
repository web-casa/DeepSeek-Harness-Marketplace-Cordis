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
- 生产 cordis.run API 尚未上线（2026-08-19 直接探测 list/detail 均为 Next.js
  404 HTML；本地 fixture 可用），因此不得把 fixture E2E 说成生产 API E2E。
- fixture 已对齐 cursor + `count/page`、`page/per_page` 兼容、ETag/304、JSON
  error、canonical screenshot；`scripts/cordis-run-contract-probe.mjs` 可在
  部署后做无 mutation 的目标验收，DSH E2E 也可显式通过 `CORDIS_RUN_API` 切换。
- 桌面端源码不在本仓库，故尚未实际迁移；迁移 DTO/错误/分页/安全门禁指南见
  `docs/desktop-dto-migration.md`。
- Web 市场已提供详情弹窗、仅渲染 `https://cdn.cordis.run` 截图、cursor 历史分页、
  Web/Desktop 平台徽章及可展开的错误诊断（code/HTTP/request ID/retry）。安装和启用
  仍只经既有 guard-backed controller/API；页面不新增 mutation 通道。
- 已接入 `.github/workflows/ci.yml`：两个无凭据 Ubuntu job 分别执行 test/build/host
  smoke 与真实 DSH smoke/E2E；Node 24.18.0、pnpm 11.10.0、DSH 0.1.0-rc.7 和
  Actions 提交均固定。CI 的 DSH integration 只使用临时 profile 与本地 fixture，
  不把生产 API 当作可用依赖。
- pnpm 仅显式批准 `esbuild` 的构建脚本（`allowBuilds.esbuild: true`）；这是 Web
  打包所需的已声明 devDependency，其余依赖仍不获隐式构建脚本授权。

## 未完成事项
1. cordis.run 生产 API 按 docs/cordis-run-api-contract.md 上线。
2. 桌面端按 `docs/desktop-dto-migration.md` 实际迁移 DTO（source / description / page）。
3. 发布：npm pack、tag、release 文档。
4. Windows BEST_EFFORT CI 实证。
5. 8/24 后 codex 对 fc668e4..HEAD 补独立评审。

## 关键命令
- 全部测试：`pnpm -r test`（当前 151 tests）
- 冒烟：`node scripts/dsh-smoke.mjs`
- 真实 E2E：`node scripts/dsh-e2e-install.mjs`
- 目标 API 无 mutation 验收：`CORDIS_RUN_API=https://<target>/api/v1 node scripts/cordis-run-contract-probe.mjs`
- 构建：`node apps/web/scripts/build.mjs`
- 打包 smoke tarball：`node apps/web/scripts/pack-smoke.mjs`
- CI 工作流静态校验：`actionlint .github/workflows/ci.yml`

## 关键文档
- PLAN-*.md / M2A-*.md / JOURNAL-SPEC.md / REVIEWS.md / SELF-REVIEW-*.md
- docs/cordis-run-api-contract.md
- FAILPOINT-COVERAGE.md
- codex-review-latest.md
