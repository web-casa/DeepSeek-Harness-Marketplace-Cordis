## 总体结论

**不建议进入 S5，更不能按当前实现冻结 JournalPort。** S1、S2、S3 都不能视为忠实实现 spec v7；S4/FileLock 也尚未达到 G4。当前代码存在会错误宣告 `COMMITTED`、`ROLLED_BACK`、`RESOLVED`，以及恢复时覆盖有效数据的路径。

| Slice | 结论 | 主要缺口 |
|---|---|---|
| S1 | 不通过 | durable primitive 仅部分符合；tombstone、fingerprint、目录安全、schema/type 均不完整 |
| S2 | 不通过 | op 链格式错误；Phase 2、COMMITTED、冲突归档和清理均偏离 §6/§7 |
| S3 | 不通过 | resolution Phase 0、plan 集合校验、supersedes 图、validation gate、自动续清理缺失 |
| S4 | 不通过 | exclusive acquire 基本存在，但 heartbeat 不是 CAS，fencing 范围严重不足 |

可以提前建设 S5 的 deterministic failpoint 测试框架来帮助返工，但不应把它当作 S1–S4 已验收后的“下一步”。

## 阻断项

1. **普通 op 的磁盘格式根本不符合 §6.1。**

   `#appendOp()`每写一条 phase 都递增 `seq` 并生成新 `opId`；正常写入的 INTENDED 和 CONFIRMED 因而被记录成两个不同 op。spec 要求同一 op 的两个 phase 共享 `seq/opId`，仅 `phase` 不同。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:45) [§6.1](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:73)

   同时 `#readOps()`没有验证版本、txid、targetKey、before、expected 链、连续 seq、双 pending、ROLLBACK next 等。损坏的 CONFIRMED 可以被当作权威 owned 状态，随后触发覆盖目标的 rollback，而不是 `UNRECOVERABLE`。

2. **普通恢复 Phase 2 存在错误宣告成功和覆盖竞争写入的窗口。**

   分类后，planned CANCELLED/CONFIRMED 在 append 前没有重读 current；rollback 写入后也没有复读 `current==next` 就追加 CONFIRMED。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:124) [journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:171)

   例如 pending INTENDED 被判定为 CANCELLED 后，外部把文件改成 X，代码仍会追加 CANCELLED，并可能直接写 `OUTCOME=ROLLED_BACK`。这违反 §7“每个 planned append 前复核”和“Phase 2 新冲突不得报成功”。[§7](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:101)

3. **COMMITTED 恢复路径会静默接受损坏状态。**

   只要存在 `OUTCOME=COMMITTED` 或 COMMITTED marker，`recover()`立即返回 `COMMITTED_OK`，不验证最后 op 是否 CONFIRMED，也不复读目标是否等于 next。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:127)

   它还把没有 COMMITTED marker 的 outcome 当作提交权威，违反“COMMITTED marker 是提交唯一权威”；marker 后崩溃也不会补写 OUTCOME 或 tombstone。G3 因此未满足。[M2A-FREEZE-GATE.md](/home/ivmm/daohang/toolso-ai-open/cordis-mp/M2A-FREEZE-GATE.md:12)

4. **resolution 缺少 Phase 0，损坏 snapshot 会先毁掉当前文件再报错。**

   `resolveTarget()`直接读取 snapshot 并替换目标，替换完成后才校验 hash。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:71)

   若 snapshot 已损坏，当前 expected 内容会被损坏字节覆盖，然后函数抛出冲突。这直接违反 §8.2“全量预检失败时零 target 写”，属于明确的数据丢失路径。[§8.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:128)

5. **restore plan 集合未校验，可用空集/子集宣告 RESOLVED 并清除证据。**

   `beginResolution()`不验证 `plan target 集合 == baseline 集合`；`completeResolution()`只遍历 plan 中存在的项目。空 plan 会直接得到 `RESOLVED`，之后 `cleanupTerminal()`移走原 journal/conflict。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:34) [resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:107)

   这正是 §9.3 明确要求判为 `UNRECOVERABLE` 的 D18 场景。[§9.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:194)

6. **supersedes/head 归约不安全。**

   当前只计算“未被指向”的节点，不校验循环、跨 tx、悬空、一旧多新或分叉。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:26)

   `beginResolution()`也没有锁，两个并发调用可同时指向旧 head，制造两个 authoritative heads。它还允许 supersede 非 `RESOLUTION_CONFLICTED` 的活动或成功 head。清理时沿未经验证的边遍历，循环会无限循环，跨 tx 边可能 tombstone 其他事务的 resolution。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:146)

7. **validation gate 可以绕过 BaselineValidator，fingerprint 也不符合 spec。**

   测试和公开 API 都允许调用者自行构造 `{valid:true, fingerprint}`；实现只比较当前指纹，没有证明 `baselineReport` 来自 BaselineValidator。[resolution.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/resolution.test.mjs:71)

   此外：

   - fingerprint 对 `entries` 数组做 JSON，而不是规范要求的 canonical object。[state.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/state.mjs:11)
   - `#currentFingerprint()`从所有 resolution 推导“唯一 tx”，存在两个不同 tx 时即失败，而不是使用当前 rid 的 tx。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:96)
   - 重复 validation 返回原始 `EEXIST`，不是规定的 `JOURNALLED`。

   因此 G5/G7 均不成立。

