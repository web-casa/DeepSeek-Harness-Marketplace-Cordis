# PLAN-M2B-REMAINING 自审

## 结论
- R1→R2→R3 顺序合理，范围可执行。
- 需修正 2 点后开工。

## 修正
1. R2 计划写 `.cordis-mp/pending-activation.json`，但 journal-core target
   allowlist 目前没有该文件。→ 将 allowlist 扩展为
   `package.json / pnpm-lock.yaml / cordis.patch.yml / .cordis-mp/state.json /
   .cordis-mp/pending-activation.json`。
2. R1 原备选“不引入 tar 只做 inspectDir”会削弱安装前门禁。→ 决定引入
   `tar` 依赖，实现 tarball 流式解析；`inspectDir` 作为补充。
3. R3 smoke 中 apps/web 尚未构建 client bundle；先验证 host 路由即可，
   client UI 不纳入 smoke PASS 条件。
