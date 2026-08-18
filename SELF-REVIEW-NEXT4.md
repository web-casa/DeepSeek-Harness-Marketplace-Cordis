# Next 4 项自审

## 完成
- P1 根 workspace：pnpm-workspace.yaml + workspaces；包名导入恢复。
- P4 snapshot：catalog-core scripts/snapshot.mjs + data/registry-snapshot.json。
- P2 apps/web：DSH host 插件壳，挂载 catalog routes；client 占位；测试通过。
- P3 install-core：InstallService install/uninstall 骨架 + journal 事务 + 测试。

## 测试
- journal-core 92 / catalog-core 6 / install-core 5 / web-harness 5 / apps-web 1
- 总计 109 tests / 109 pass（pnpm -r test）

## 自审发现并修复
1. pnpm -r test 透传 --store-dir 导致测试路径被当 test target；后续只运行
   `pnpm -r test`。
2. install-core index 未导出 InstallError，测试首跑失败；已修复。
3. catalog-core 初始 regex/source spread/detail 校验问题已在上一轮修复，
   本轮回归全绿。

## 边界
- install-core 仅覆盖 profile 文本文件事务；PRE_DISABLE / ACTIVATE 仍未接入。
- apps/web client 是占位，React settings.section UI 待 M1b。
