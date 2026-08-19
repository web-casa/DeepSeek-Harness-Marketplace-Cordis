# M2a Freeze Report（S9 收口，P1 修复后）

## 结论
**POSIX FULL 平台范围：10/10 gate 关闭，JOURNAL-SPEC v7 working draft 可冻结为 v1.0-final（条件冻结）。**
Windows 平台为 BEST_EFFORT，需 Windows CI 实证后才可宣称 FULL。

## Gate 状态
| Gate | 状态 | 依据 |
|---|---|---|
| G1 supersede 原子性 | **CLOSED** | 新 manifest 先落盘、旧 outcome 补写、只允许 supersede 冲突 head；两阶段间子进程崩溃测试通过 |
| G2 祖先清理 | **CLOSED** | 三连链第一祖先 tombstone 崩溃后 recover 断链续清理，最终 resolutions 空 |
| G3 普通恢复 | **CLOSED** | reducer 物理顺序/链校验统一；COMMITTED/ROLLED_BACK/终检；failpoint+子进程矩阵 |
| G4 锁 | **CLOSED (FULL)** | 目录锁 mkdir 排他、heartbeat 自有目录、takeover rename CAS、fencing、Linux start ticks；Windows BEST_EFFORT |
| G5 validation gate | **CLOSED** | validator 由 ResolutionJournal 内部持有并调用，外部无法传入 evidence |
| G6 测试矩阵自包含 | **CLOSED** | 29 场景子进程 crash 矩阵，23 个 durable failpoint 点全表覆盖（FAILPOINT-COVERAGE.md） |
| G7 schema 完整 | **CLOSED** | 持久化文件集中校验；RecoveryReport / ResolutionOutcome 版本化并接入 |
| G8 target durable | **CLOSED** | replace/unlink/marker/outcome/tombstone 全部 failpoint 点覆盖 |
| G9 conflict evidence | **CLOSED** | evidence-manifest hash/length + report once-only + 恢复校验 + BAD_EVIDENCE |
| G10 故障注入闭环 | **CLOSED** | 全点 deterministic exit(43) + SIGKILL 双轨代表场景；不变量测试通过 |

## 测试
- 92 tests / 92 pass
- 从 packages/journal-core 目录运行：`node --test test/*.test.mjs`（或 `npm test`）

## 已完成的原待办
- [x] G1/G2 supersede 两阶段与逐祖先 tombstone 子进程崩溃测试
- [x] G6/G10 durable failpoint 点与矩阵场景全量对齐（FAILPOINT-COVERAGE.md）
- [x] G7 统一 schema 校验模块
- [x] G5 validator 内部持有（validateAndRecord）
- [ ] Windows BEST_EFFORT 路径在 Windows CI 验证（仍开放；`windows-best-effort` job 已配置，
  需首个远端 green run 后才可勾选，且绝不改变 Windows 的 BEST_EFFORT 分级）

## 外部评审后修复（P1）
- [x] P1-1 ResolutionJournal.recoverReport schema 不匹配（txid/enum 修复）
- [x] P1-2 sweepTrash 删除新鲜 trash 导致断链祖先 BAD_GRAPH 永久 wedge（sweepTrash 年龄门槛 + 缺失祖先断链语义）
