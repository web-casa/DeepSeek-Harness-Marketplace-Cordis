## 总体结论

**不建议进入 S5。S1–S4 仍未达到可冻结 JournalPort 的条件。**

10 个上一轮阻断项中：

- 已修复：0
- 部分修复：8
- 未修复：2

| # | 阻断项 | 复审结论 |
|---|---|---|
| 1 | op 格式与 op 链校验 | 部分修复 |
| 2 | 普通恢复 Phase 2 复核 | 部分修复 |
| 3 | COMMITTED 校验与续清理 | 部分修复 |
| 4 | resolution Phase 0 | 部分修复 |
| 5 | restore plan 集合 | 部分修复 |
| 6 | supersedes/head 图 | 部分修复 |
| 7 | validation gate | 部分修复 |
| 8 | lock CAS/fencing | **未修复** |
| 9 | conflict evidence | 部分修复 |
| 10 | freeze-gate 测试覆盖 | **未修复** |

Freeze gate 对应判断：

| Slice | 对应 gate | 当前判断 |
|---|---|---|
| S1 | G8 target durable | **未达到**：目标替换/删除路径基本统一，但 confirmed 删除仍是内联实现，且没有故障矩阵证明所有 durable 边界 |
| S2 | G3 普通恢复 | **未达到**：COMMITTED 和部分 Phase 2 已补强，但 rollback-delete、最终宣告和 op 链仍不闭合 |
| S2 | G9 conflict evidence | **未达到**：report commit point 后不验证 evidence 完整性 |
| S3 | G5 validation gate | **未达到**：fingerprint/once-only 已修，但 validator 结果仍可由调用者伪造 |
| S3 | G8 resolution durable | **部分实现但未达到**：restore 使用 durable target primitive，缺少完整故障验证 |
| S4 | G4 lease CAS/fencing | **未达到**：heartbeat 仍是 check-then-overwrite，不是 CAS；全写步骤 fencing 仍不完整 |

因此，**不能把 S1–S4 视为验收完成，也不能进入以“已通过前置 gate”为前提的 S5**。可以继续建设 S5 的 failpoint/kill-9 测试基础设施，但只能作为返工工具。

## 阻断项

### 1. op 格式与 op 链校验：部分修复

已修复：

- INTENDED 与 CONFIRMED/CANCELLED 现在复用同一个 `op`，因而共享 `seq/opId`。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:49)
- 新增 happy-path 测试验证二者标识相同。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:118)

仍阻断：

- `#readOps()`仍只验证 `v/txid/targetKey/phase`，未验证 seq 连续性、opId/seq 配对、INTENDED 后合法 phase、双 pending、孤立 CONFIRMED、kind、before/expected/next 链等。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:35)
- `#ownedBefore()`仍信任任意 CONFIRMED 记录。
- `#beginOp()`把每个 op 的 `before` 固定写成 manifest baseline，而不是当前 owned state；第二次及以后写入的链语义仍然错误。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:52)

损坏或伪造的尾部 CONFIRMED 仍可能影响恢复及 COMMITTED 校验。

### 2. 普通恢复 Phase 2：部分修复

已修复：

- planned CANCELLED/CONFIRMED 在 append 前会重新读取 current。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:154)
- restore-present rollback 在写入后会复读目标，再追加 CONFIRMED。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:190)

仍阻断：

- restore-absent rollback 在 `unlinkTargetDurable()` 后没有复读 `current==next`，直接追加 CONFIRMED。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:201)
- CANCELLED 后若无需 rollback，会直接写 `OUTCOME=ROLLED_BACK`，没有最终全目标复核；append 后发生竞争写仍可能被错误宣告成功。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:155)
- 所有 rollback 完成后、写 ROLLED_BACK outcome 前没有最终复核。
- 单个事务 Phase 2 冲突时直接 `return report`，后续已预检事务不再处理。

G3 尚未闭合。

### 3. COMMITTED 校验：部分修复

已修复：

- 现在只以 COMMITTED marker 进入提交恢复路径，不再把单独的 OUTCOME 当提交权威。
- 会检查每个 target 的最后 op 为 CONFIRMED，且 current 等于 last.next。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:127)
- marker 后缺 OUTCOME 时会补写，并 tombstone journal。

仍阻断：

- 校验依赖宽松的 `#readOps()`；孤立或非法 CONFIRMED 仍可能被当成 last op。
- 如果 marker 存在但 OUTCOME 已存在且值为 `ROLLED_BACK` 或其他非法值，代码仅检查它是否 truthy，不会校正为 COMMITTED，也不会判损坏，随后仍会 tombstone。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:148)
- OUTCOME/schema/状态组合没有严格验证。
- 补 OUTCOME、tombstone 等写步骤没有完整 fencing。

