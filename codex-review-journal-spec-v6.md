## 总体结论

**v5 的阻断项尚未全部解除，JOURNAL-SPEC v6 仍不建议冻结为 M2a contract。**

v6 的方向基本正确，尤其补上了全局预扫描框架、三阶段成功清理、validation evidence、resolution Phase 0、完整 op 字段和 LockPort 作用域。但目前仍存在会破坏单 owner、使成功终态无法继续清理、或允许绕过 validation 的 contract 级问题。

| v5 评审方向 | v6 状态 |
|---|---|
| 按 tx 全局归约与 supersedes | **部分解除**：有分组扫描，但把带终态 OUTCOME 的链头排除在“权威 resolution”之外 |
| journal + conflicts + resolution 清理 | **部分解除**：顺序正确，但终态选择错误使路径不可达，且未清理 superseded 祖先 |
| accept-current evidence/指纹续跑 | **部分解除**：崩溃续跑基本闭合，但 validation 来源仍可被调用方伪造 |
| resolution Phase 0 / 异常表 | **部分解除**：Phase 0 和 tmp-only 已补；异常表仍重叠、不完整、部分不可执行 |
| mode/op 元数据一致性 | **主要解除，仍有重要问题** |
| LockPort 生命周期 | **部分解除**：作用域已列明，但正常 acquire 不具备互斥性，fencing/失租约也未闭合 |

---

## 阻断项

### 1. “唯一 active rid”算法会排除成功/冲突终态，导致终态恢复与清理不可达

全局归约把 active 定义为“无 supersedes 指向且自身无终态 OUTCOME”，执行阶段又只处理“权威 resolution”。[§9.1](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:173) [§9.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:186)

可复现状态：

1. restore-snapshot 写入 `OUTCOME=RESOLVED`；
2. 在删除 journal 前崩溃；
3. 下次扫描时该 rid 因已有终态 OUTCOME，不是 active；
4. GlobalRecoveryPlan 得到 `resolution=none`；
5. 残留 conflict report 重新触发 CONFLICTED，而不是继续三阶段清理。

`ACCEPTED_CURRENT` 同样受影响。`RESOLUTION_CONFLICTED` 也被定义为终态，却又被称为可 supersede 的“active rid”，两处定义直接矛盾。[§8.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:156)

需要区分：

- `authoritative head`：supersedes 图中唯一未被后继指向的链头，**不论是否有 OUTCOME**；
- `executable active`：链头且没有终态 OUTCOME；
- `waiting authorization`：链头且为 RESOLUTION_CONFLICTED；
- `successful terminal`：链头且为 RESOLVED/ACCEPTED_CURRENT，必须继续清理。

同时必须校验循环、跨 tx supersedes、悬空引用、分叉和零链头，而不只是“多个 active”。

### 2. 成功清理仍未形成完整幂等闭环

三阶段顺序本身已经正确：[§8.4](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:163)

1. journal；
2. conflicts；
3. 当前 resolution。

但还有两个缺口：

- 新 rid 成功后只删除“本 resolution”，旧的 `SUPERSEDED` resolution 链仍永久残留；扫描也没有明确清理这些祖先。
- `tombstone` 目标是 `trash/<basename>-<ts>`。`journal/tx1` 与 `conflicts/tx1` 的 basename 相同；若时间戳粒度相同，第二次 rename 可与第一次冲突。[durable primitive](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:47)

应将目标命名改为带种类和随机唯一值，例如 `trash/journal-tx1-<nonce>`，并在成功时清理该 tx 的整个 resolution 链，最后删除 authoritative head。

### 3. LockPort 的正常 acquire 不保证单 owner

锁文件“创建/更新用 atomic-file”，但该 primitive 最后执行的是可替换现有目标的 `rename`。[atomic-file](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:49) [锁文件](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:211)

两个普通 acquire 可以分别创建 tmp，随后依次 rename 覆盖 `lock.json`，并都认为自己成功。只有 takeover step 5 使用了 `open(lock,'wx')`，正常 acquire 没有相同的排他创建规则。

此外还缺：

- heartbeat 周期和 stale 阈值；
- 每次 target/marker/OUTCOME 写入前如何用 `ownerToken + epoch` fencing；
- heartbeat 失败或 lease 被接管后，当前操作必须在什么点终止；
- `begin` 到 cleanup 跨多个 JournalPort 调用时，lease 如何关联、续租和最终释放；
- damaged lock 需要 force，但 `acquire(scope)` 没有 force/repair 参数。

在此修复前，§1 的单 owner 保证不成立。

### 4. target 写入没有明确引用 durable primitive

公共原语明确覆盖的是 journal/resolution/conflicts 文件，并未明确覆盖 profile target。[§4](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:47)

普通写协议只写“替换”或 `unlink`，没有规定：

- target tmp 写入及 file fsync；
- rename 后 target 父目录 fsync；
- delete 后父目录 fsync。

[§6.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:89) Resolution 的“写 target + confirmed”也有同样问题。[§8.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:137)

这会使 `CONFIRMED`/`RESOLVED` durable，而 target 本身可能在崩溃后丢失，直接破坏 G3/G4。不应依靠“替换”一词隐含这些步骤；需新增并统一引用 `replace-target` 和 `unlink-target-durable`。

### 5. accept-current 的 validation gate 仍可被绕过

指纹续跑逻辑本身已经成立：validation 后崩溃可按指纹补终态，指纹变化进入 RESOLUTION_CONFLICTED。[§8.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:147)

