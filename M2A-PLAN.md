# M2a 实现计划（基于 JOURNAL-SPEC v7 working draft）

## Slices
- S1 骨架：packages/journal-core + durable primitives + schema/types + FileLock 基础
- S2 普通事务：begin/writePresent/delete/commitFiles/rollback/scan/recover
  + A/B/C 测试与 failpoint（覆盖 G3/G8 的普通部分）
- S3 resolution journal：manifest/plan/op/confirmed/validation/supersede/清理
  + D 测试（覆盖 G1/G2/G5/G8 的 resolution 部分）
- S4 锁闭环：exclusive acquire/heartbeat CAS/takeover/fencing/lease
  + E 测试（覆盖 G4）
- S5 repair CLI + 全量自包含矩阵 + kill -9 注入（覆盖 G6/G7/G9/G10）
- S6 freeze：全部 gate 绿 → spec v1.0-final → 暴露 JournalPort/LockPort

## 当前状态
- S1/S2 进行中，其余 TODO。
