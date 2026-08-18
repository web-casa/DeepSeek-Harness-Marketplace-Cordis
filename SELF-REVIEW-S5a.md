# S5a 自审报告（codex 额度用尽后的人工复审）

复审范围：packages/journal-core/src、test；运行 node --test，54/54 通过。

## 本轮发现并已修复
1. `Journal.begin()` 不检查已有 active tx → 现在拒绝 ACTIVE_TX。
2. `scan()` 遇到损坏 manifest 直接抛异常 → 现在标记 manifestInvalid，recover 返回 BAD_MANIFEST。
3. `commitFiles()` 写 OUTCOME 前缺少 fence → 已补。
4. conflict report 只查存在性，evidence 缺失仍被信任 → 新增 #conflictStatus：
   report schema 校验 + evidence 逐文件 hash 校验；缺失/损坏返回 BAD_REPORT / BAD_EVIDENCE。
5. ResolutionJournal 未校验 action 枚举 → BAD_ACTION。
6. active head（无 OUTCOME）可被并发 supersede → 现在只允许 supersede
   `RESOLUTION_CONFLICTED` head。
7. `resolveTarget()` 每次写前只校验当前 target snapshot → 现在每次先重跑全量
   Phase 0（任一其他 snapshot 损坏则本次零 target 写）。
8. `completeResolution()` 可重复覆盖 OUTCOME → 现在 once-only（JOURNALLED）。
9. `cleanupTerminal()` 不校验 supersedes 图，可能 tombstone 跨 tx 祖先 → 现在
   先 #validateGraphForTx，并校验祖先 txid 一致。

## 仍明确未闭环（进入 S5b）
- lock heartbeat 仍不是严格 CAS；owner 身份未绑定 OS 进程启动时间。
- validation 结果仍可由进程内调用方伪造（威胁模型已声明不含恶意进程内调用）。
- conflict evidence 无 evidence manifest / once-only publish / 目录 fsync 显式声明。
- 尚未建立公开 API 生成的参数化磁盘状态矩阵与完整 kill-9 全边界测试。
- trash 只 rename 不递归清理。
- `fsyncDir` 在 Windows 的 BEST_EFFORT 降级路径未实现。

## 测试现状
- 54 tests / 54 pass，覆盖普通事务、resolution、lock、reducer、failpoint 与
  子进程 marker 崩溃恢复。