但公开接口允许调用方直接提交普通对象：

```ts
recordValidation(rid, evidence: BaselineReport & { fingerprint })
```

[JournalPort](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:246)

JournalPort 无法证明：

- BaselineValidator 确实被调用；
- report 表示 validation 成功；
- evidence 没有被调用方伪造；
- validation.json 没有被第二次覆盖以隐式重新授权。

F4 只规定入口名称，不能形成运行时约束。建议由 JournalPort/RepairService 的单一原子流程调用 validator、复核当前指纹并写 evidence；或者把 `recordValidation` 限为内部接口，并明确 evidence 只写一次、必须 `report.valid=true`、action 必须为 accept-current、写入时再次匹配当前指纹。

---

## 重要问题

### 1. Resolution 异常表仍不完整且存在规则重叠

[§9.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:199) 至少缺少：

- `OUTCOME=RESOLUTION_CONFLICTED`、`SUPERSEDED` 的正常动作；
- validation.json 损坏、rid 不一致、用于 restore-snapshot、或 baselineReport 表示失败；
- action 与 OUTCOME 不匹配，例如 restore 得到 ACCEPTED_CURRENT；
- supersedes 循环、跨 tx、悬空引用、一个 old 被多个 new supersede；
- plan target 集合与原 journal baseline 集合不一致；
- active restore resolution 的原 journal/snapshot 目录整体缺失。

“manifest 缺失”与“OUTCOME 成功但 manifest 缺失”两行也重叠；表格未说明优先级。后者声称“可从 rid 反查 txid”，但 rid 格式没有包含 txid，因此通常不可执行。[异常表](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:202)

### 2. conflict evidence 协议在 v6 中被删掉了

v6 仍调用 `archiveConflict`，但没有定义：

- current/absent evidence 如何落盘和校验；
- manifest、ops、snapshots 的复制顺序；
- report.json 必须最后写入；
- 中途崩溃目录如何识别；
- report 与 manifest.state 的权威关系。

[普通恢复](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:108) [接口](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:249)

这相对 v5 是规格回退。至少应恢复 v5 的 evidence-first、report-last 协议并引用公共 durable primitive。

### 3. mode/op 字段还存在三处不一致

- `absent→present` 一律使用 0600，但 rollback 恢复一个原本存在、随后被删除的 target 时，应恢复 `baseline.mode`；restore-snapshot 也没有明确使用 baseline.mode。[§6.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:89)
- 测试把“seq 跳变”列为 malformed，但正文仅规定严格递增；`1→3` 仍严格递增。需要明确 seq 是全 tx 连续递增，还是只要求唯一、有序。[链规则与测试](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:29)
- 正文说明 length/mode 描述 next，但链校验没有明确验证存在态的 length、mode 合法且与实际 next bytes 一致。

另外，“mode 差异尽力设置并记录”尚未说明记录到哪个 durable report/schema。

### 4. `atomic-file` 的 chmod/fsync 顺序不严谨

当前顺序是“fsync file → 设置 mode → rename”。mode 是在 fsync 之后修改的，其元数据不一定已 durable。[§4](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:49)

应改为写入 → 设置 mode → fsync file → rename → fsync dir，或 chmod 后再次 fsync file。

### 5. `recover(plan)` 的陈旧计划校验需要显式化

scan、Phase 0/1 和 validator 都允许无锁，正文笼统要求执行前复验。[LockPort 生命周期](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:230)

但 `recover(plan)` 接收的是外部计划。应明确持锁后必须重新验证：

- resolution 图和 authoritative head；
- journal/conflict/outcome 身份；
- op/manifest 摘要；
- 所有 planned current states。

任何结构变化都应丢弃旧 plan 并重新 scan，而不是继续部分执行。

### 6. 测试矩阵尚缺关键反例

建议至少新增：

- 成功 OUTCOME 写入后、首次 tombstone 前崩溃；
- RESOLUTION_CONFLICTED 链头的重新授权；
- supersedes 循环、分叉、跨 tx、悬空引用；
- 新 rid 成功后清理全部 superseded 祖先；
- journal/conflicts basename 相同导致 trash 冲突；
- 两个普通 acquire 同时竞争；
- heartbeat 更新与 takeover rename 竞争、lease 丢失后拒绝写；
- fabricated/repeated `recordValidation`；
- rollback absent→present 恢复 baseline.mode；
- target rename/unlink 各 durable 步骤崩溃。

---

## 建议优化

- 将 resolution 归约明确拆成“校验 supersedes 图 → 选 authoritative head → 按 OUTCOME 分派 → 生成清理集合”，避免继续混用 active、终态和权威三个概念。
- 给 manifest、OUTCOME、validation、report、GlobalRecoveryPlan 定义完整版本化 schema 和允许的状态组合。
- 明确 fingerprint 的 target 集合、rel 排序、UTF-8 编码、JSON canonicalization 算法及 hash 输入字节。
- 为所有 once-only 文件规定 `create-exclusive` 或不可变规则，避免 atomic replace 意外重写授权证据。
- 将测试断言写成最终可观察状态：target 内容、journal/conflicts/resolution/trash 是否存在、OUTCOME、锁 owner 和返回状态。

**结论不变：v6 不能冻结为 M2a contract。** 最优先应修复 authoritative-head/终态分派、正常锁获取互斥、target durable 写原语和 accept-current validation gate。