所以不能认定 G3 已通过。

### 4. resolution Phase 0：部分修复

已修复：

- `beginResolution()`在创建 resolution 前会全量检查 snapshot 的存在性、hash 和 length，损坏时不会先覆盖 target。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:53)
- `resolveTarget()`写前也会再次检查当前 snapshot。
- 新增了“损坏 snapshot 不产生 restore 写”的测试。[resolution.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/resolution.test.mjs:130)

仍阻断：

- 全量 Phase 0 只在 `beginResolution()`执行。resolution 创建后或进程重启前若其他 target snapshot 损坏，恢复可以先写前面的 target，之后才在另一个 target 上报错。
- 未校验 snapshot/baseline mode。
- 恢复已有 resolution 时没有重新执行“所有 snapshot 成功后才能开始任何 target 写”的全局边界。

因此数据覆盖顺序问题有所缓解，但 Phase 0 尚不完整。

### 5. restore plan 集合：部分修复

已修复：

- API 创建时会检查 `plan keys == baseline keys`。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:53)
- 新增了传入子集 plan 被拒绝的测试。[resolution.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/resolution.test.mjs:125)

仍阻断：

- `completeResolution()`不重新检查磁盘 manifest 中的 plan 集合。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:138)
- 若落盘 manifest 被截断或篡改为空 plan，循环为空，仍可直接写 `RESOLVED`。
- 没有把此类已落盘非法 plan 归为 `UNRECOVERABLE`。
- plan 每项的 expected/next schema，以及 `next == baseline state` 也没有严格验证。

D18 类场景仍存在。

### 6. supersedes/head 图：部分修复

已修复：

- 新增 dangling、cycle、multiple-head 检查。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:26)
- 成功 terminal head 不允许再 supersede。
- 新 manifest 先落盘，旧 SUPERSEDED 作为可补写信息，顺序符合 G1 方向。
- 新增自环测试。

仍阻断：

- 无 outcome 的活动 head仍允许被 supersede；并未限定旧 head 必须是 `RESOLUTION_CONFLICTED`。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:75)
- lock 是可选参数；默认构造没有锁。两个并发 `beginResolution()`仍可同时看到同一个 head，然后各自创建新 head。
- 没有 head CAS 或按 tx 的原子发布机制。
- `cleanupTerminal()`不先调用完整图校验；遇到 dangling 会静默停止，跨 tx 边也没有 txid 检查。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:176)
- 没有启动扫描时自动续清理闭环。

图的静态检查有所增强，但并发唯一性和清理安全性仍未解决。

### 7. validation gate：部分修复

已修复：

- fingerprint 改为 canonical object JSON。[state.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/state.mjs:12)
- current fingerprint 现在使用当前 resolution 的 tx，不再从所有 resolution 推导 tx。
- validation 使用 exclusive create，重复记录转换为 `JOURNALLED`。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:120)
- complete 时会重新比较 fingerprint。

仍阻断：

- 调用者仍可自行传入 `{valid:true, baselineReport:{ok:true}}`；实现无法证明结果来自 BaselineValidator。
- 测试本身仍直接构造该对象，明确证明公开 API 可绕过 validator。[resolution.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/resolution.test.mjs:72)
- baselineReport 没有版本化 schema、validator 身份或不可伪造凭据。

G5 的核心条件仍不成立。

### 8. lock CAS/fencing：未修复

核心阻断仍原样存在：

- heartbeat 先读取并比较 token/epoch，随后调用普通覆盖式 `atomicFile()`；检查与 rename 之间发生 takeover 时，旧 owner 仍会覆盖新 lock。这不是 CAS。[lock.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/lock.mjs:50)
- takeover 同样是“先读、再 rename 路径”。rename 针对的是路径当时的内容，并不保证仍是之前读到的 inode；竞争者可能搬走新 owner 的 lock。
- `ownerAlive()`仍只用 PID，不验证 bootId/processStartToken 对应的真实 OS 进程身份。[lock.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/lock.mjs:12)
- `bootId`每次 acquire 随机生成，`processStartToken`只是模块加载时随机值，均不是系统启动/进程启动身份。
- fencing 虽已增加，但 `#beginOp()`的 INTENDED append、commit 后的 manifest/OUTCOME、recover outcome、archiveConflict、completeResolution outcome 等写步骤仍没有紧邻写入的 fence。
- lock 仍是可选的；没有 `withLock`、force 语义或 stolen 文件清理。

