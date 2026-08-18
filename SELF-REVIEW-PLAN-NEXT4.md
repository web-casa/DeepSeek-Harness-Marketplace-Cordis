# Next 4 方案自审

## 通过项
- 顺序合理：P1 解包名导入，P4 低成本，P2/P3 依赖 catalog-core。
- P2 范围克制：只做 host 路由 + 占位 client，不假装能测 DSH React。
- P3 复用 journal-core 的 begin/commit/rollback，不重造事务。

## 发现并修正
1. 原计划 P2 client 用 settings.section 但无 React 依赖；改为导出注入接口 +
   明确 UI 在 M1b 做。
2. P3 曾想实现 PRE_DISABLE/ACTIVATE；本阶段 journal 快照只能覆盖文本文件，
   先只做 install 决策 + 安装后复核，activation 留待 M2b。
3. P4 快照输出目录需 .gitignore 不误伤：data/registry-snapshot.json 应提交。

## 结论
方案可执行，按 P1→P4→P2→P3 开始。