8. **FileLock 的 heartbeat 不是 CAS，写步骤也没有完整 fencing。**

   `heartbeat()`先读 token/epoch，再用普通 rename 覆盖 lock；若检查后 lock 被 takeover 并创建新 owner，旧 heartbeat 会覆盖新锁。[lock.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/lock.mjs:49)

   另外：

   - `ownerAlive()`只检查 PID，不校验 bootId/processStartToken 三元组。
   - bootId 是每次 acquire 的随机数，processStartToken 只是 PID 字符串。
   - Journal 只在方法入口 fence 一次，append、target replace、CONFIRMED、OUTCOME 等每个写步骤前均未 fence。
   - ResolutionJournal 完全没有 fencing/持锁。
   - 没有 `withLock`、force 语义、stolen 清理。

   这不满足 §10 和 G4，协作进程“单 owner、无静默覆盖”的核心保证尚不存在。

9. **冲突证据协议不足以在崩溃后作为权威证据。**

   `archiveConflict()`只复制当前 target 并写 report；没有复制 manifest/ops/snapshots、没有复制后 hash 校验、没有 evidence 摘要/检测阶段，也不更新 manifest 为 CONFLICTED。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:188)

   report/evidence 都可被后续恢复覆盖；而 `recover()`根本不检查已存在的 conflict report，可能再次进入普通恢复。G9 未满足，原始冲突现场可能被替换。

10. **测试不能证明任何 freeze gate 已通过。**

   当前测试没有 deterministic failpoint、kill -9、模型不变量或自包含磁盘状态矩阵。主要缺口包括：

   - pending 测试通过普通 `writeFileSync`删行模拟，不覆盖 durable boundary。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:50)
   - COMMITTED 测试恰好接受了“不补 OUTCOME、不 tombstone”的错误行为。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:19)
   - validation 测试要求原始 `EEXIST`，与 spec 的 `JOURNALLED` 相反。[resolution.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/resolution.test.mjs:83)
   - 没有非法 supersedes 图、plan 集合不等、snapshot hash/length/mode 全组合、每步 cleanup crash。
   - 没有普通 empty-lock 并发 acquire、heartbeat/takeover CAS、写步骤中途 lease 丢失。
   - “dual takeover”没有确定性卡住 rename/创建窗口，无法证明竞态安全。[lock.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/lock.test.mjs:35)

## 重要问题

1. **tombstone 路径与行为错误。**  
   trash 被建在 `journal/trash`、`conflicts/trash` 等子目录，而规范要求统一的 `<root>/trash`；rename 后也从不递归删除。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:53) 更严重的是 `journal/trash` 会被 `Journal.scan()`误识别为 tx 目录。

2. **durable primitive 没有可靠报告 durability 失败。**  
   `fsyncDir()`吞掉目录 open 失败并继续返回成功；没有父目录 `lstat no-follow`；临时文件在写/chmod/fsync 异常时不会清理。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:5)

3. **`.cordis-mp/state.json` 的 absent→present 可能直接 ENOENT。**  
   `replaceTarget()`不创建目标父目录；测试 profile 中也没有 `.cordis-mp` 子目录。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:35)

4. **snapshot Phase 0 不完整。**  
   普通恢复只校验 hash/length，不校验 mode，也没有全局“全部事务预检成功后才开始写”的边界。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:112)

5. **confirmed 删除没有对正确目录做 durable fsync。**  
   删除 `confirmed/<key>` 后 fsync 的是 resolution 根目录，不是 `confirmed` 的父目录；且直接使用 `unlinkSync`，没有公共 durable metadata primitive。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:63)

6. **接口和状态机不完整。**  
   缺少 `JournalPort.delete`、显式 `rollback(tx)`、`recover(plan)`、GlobalRecoveryPlan、LockPort `withLock`；manifest 也没有实际经过 PREPARING/MUTATING/ROLLING_BACK/ROLLED_BACK/CLEANED 状态转换。

7. **规范本身存在两处需要先消歧的冲突。**

   - spec §8.3 写“旧 SUPERSEDED 先、新 manifest 后”，但 freeze gate G1 写“新 manifest 先、旧 outcome 可补写”。实现选择了 G1 顺序，这是合理的，但旧 outcome 写失败后仍抛错，不符合“可补写”语义。
   - spec §7.1 允许 report 存在时补 evidence，freeze gate G9 要求 evidence 不完整即 `UNRECOVERABLE`、不得补现场。

   冻结前应明确以 freeze gate 覆盖 working draft，并同步修改 spec。

## 建议优化

- 建立单一、纯函数式 reducer：严格解析 schema/op 链，输出不可变 RecoveryPlan；任何写步骤前校验 plan 摘要、current 和 lease。
- 为每个 durable boundary 加命名 failpoint，并以真实子进程 kill-9 覆盖 marker、rename、fsync、append、tombstone 各窗口。
- 将 schema、FileState 比较、canonical JSON、outcome 状态组合集中实现，避免 Journal 和 ResolutionJournal 各自做宽松判断。
- 减少一行内多语句和超长函数。当前压缩写法使恢复协议很难逐步骤审计，也容易遗漏 fencing/fsync。

本次按要求只做了静态只读审查，没有修改文件，也没有运行会写入 `/tmp` 的测试。