## 总体结论

**S5a 仍不能关闭，不建议进入 S5b。**

对照 [codex-review-m2a-s5a.md](/home/ivmm/daohang/toolso-ai-open/cordis-mp/codex-review-m2a-s5a.md:1)，上一轮 5 个阻断项均有进展，但没有一项完整闭合：

| 上一轮阻断项 | 本轮结论 |
|---|---|
| 1. op 链严格解析/归约 | **部分修复** |
| 2. failpoint durable boundary | **部分修复** |
| 3. 磁盘状态矩阵 | **部分修复** |
| 4. 恢复终检与 restore-absent | **部分修复** |
| 5. 其余阻断项，重点 COMMITTED 校验 | **部分修复** |

上一轮 5 个重要问题：

| 重要问题 | 本轮结论 |
|---|---|
| hash/absent state schema | **已修复** |
| mode、length 严格校验 | **未修复** |
| failpoint 次数、作用域与清理 | **部分修复** |
| 异步 failpoint/barrier | **未修复** |
| reducer 边界测试覆盖 | **部分修复** |

## 阻断项

### 1. op 物理顺序和统一 reducer 已基本修复，但 `before` 链仍未修复

已修复：

- parser 现在按物理行顺序处理，不再排序；seq 必须连续，`INTENDED` 后必须紧接同一 op 的 terminal phase，双 pending、交错 phase、物理乱序都会被拒绝。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:30)
- 对应测试已增加物理乱序、交错 terminal、双 pending。[reducer.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/reducer.test.mjs:83)
- `#validatedTarget()` 已用于 owned 计算、新 op、commit 和 COMMITTED 恢复；普通恢复的 `classifyTarget()`也进入 `reduceOps()`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:43)
- writer 已拒绝已有 pending 时创建第二个 `INTENDED`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:47)
- `expected` 已按当前 owned 串链并有反例测试。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:75)

仍阻断：

- 按上一轮要求，`before` 应表达该 op 开始前的 owned state；当前 writer 仍对每个 op 写 baseline，reducer 也强制 `before == baseline`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:52)、[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:73)
- A→B→C 测试的第二个 op 仍沿用默认 `before=A`，实际把错误契约固化进测试。[reducer.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/reducer.test.mjs:14)
- `#readOps()`仍暴露 parse-only 结果给 `#lastMode()`，尚未完全收敛为唯一的“parse + validate + reduce”入口；当前没有直接绕过写入 gate，但结构仍不满足上一轮建议。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:36)

### 2. durable failpoint 点位已扩充，但尚未达到完整边界验证

源码已有明显改进：

- append 覆盖写后、file fsync 后/dir fsync 前。
- atomic file 覆盖临时文件 durable 后、publish 后/dir fsync 前。
- replace 覆盖临时文件 durable 后/rename 前、rename 后/dir fsync 前。
- unlink 覆盖 unlink 后/dir fsync 前。
- tombstone 覆盖 rename 后及源目录 fsync 后。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:10)

仍未闭合：

- 各 primitive 普遍缺少 `after-dirfsync`；tombstone 缺少 trash 目录 fsync 完成后的点。
- `atomicFile:after-write`实际位于临时文件 fsync 之后，没有独立的原始 write 后/file fsync 前窗口。
- marker、`OUTCOME.json`、tombstone 的新边界没有测试。
- 现有 failpoint 测试仍只命中 `replaceTarget:before`、`marker:before`和`appendRecord:before`，新增关键点位完全未被消费。[failpoint.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/failpoint.test.mjs:35)
- 测试通过同进程抛异常模拟失败，不是子进程直接退出。普通 rollback 异常还会被转成 `CONFLICTED`，因此不能证明 kill-9/断电后的可恢复磁盘状态。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:169)

### 3. 手删 JSONL 已移除，但磁盘矩阵没有建立

已修复部分：

- 原先 `lines.pop()`再覆盖 JSONL 的 pending 测试已删除。
- pending 现在由公开 Journal 操作配合 failpoint 产生。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:51)

仍阻断：

