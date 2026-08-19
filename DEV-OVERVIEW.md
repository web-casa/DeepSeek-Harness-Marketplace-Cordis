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
- apps/web：DSH 插件壳 + 客户端市场 UI 基础

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
- 146 tests / 146 pass。
- 真实 DSH E2E PASS：install → patch disable → activate → restart → dsh-market
  路由 200。
- 生产 cordis.run API 尚未上线（本地 fixture 可用）。
- 桌面端 DTO 尚未迁移到嵌套 source。

## 未完成事项
1. cordis.run 生产 API 按 docs/cordis-run-api-contract.md 上线。
2. 桌面端 DTO 迁移（source / description / page）。
3. Web UI：详情弹窗、截图、分页、错误详情。
4. verifyInstalled 复核 lockfile integrity。
5. CI：pnpm test + dsh smoke + e2e。
6. 发布：npm pack、tag、release 文档。
7. Windows BEST_EFFORT CI 实证。
8. 8/24 后 codex 对 fc668e4..HEAD 补独立评审。

## 关键命令
- 全部测试：`pnpm -r test`（约 146 tests）
- 冒烟：`node scripts/dsh-smoke.mjs`
- 真实 E2E：`node scripts/dsh-e2e-install.mjs`
- 构建：`node apps/web/scripts/build.mjs`
- 打包 smoke tarball：`node apps/web/scripts/pack-smoke.mjs`

## 关键文档
- PLAN-*.md / M2A-*.md / JOURNAL-SPEC.md / REVIEWS.md / SELF-REVIEW-*.md
- docs/cordis-run-api-contract.md
- FAILPOINT-COVERAGE.md
- codex-review-latest.md
