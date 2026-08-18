# S9 自审报告

## 完成
- 补齐 `replaceTarget:after-write` failpoint。
- 矩阵场景 17 → 29，新增 replace-before / replace-after-write /
  append-after-dirfsync / SIGKILL / tombstone-after-src-fsync /
  atomicFile 四点 / marker-after / tombstone-before / tombstone-after-dirfsync。
- 产出 FAILPOINT-COVERAGE.md：23 个 durable failpoint 点全部有测试。
- 全量测试：89 tests / 89 pass。

## 自审发现
- 从仓库根运行 `node --test packages/journal-core/test/*.test.mjs` 会因 cwd
  相对路径失败；测试必须从 packages/journal-core 运行。已在 package.json
  scripts.test 中固定为正确目录。
- 其余无回归。

## 冻结结论
- POSIX FULL：10/10 gate CLOSED。
- Windows：BEST_EFFORT，需 Windows CI 实证。
