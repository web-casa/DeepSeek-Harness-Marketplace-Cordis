# Next 4 项执行方案

## P1 根 workspace 化
- 根 package.json（private, workspaces: packages/* apps/*）+ pnpm-workspace.yaml。
- 切回包名导入：@cordis-mp/catalog-core / journal-core / web-harness / install-core。
- pnpm install 仅本地 workspace 链接，无外部依赖。
- 验收：根目录 `node --test packages/*/test/*.test.mjs` 全绿。

## P2 DSH 插件壳（apps/web）
- 包 `@cordis-mp/web`，声明 `dsh.bundle.patch`、`dsh.client`。
- host `src/index.js`：`inject=['webServer']`，apply 中挂 catalog routes；
  CatalogClient 读 `CORDIS_RUN_API`，snapshot 兜底。
- client `src/client/index.js`：先做 settings.section 的占位注册（无 React
  依赖时导出注入接口），UI 留待 M1b。
- 测试：fake webServer 验证 host 挂载与 catalog 路由。
- 验收：host 可安装进 DSH profile，路由可达。

## P3 install-core 骨架
- ports：JournalPort / PackageManagerPort / ActivationPort / CatalogPort。
- InstallService.install：fresh 复核 → installability → journal.begin →
  packageManager.installVerifiedArtifact → 安装后复核 → commitFiles。
- uninstall/update 同骨架（先 install 路径）。
- 测试：fake ports 覆盖成功、目录拒绝、journal 回滚。
- 验收：与 journal-core / catalog-core 通过包名导入协作。

## P4 snapshot 脚本
- catalog-core/scripts/snapshot.mjs：`CORDIS_RUN_API` 拉取 /plugins，
  validateCatalog，写 data/registry-snapshot.json。
- `npm run snapshot`；测试 fixture 生成快照。
- 验收：CatalogClient snapshot fallback 用生成文件。

## 执行顺序
P1 → P4 → P2 → P3（依赖 workspace 化与 catalog-core）。
## 风险
- P2 真实 DSH client React 环境无法本地验收，先做 host + 占位 client。
- P3 事务边界只覆盖 profile 文本文件，包管理器副作用不回滚（已有 spec 声明）。
