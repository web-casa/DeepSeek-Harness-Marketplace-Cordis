# M2a Freeze Report（S6 收口）

## 结论
**不宣告整体冻结**。可对以下范围做条件冻结：
- 普通事务恢复（G3）✅
- conflict evidence（G9）✅
- POSIX FULL 平台目录锁（G4）✅（Windows 为 BEST_EFFORT）
其余 gate 为 PARTIAL，进入下一轮（S7）前不得被 M2b 依赖。

## Gate 状态
| Gate | 状态 | 依据 |
|---|---|---|
| G1 supersede 原子性 | **CLOSED** | 新 manifest 先落盘、旧 outcome 补写、只允许 supersede 冲突 head；两阶段间子进程崩溃测试通过 |
| G2 祖先清理 | **CLOSED** | 三连链第一祖先 tombstone 崩溃后 recover 断链续清理，最终 resolutions 空 |
| G3 普通恢复 | **CLOSED** | reducer 物理顺序/链校验统一；COMMITTED/ROLLED_BACK/终检；failpoint+子进程矩阵 |
| G4 锁 | **CLOSED (FULL)** | 目录锁 mkdir 排他、heartbeat 自有目录、takeover rename CAS、fencing、Linux start ticks；Windows BEST_EFFORT |
| G5 validation gate | PARTIAL | Symbol ticket + once-only + fingerprint；恶意进程内调用不在威胁模型 |
| G6 测试矩阵自包含 | PARTIAL | 公开 API 生成的 13 场景子进程 crash 矩阵；仍未逐点穷举全部 durable 边界 |
| G7 schema 完整 | PARTIAL | FileState/baseline/manifest/outcome/report/resolution/validation 已集中校验；恢复报告等内存结构未版本化 |
| G8 target durable | PARTIAL | replace/unlink 各边界 failpoint + 部分 kill 矩阵；marker/outcome/tombstone 部分覆盖 |
| G9 conflict evidence | **CLOSED** | evidence-manifest hash/length + report once-only + 恢复校验 + BAD_EVIDENCE |
| G10 故障注入闭环 | PARTIAL | deterministic failpoint + 13 场景子进程 exit；kill -9 全边界仍未穷举 |

## 测试
- 66 tests / 66 pass
- `node --test test/*.test.mjs`

## 待办（下一轮）
1. G1/G2 补 supersede 两阶段与逐祖先 tombstone 的子进程崩溃测试。
2. G6/G10 将 durable primitive 每个 failpoint 点与矩阵场景对齐，补全 after-file-fsync / before-dirfsync 等。
3. G7 抽取统一 schema 校验模块。
4. G5 若需严格关闭，改由 JournalPort 内部调用 BaselineValidator，不暴露 recordValidation。
5. Windows BEST_EFFORT 路径在 Windows CI 验证。
