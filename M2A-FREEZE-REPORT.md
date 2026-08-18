# M2a Freeze Report（S6 收口）

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
- 66 tests / 66 pass
- `node --test test/*.test.mjs`

## 待办（下一轮）
1. G1/G2 补 supersede 两阶段与逐祖先 tombstone 的子进程崩溃测试。
2. G6/G10 将 durable primitive 每个 failpoint 点与矩阵场景对齐，补全 after-file-fsync / before-dirfsync 等。
3. G7 抽取统一 schema 校验模块。
4. G5 若需严格关闭，改由 JournalPort 内部调用 BaselineValidator，不暴露 recordValidation。
5. Windows BEST_EFFORT 路径在 Windows CI 验证。
