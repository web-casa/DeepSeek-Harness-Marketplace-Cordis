## 总体结论

**S5a 未通过，不建议进入 S5b。**

对照[上一轮复审报告](/home/ivmm/daohang/toolso-ai-open/cordis-mp/codex-review-m2a-s3-r2.md:1)：

- 完整转为“已修复”的阻断项：**0 项**。
- #1 op 链、#2 普通恢复仍为**部分修复**。
- #10 测试覆盖由“未修复”提升为**部分修复**：已有纯 reducer 和 failpoint 雏形，但还不是 freeze-grade durable matrix。
- #3–#7、#9 没有完成闭合；#8 lock CAS/fencing 仍未修复。

本轮明确修好的子项是：

- 孤立 `CONFIRMED`、seq 缺口、opId/seq 不一致等基础格式开始被拒绝。
- restore-absent 删除后增加复读。
- `ROLLED_BACK` 前增加全目标终检。
- 增加了可编程 failpoint 基础设施。

但 op 链顺序、reducer 统一接入、durable boundary、磁盘矩阵和恢复窗口仍存在阻断级缺口。

## 阻断项

### 1. op 链严格解析/归约仍未闭合

逐项判断：

| 核验点 | 结论 |
|---|---|
| seq | 部分修复：检查连续，但排序后检查，不验证物理追加顺序 |
| opId | 已补基本校验，且两 phase 字段一致性有检查 |
| phase | 孤立 `CONFIRMED` 会拒绝；但跨 op 交错与历史双 pending 仍可被接受 |
| before | 未修复：生成器和 reducer 都把每个 op 的 `before` 固定为 baseline |
| expected 链 | reducer 会检查，但写入、commit、COMMITTED 恢复没有统一调用 reducer |
| 双 pending | reducer 能拒绝部分最终形态，但 writer 自己仍能产生，交错后补齐的双 pending 历史可绕过 |
| 孤立 CONFIRMED | 已修复 |

最严重的是顺序归约不一致：

- parser 把 op 放入 `Map` 后按 seq 排序生成 `records`。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:39)
- `reduceOps()`却按 `Map` 插入顺序遍历 `groups`。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:66)

纯内存复现中，物理顺序 `[2,2,1,1]` 被接受，reducer 计算 owned=C，而 `#readOps()`返回的排序记录归约为 owned=B。即同一份日志产生两个权威状态。

其次，严格 reducer 没有成为统一 gate：

- `#ownedBefore()`只调用 parse，并继续信任所有结构合法的 `CONFIRMED`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:36)
- `commitFiles()`也只检查最后一条是不是 `CONFIRMED`，不检查 expected/before 链。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:84)
- COMMITTED 恢复同样只读取 parse 后的最后记录。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:139)
- `classifyTarget()`只用于未提交恢复。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:181)

`before` 语义也原样未修：每个新 op 都写 manifest baseline，reducer 又强制所有 op 的 `before == baseline`，没有形成前一 owned state 的链。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:47)、[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:71)

此外，已有 pending 时再次调用 `writePresent()`/`deleteTarget()`仍可创建 seq+1 的第二个 `INTENDED`；代码没有在 `#beginOp()`前拒绝 pending。

因此上一轮 #1 仍是阻断项。

### 2. failpoint 没有覆盖完整 durable boundary

当前注入点主要是操作开始前：

- append：只有 `appendRecord:before`。
- replace：只有 `replaceTarget:before`。
- unlink：只有 `unlinkTarget:before`。
- tombstone：只有 `tombstone:before`。
- atomic/outcome：有创建前和临时文件 fsync 后、publish 前。
- marker：有调用前和整个操作完成后。

见 [durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:10)。

缺失的关键窗口包括：

- append 已写、尚未 file fsync；file fsync 后、尚未 dir fsync。
- replace 临时文件 durable 后、rename 前；rename 后、dir fsync 前。
- marker/outcome link/rename 已发布、dir fsync 前。
- unlink 后、dir fsync 前。
- tombstone rename 后、源目录/垃圾目录 fsync 前。

`OUTCOME.json`虽然可以通过通用 `atomicFile` 的 path 过滤命中，但没有 outcome 专属测试，也无法注入“outcome 已发布但目录尚未 durable”的窗口。tombstone 完全没有 after-rename 注入点。

测试也没有真实模拟进程死亡：rollback 中普通 failpoint 异常会被捕获并转成 `CONFLICTED`，随后继续写 conflict evidence。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:164) 只有测试手工赋予 `FP_INJECTED` 的异常才会传播；replace failpoint 用例反而断言产生 conflict report。[failpoint.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/failpoint.test.mjs:35)

这无法证明 kill-9/断电后的磁盘可恢复性。

### 3. 磁盘状态矩阵没有取代手删 JSONL

旧测试仍然执行：