G4 明确未达到。

### 9. conflict evidence：部分修复

已修复：

- 现在复制 manifest、ops、snapshots 和冲突 target。
- target evidence 写后会做 hash 比较。
- report 写入后更新原 manifest 为 CONFLICTED。
- 已存在 report 时，普通 recover 不再重新恢复 target。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:128)

仍阻断：

- `recover()`只检查 report 是否存在，不检查 evidence 是否完整。report 存在但 evidence 缺失时返回 `CONFLICTED_EXISTING`，而不是 `UNRECOVERABLE`。
- manifest/ops/snapshots 使用 `copyFileSync`，没有逐文件 hash、目录 fsync 或 evidence 摘要。[journal.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:208)
- report 不记录检测阶段和完整 evidence 清单。
- 并发或 report 之前崩溃时，下一次 archive 仍可覆盖已有 evidence；没有 once-only 发布协议。
- report 可能已经 durable，而前面的 `copyFileSync` 内容并未 durable，正好违反 G9 的 commit-point 要求。

G9 未达到。

### 10. 测试覆盖：未修复

新增了一批有价值的单元回归测试，包括 opId/seq、COMMITTED target 篡改、existing report、plan 子集、snapshot 损坏、supersedes 自环和 `JOURNALLED`。

但 freeze-grade 测试框架仍不存在：

- 没有 deterministic failpoint。
- 没有 kill -9 durable boundary 测试。
- 没有模型不变量或自包含磁盘状态矩阵。
- pending 仍通过直接删 JSONL 行模拟。[journal.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/journal.test.mjs:50)
- 没有非法 op 链、孤立 CONFIRMED、双 pending、seq 断裂测试。
- 没有磁盘 manifest 空 plan/D18 测试。
- supersedes 只覆盖自环，未覆盖并发双 head、跨 tx、dangling、fork、cleanup crash。
- dual takeover 仍是概率型并发测试，没有确定性控制 rename/create 窗口。[lock.test.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/test/lock.test.mjs:35)
- 没有 heartbeat/takeover CAS 竞争、每写步骤 lease 丢失测试。
- 没有 report 已存在但 evidence 缺失的 G9 测试。

因此 G6/G10 仍不能证明任何 freeze gate 通过。

## 重要问题

1. tombstone 路径已改到统一 `<root>/trash`，`Journal.scan()`误扫 trash 的问题已解决；但 tombstone 后不递归删除，trash 会永久增长。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:53)

2. durable primitive 有明显改善：`fsyncDir()`不再吞错、`replaceTarget()`会创建父目录。但临时文件在 write/chmod/fsync/rename 失败后仍不清理，也没有父目录 `lstat`/no-follow 防护。[durable.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/durable.mjs:5)

3. confirmed marker 删除现在 fsync 了正确目录，但仍直接使用 `unlinkSync + fsyncDir`，没有复用统一 durable metadata primitive。[resolution.mjs](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/resolution.mjs:101)

4. `completeResolution()`会覆盖已有 OUTCOME，terminal outcome 不是 once-only；成功后 target 再被修改并重复 complete，可能把既有结果改成冲突。

5. 接口仍不完整：缺少显式 `rollback(tx)`、`recover(plan)`、GlobalRecoveryPlan、`FileLock.withLock`；`deleteTarget`也未体现稳定的 `JournalPort.delete` 契约。

6. manifest/recovery/outcome/report/validation/plan 都没有统一的版本化 schema reducer，非法状态多数表现为宽松接受、普通异常或局部错误码，而不是确定的 `UNRECOVERABLE`。

## 建议优化

- 优先实现严格、纯函数式的 op/recovery reducer；任何磁盘写之前先把完整链解析成不可变 plan。
- 将 lock 改为真正具备 inode/版本条件的 CAS 协议，并强制 Journal 与 ResolutionJournal 的所有写入口持锁。
- 在 resolution 的每次恢复执行前重新做全量 Phase 0，并在 complete/cleanup 前重新验证 plan 与 supersedes 图。
- validation 不应接受外部构造的成功对象；应由内置 BaselineValidator 执行并直接落盘 once-only evidence。
- 为 conflict archive 建立 evidence manifest：文件清单、hash、length、检测阶段；最后 exclusive 发布 report。读取 report 时先验证 evidence，缺失即 `UNRECOVERABLE`。
- 下一轮验收应先补 deterministic failpoint、kill-9 和磁盘状态矩阵，再讨论 freeze。

本次为静态只读复审；未修改文件、未联网，也未运行会写入临时目录的测试。