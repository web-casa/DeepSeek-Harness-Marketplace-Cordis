## 总体结论

**v6 的阻断项没有全部解除，JOURNAL-SPEC v7 目前仍不能冻结为 M2a contract。**

v7 修复了三项核心基础问题：

- authoritative head 不再排除成功终态；
- 普通 acquire 改为排他创建；
- target durable 原语及 `chmod → fsync file → rename → fsync dir` 顺序正确。

但 resolution 清理、正常恢复、lease fencing 和 validation 来源约束仍存在 contract 级断点。

| 重点 | 评审结论 |
|---|---|
| authoritative head / 祖先清理 | **部分解除，仍阻断** |
| 普通 acquire / lease 生命周期 | **acquire 已修，lease 未闭合** |
| target durable / chmod-fsync | **基本解除** |
| validation once-only gate | **once-only 已修，validator gate 未闭合** |
| 冲突证据 / 全局扫描 | **部分解除** |
| 测试矩阵 / 接口 | **不满足冻结条件** |

## 阻断项

### 1. authoritative head 的清理和 supersede 事务仍不具备崩溃闭环

有两个独立问题。

第一，创建新 resolution 时先把旧 head 写成 `SUPERSEDED`，再创建新 manifest。[JOURNAL-SPEC.md:149](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:149)

若两步之间崩溃：

1. 旧 rid 仍是唯一 authoritative head；
2. 其 OUTCOME 已是 `SUPERSEDED`；
3. 分派规则却将 `SUPERSEDED` head 判为 `executable active`。[JOURNAL-SPEC.md:157](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:157)
4. 系统既不知道尚未落盘的新 resolution 请求，也可能错误续跑已被撤销的旧授权。

应先原子创建带 `supersedes` 边的新 manifest，再将旧 OUTCOME 作为可补写信息；或者增加独立的 supersede intent。`SUPERSEDED` head 不应直接 executable。

第二，成功清理先删除祖先、最后删除 head。[JOURNAL-SPEC.md:163](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:163) 删除任一祖先后崩溃，head 的 `supersedes` 链会出现悬空引用，而扫描规则又规定悬空引用一律 `UNRECOVERABLE`。[JOURNAL-SPEC.md:152](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:152)

这与“下次扫描仍以 head 终态继续清理”的声明直接矛盾。需要：

- 持久化完整 cleanup plan/祖先列表；或
- 规定祖先按 oldest→newest 删除，并为成功终态清理定义可识别的“已删除链尾”例外。

### 2. 普通事务恢复路径出现功能性回退

未提交恢复现在只写“生成 ROLLBACK op”，没有再规定执行 §6.2、durable 修改 target 并追加 CONFIRMED。[JOURNAL-SPEC.md:101](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:101)

仅生成 op 无法保证后面的“全达 before”。必须明确：

`append INTENDED → fencing/current 复核 → replace/unlink durable → 复读 → append CONFIRMED`。

同时，COMMITTED 恢复路径只规定失败时进入 CONFLICTED，没有规定成功时写 `OUTCOME=COMMITTED` 并 tombstone。[JOURNAL-SPEC.md:105](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:105) 这会使已提交 journal 永久反复进入提交恢复路径。

### 3. 正常 acquire 已互斥，但 lease/fencing 仍不足以保证单 owner

排他创建修复是正确的：[JOURNAL-SPEC.md:211](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:211)。但后续生命周期仍有缺口：

- 活 owner 且 heartbeat stale、dead owner 但 heartbeat 未 stale 两种组合没有定义结果。应明确“owner 活 **或** heartbeat 未 stale 均不得接管”，只有 dead **且** stale 才可 takeover。
- heartbeat 使用普通 `atomic-file` 替换。[JOURNAL-SPEC.md:216](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:216) 它不是基于 `ownerToken + epoch` 的 CAS，无法满足正文自己的 heartbeat/takeover 竞争测试。
- “lease 被接管后停止”没有定义如何检测；当前 heartbeat 的无条件替换甚至可能重新覆盖新 owner。
- fencing 只在普通写协议中出现一个词，未覆盖 resolution target、marker、OUTCOME、confirmed、tombstone 等全部写步骤。
- `begin→cleanup` 跨多个 JournalPort 调用，但接口没有定义 tx 与 lease 的绑定、后台续租以及异常释放规则。

因此 §1 的“进程单 owner”仍不能由当前规范推出。

### 4. validation 文件 once-only 已成立，但 validator gate 仍可绕过

`exclusive`、重复调用拒绝、写入时复算 fingerprint，这些已修复。[JOURNAL-SPEC.md:123](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:123)

