# web-harness catalog routes 自审

## 完成
- packages/web-harness：createCatalogHandler / mountCatalogRoutes /
  parseListQuery。
- 路由：GET /cordis-mp/catalog、/cordis-mp/plugin/:slug、/cordis-mp/health。
- 错误映射：CatalogError -> {error:{code,message,requestId,retryAfter}}。
- 测试：5/5 pass（真实 node:http + fake catalog）。

## 自审发现并修复
- 源码/测试使用了 workspace 包名导入，当前无 root workspace 导致
  MODULE_NOT_FOUND；改为相对路径导入，后续引入 pnpm workspace 时再切回
  包名导入。

## 后续
- 接入 DSH 插件 host（ctx.webServer.register + dsh.client 设置页）。
- mutation 路由与 journal-core / install-core 接驳。