```js
lines.pop()
writeFileSync(ops, ...)
```

以删除最后一条 `CONFIRMED` 来伪造 pending。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:50)

新增 failpoint 测试的 `setup()`也只手工构造了一种固定 manifest/op/target 状态，不是参数化状态矩阵。[failpoint.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/failpoint.test.mjs:11)

当前没有覆盖：

- `INTENDED × current(expected/next/other)`。
- 双 pending、物理乱序、交错 phase。
- present/absent 的正反向写和 rollback。
- marker/outcome/tombstone 各崩溃窗口。
- 首次恢复、再次恢复和最终磁盘不变量。
- 多事务中一个事务冲突后其余事务的恢复。

因此上一轮 #10 只能从“未修复”调整为“部分修复”。

### 4. 恢复终检与 restore-absent：子项修复，但 Phase 2 仍未闭合

已修复：

- restore-absent 在 unlink 后重新读取并确认目标不存在，再追加 `CONFIRMED`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:199)
- 写 `ROLLED_BACK` 前增加所有目标与 baseline 的最终比较。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:168)

仍阻断：

- 终检与 `OUTCOME.json`写入之间没有 fence/CAS，且 lock 仍是可选项。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:175)
- pending append 或 rollback 冲突仍直接 `return report`，导致后续已完成全局预检的事务不再恢复。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:152)
- 没有真正的 restore-absent 回归测试；reducer 测试中声明的 `absent`甚至没有被使用。[reducer.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/reducer.test.mjs:8)
- BAD_OP 在预检分类中没有按事务转成确定的 `UNRECOVERABLE`，而会中断整个 `recover()`。

因此上一轮 #2 仍为部分修复。

### 5. 上一轮其余阻断项仍未解决

`HEAD~1`至本次提交只修改 reducer、failpoint、durable、journal 及两个测试文件。综合当前代码：

| 上一轮项 | 当前状态 |
|---|---|
| #1 op 格式与 op 链 | 部分修复，仍阻断 |
| #2 普通恢复 Phase 2 | 部分修复，仍阻断 |
| #3 COMMITTED 校验 | 部分修复，非法 outcome、严格 reducer、fencing 未解决 |
| #4 resolution Phase 0 | 无实质变化，仍部分修复 |
| #5 restore plan 集合 | 无变化，仍部分修复 |
| #6 supersedes/head 图 | 无变化，仍部分修复 |
| #7 validation gate | 无变化，仍可伪造 validation |
| #8 lock CAS/fencing | 无变化，仍未修复 |
| #9 conflict evidence | 无变化，仍部分修复 |
| #10 freeze-gate 测试 | 未修复 → 部分修复 |

COMMITTED 路径仍只判断 outcome 是否 truthy：已存在 `ROLLED_BACK`或非法 outcome 时不会拒绝或校正，却会直接 tombstone journal。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:146)

## 重要问题

1. `validFileState()`只检查 `sha256:`前缀和总长度，不检查后续是否为十六进制；absent 状态还允许 hash 字段缺失，不属于严格 schema。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:8)

2. `mode`、`length`没有按 present/absent、kind 做类型和必填校验。损坏记录可通过 parse，直到后续 I/O 才产生非确定异常。

3. failpoint registry 是进程级全局状态，没有命中次数、one-shot、作用域或 `afterEach`清理保障。[failpoints.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/failpoints.mjs:2)

4. failpoint 调用是同步的；若回调返回 Promise，durable 操作不会等待，因此注释所称的“暂停”不能直接用于异步 barrier/race 控制。

5. 新增 reducer 测试文件可以通过，但缺少物理乱序、双 pending、before 链、opId 错配、phase 交错及 absent 状态测试，因而没有暴露上述顺序不一致。

## 建议优化

- 让 parser 单次按物理行顺序执行状态机，不排序修复证据；严格要求 `INTENDED(seq=n)`紧接其 terminal phase，只有最后一个 op 可以 pending。
- 只暴露一个“parse + validate + reduce”结果，并让写入、`#ownedBefore()`、commit、普通恢复和 COMMITTED 恢复全部使用它。
- 明确 `before`契约；若表示 op 前 owned state，则生成器和 reducer 都应按 `previous.next/current owned`串链。
- 为每个 durable primitive增加 `after-write`、`after-file-fsync`、`after-publish/rename`、`before-dir-fsync`、`after-dir-fsync`阶段。
- 用子进程在命中点直接退出，再由新进程重复恢复；矩阵必须从公开 Journal API 生成状态，不再通过删改 JSONL 模拟。
- 增加 present/absent、marker/outcome/tombstone、首次/二次恢复的笛卡尔矩阵，并验证 target、op 链、outcome、trash 和 conflict evidence 的最终不变量。

本次按只读范围完成静态复审，并运行了不写磁盘的 reducer 测试；未运行会在临时目录创建状态的完整测试集。