未闭合的是 validation 的语义来源：

- `recordValidation` 仍公开接收普通结构体，调用方可直接构造 `valid:true` 和当前 fingerprint。[JOURNAL-SPEC.md:255](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:255)
- JournalPort 只复算 fingerprint，不能证明 `baselineReport` 来自 BaselineValidator，也不能证明报告实际通过。
- `BaselineValidatorPort` 的返回类型甚至没有明确成功判定字段。[JOURNAL-SPEC.md:260](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:260)
- 所谓“单一原子流程”实际上是多个公开调用组成的约定，并非接口 gate。

应将 `recordValidation` 降为内部能力，或提供一个由 JournalPort/RepairService 内部调用 validator 的单入口；也可以使用不可伪造的 `ValidationTicket`。失败报告必须明确禁止进入 journal。

### 5. 测试矩阵和接口不是自包含 contract

标题声称“自包含”，但 D1–D13、E1–E10、F1–F4、G1–G5 都只写“v6 保留”，没有在 v7 中列出场景和断言。[JOURNAL-SPEC.md:270](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:270) 冻结后的 v7 不能依赖上一版文本补充规范含义。

此外，v7 将多项接口参数类型删成隐式 `any`，且没有定义关键返回值、错误枚举、lease 关联和状态组合。[JOURNAL-SPEC.md:242](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:242)

至少还缺以下显式测试：

- 写旧 `SUPERSEDED` 后、新 manifest 前崩溃；
- 删除每一层祖先后重新扫描；
- `RESOLVED` 与 `ACCEPTED_CURRENT` 的完整清理崩溃点；
- validator 未运行但提交正确 fingerprint；
- conflict archive 的每个复制/report/state 崩溃点；
- target rename、unlink、目录 fsync 内部崩溃点；
- live+stale、dead+fresh 及 heartbeat/takeover 的明确预期结果。

## 重要问题

### 1. 冲突证据协议的 report-last 语义自相矛盾

协议规定 evidence 全部复制并校验后，最后写 report；随后又说“report 存在 → 补全 evidence”。[JOURNAL-SPEC.md:108](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:108)

如果 report 真正是 durable commit point，那么合法崩溃不应产生“report 存在但 evidence 不完整”。这种状态应判为损坏/`UNRECOVERABLE`，不能用当前 target 补写历史证据，否则会改变冲突现场。

全局扫描目前也只检查 report 是否存在，没有定义：

- report schema/version、txid/targetKey 绑定；
- evidence 摘要与文件的重新校验；
- malformed report；
- 无 report 的半成品 conflict 目录如何归约。

### 2. target durable 原语正确，但若干调用点仍不完整

`replace-target`、`unlink-target-durable` 以及 chmod/fsync 顺序本身正确。[JOURNAL-SPEC.md:45](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:45)

仍需补充：

- restore-snapshot 的 `replace-target` 必须明确使用原 `baseline.mode`；当前 resolution plan 不带 mode，执行段也没有规定从 baseline 取 mode。
- resolution 的 confirmed 删除应使用 durable metadata unlink。
- OUTCOME、confirmed 等位置只写了赋值或“补 confirmed”，没有统一声明必须使用 `atomic-file`/`marker`。
- `marker(path)` 未传必填的 `mode`；应定义默认 0600或显式传入。

### 3. 异常表与状态定义仍有不可执行规则

“manifest 缺失即 UNRECOVERABLE”和“成功 head manifest 缺失且无法反查 txid”仍然重叠；没有 manifest 时通常也无法建立 head。[JOURNAL-SPEC.md:194](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:194)

另外：

- active restore 的原 journal 整体缺失没有显式判定；
- OUTCOME 的版本化 schema、允许 action/OUTCOME 组合未定义；
- `PLAN-v4 DIRTY 映射见 §2` 是失效引用，§2 没有该映射。[JOURNAL-SPEC.md:69](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:69)

## 建议优化

- 将 resolution 流程固定拆成：图校验 → authoritative head → OUTCOME 分派 → durable cleanup plan → 清理。
- 为 manifest、OUTCOME、report、validation、GlobalRecoveryPlan 和全部错误码给出完整版本化 schema。
- 将测试矩阵改成每项都有初始磁盘状态、崩溃点、返回值和最终可观察状态；不要引用 v6。
- 用显式 `LockSession/TxSession` 表达 lease 所有权，避免依靠 JournalPort 内部隐式关联。

**最终结论：v7 不能冻结为 M2a contract。** 优先修复 resolution supersede/祖先清理闭环、普通恢复成功路径、lease CAS/fencing，以及不可绕过的 validation gate。