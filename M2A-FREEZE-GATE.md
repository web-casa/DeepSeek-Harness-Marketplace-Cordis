# M2a contract freeze gate

规则：JOURNAL-SPEC.md v7 是 working draft。只有本文件所有 gate 的实现测试
通过，才允许把 spec 升为 v1.0-final，并向 M2b 提供 JournalPort。

## Gate 列表

| ID | 名称 | 来源（codex v7） | 冻结条件 | 状态 |
|---|---|---|---|---|
| G1 | supersede 原子性 | 阻断1 | 新 manifest 先落盘（含 supersedes 边），旧 SUPERSEDED 为可补写信息；任一步崩溃后全局归约结果唯一 | TODO |
| G2 | 祖先清理闭环 | 阻断1 | 成功 head 清理 oldest→newest；任一祖先删除后崩溃可续清理，不出现悬空引用导致 UNRECOVERABLE | TODO |
| G3 | 普通恢复成功路径 | 阻断2 | ROLLBACK op 完整执行 append INTENDED→检查→durable 替换→复读→append CONFIRMED；COMMITTED 路径写 OUTCOME=COMMITTED 并 tombstone | TODO |
| G4 | lease CAS/fencing | 阻断3 | 活或未 stale 均不可接管；heartbeat 更新带 ownerToken+epoch CAS；所有写步骤前 fencing；lease 丢失后在下一写前终止 | TODO |
| G5 | validation gate | 阻断4 | validation.json once-only；validator 结果不可由外部对象伪造；指纹不匹配拒绝 complete | TODO |
| G6 | 测试矩阵自包含 | 阻断5 | 矩阵每项给出初始磁盘状态、崩溃点、返回值和最终可观察状态，不引用旧版本 | TODO |
| G7 | schema 完整 | 重要问题 | manifest/OUTCOME/report/validation/plan/recovery 全部有版本化 schema 和允许状态组合 | TODO |
| G8 | target durable 全覆盖 | 重要问题 | 普通写与 resolution 全部调用 replace-target/unlink-target-durable；confirmed 删除等元数据写使用 durable primitive | TODO |
| G9 | conflict evidence 语义 | 重要问题 | report 为 commit point；report 存在但 evidence 不完整 → UNRECOVERABLE，不补写现场 | TODO |
| G10 | 故障注入闭环 | v7 测试矩阵 | kill -9 + deterministic failpoint 双轨；不变量 G1-G7 模型测试通过 | TODO |

## 与测试矩阵映射
- G1/G2 → D8/D14/D15/D16/D17
- G3 → A/B/C1/C2
- G4 → E1-E15
- G5 → D13/F4/G7
- G6 → 全部场景重写为自包含表
- G7 → 所有 schema 表
- G8 → B1/D1-D7
- G9 → conflict archive 崩溃点
- G10 → kill/failpoint 双轨