- `failpoint.test.mjs`仍手工写 manifest、snapshot、op JSONL 和 target，只构造固定的 present→present 状态，不是通过 Journal API 形成的参数化矩阵。[failpoint.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/failpoint.test.mjs:11)
- 缺少 `INTENDED × current(expected/next/other)`完整磁盘矩阵。
- 缺少 present/absent 正反向、marker/outcome/tombstone 各窗口。
- 缺少崩溃后新进程首次恢复、二次恢复及 target/op/outcome/trash 最终不变量。
- 缺少“一个事务冲突，其余事务继续恢复”的矩阵。

### 4. 恢复终检和 restore-absent 代码已修，但 Phase 2 仍不完整

已修复：

- 写 `ROLLED_BACK` 前会逐目标确认等于 baseline。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:173)
- baseline absent 的 rollback 在 unlink 后重新读取，确认目标确实不存在后才追加 `CONFIRMED`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:204)

仍阻断：

- 没有 baseline absent → forward present → rollback absent 的集成测试；当前 absent 测试只覆盖纯 reducer。[reducer.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/reducer.test.mjs:102)
- 最终检查与写 `OUTCOME.json`之间没有 fence/CAS；并发修改仍可能落在两者之间。
- pending 二次核验、rollback 或终检发生冲突时仍 `return report`，会跳过后续事务。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:158)
- COMMITTED 路径遇到某个事务的 BAD_OP 也直接返回，而非继续处理其余预检事务。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:145)

### 5. COMMITTED target/reducer 校验已补，outcome 仍不是严格校验

已修复：

- COMMITTED 恢复会运行 reducer，并拒绝 pending。
- 会比较磁盘 current 与 reducer owned；目标被篡改时转为 conflict，而不是直接 tombstone。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:142)

仍阻断：

- outcome 仅检查 `outcome.outcome === 'COMMITTED'`，没有严格验证 `v === 1`、`txid`一致、对象类型和完整 schema。例如 `{outcome:"COMMITTED",txid:"other",v:0}`会被接受并 tombstone。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:150)
- JSON `null`、`false`、`0`等无效 outcome 会被视作缺失并覆盖，而不是报告 `BAD_OUTCOME`。
- 非法 JSON 会在 `scan()`解析时直接抛出，不能形成确定的逐事务恢复结果。
- 测试只覆盖 target 被篡改；没有 ROLLED_BACK outcome、非法 schema、txid/v 错配、缺失 outcome 的恢复用例。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:132)

上一轮阻断项 #5 还包含 resolution、restore plan、supersedes、validation、lock 和 conflict evidence。其实现文件不在本次允许读取范围内，因此本次不能将这些子项重新判定为已修复；这也不足以支持关闭该合并阻断项。

## 重要问题

1. **已修复：file state hash schema。** present hash 已严格限制为 `sha256:`加 64 位小写十六进制，absent 强制 `hash:null`。[reducer.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/reducer.mjs:6)

2. **未修复：`mode`和`length`。** reducer 只比较两 phase 的字段是否相同，不检查 present op 的 mode 格式、length 非负整数及必填关系。

3. **部分修复：failpoint registry。** 已加入 `times/count`，但仍为进程级全局 Map；测试没有 `afterEach`兜底，断言提前失败时可能污染后续测试。[failpoints.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/failpoints.mjs:2)

4. **未修复：异步 failpoint。** `failpoint()`直接返回 callback 结果，durable 调用方不 `await`；Promise barrier不能暂停 I/O 边界。[failpoints.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/failpoints.mjs:7)

5. **部分修复：reducer 测试覆盖。** 已补物理乱序、双 pending、phase 交错、expected mismatch和 absent state；仍缺 before 串链、显式 opId 错配、terminal 字段差异及恢复级 absent 测试。

## 建议优化

- 将每个 op 的 `before`写为开始该 op 前的 owned，并强制 `before === expected === previousOwned`。
- 收敛为唯一的 validated reducer 结果，移除 parse-only 的业务读取入口。
- 为每个 durable primitive补齐 after-file-fsync、after-dirfsync，并用 path/kind 区分 marker、outcome、tombstone。
- 用子进程命中 failpoint 后立即退出，再由新 Journal 实例重复恢复；矩阵从公开 API 生成，不手工拼装 manifest/JSONL。
- 将 Phase 2 的逐事务失败改为记录结果后 `continue`，避免一个事务阻断其余事务。
- 为 outcome 建立严格 validator，并区分“文件不存在”和“文件存在但内容为 null/非法 schema”。

本次未修改文件、未联网；只运行了纯 reducer 测试，结果通过。