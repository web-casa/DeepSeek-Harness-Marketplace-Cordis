## 总体结论

**v5 仍不建议冻结为 M2a contract。**

v4 的 5 个阻断项中：

| v4 阻断项 | v5 状态 |
|---|---|
| accept-current 被 conflict report 遮蔽 | **部分解除**：独立 resolution 优先级成立，但清理后残留 report 会再次触发 CONFLICTED |
| RESOLUTION_CONFLICTED 重新授权 | **部分解除**：新增 SUPERSEDED/supersedes，但扫描选择规则不闭环 |
| resolution 成功清理顺序 | **部分解除**：先 journal、后 resolution 已明确，但遗漏 conflicts 目录及 tombstone 原语 |
| resolution 异常扫描 | **部分解除**：增加了分类，但仍有无法执行或误分类的崩溃状态 |
| accept-current 双接口 | **原问题已解除**：只剩一条公开路径，但验证结果与恢复接口仍未闭合 |

因此严格说是 **1 项解除、4 项部分解除**。六个重点方向目前均仍有 contract 级缺口，主要集中在 resolution 全局归约、成功清理、accept-current 续跑、元数据相等性和锁作用域。

## 阻断项

### 1. `SUPERSEDED + supersedes` 没有形成确定的全局扫描归约

规格一方面规定旧 rid 的 `RESOLUTION_CONFLICTED` 要“停止”，另一方面又规定新 manifest 的 `supersedes` 可以使旧 rid 失效；但扫描是“对每个 rid”执行，没有先按 tx 汇总并归约关系。[§7.2](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:145) [§7.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:171)

若扫描先遇到旧 rid：

1. 旧 rid 有 `OUTCOME=RESOLUTION_CONFLICTED`；
2. 新 rid 已存在且 `supersedes=旧 rid`；
3. 表格会先在旧 rid 上“停止”，未必会读取新 rid。

“无 OUTCOME，manifest.supersedes 指向它”也不清楚是当前 manifest 还是其他 rid 的 manifest。冻结前需要按 tx 做一次无副作用预扫描：校验全部 rid、构建 supersedes 链、失效被 supersede 的节点、确定唯一权威 active rid，然后才能执行动作。

### 2. 成功清理遗漏 `conflicts/<txid>`，会重新回到 CONFLICTED

成功路径只规定先 tombstone 原 journal，再 tombstone resolution。[清理顺序](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:166)

但 conflict report 位于独立的 `conflicts/<txid>/report.json`，不属于 `journal/<txid>`。[目录布局](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:36) 当 resolution 被删除后，下一次扫描将满足“report 存在且无 resolution”，再次判为 CONFLICTED。[全局扫描第 3 项](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:185)

成功清理必须明确处理 conflict 目录，例如：

1. durable tombstone/archive `journal/<txid>`；
2. durable tombstone 或转存 `conflicts/<txid>`；
3. 最后 tombstone resolution。

此外，“tombstone”仍未定义为具体的 rename、源/目标目录 fsync、目标命名和源已不存在时的幂等规则。

### 3. `accept-current` 崩溃续跑路径和接口数据流不成立

无 OUTCOME 的 resolution 统一“按 §7.2.2 继续执行”，但 §7.2.2 只描述 restore-snapshot。[扫描兜底](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:183) accept-current 在 manifest 持久化后、validator 前崩溃时，没有定义扫描应重新调用 validator 还是进入什么状态。

同时：

```ts
completeResolution(rid)
```

没有参数承载 `BaselineReport`，resolution 内也没有 durable validation marker，因此 JournalPort 无法区分：

- validator 已通过；
- validator 尚未运行；
- validator 通过后 profile 又发生变化；
- 调用方绕过 validator 直接 complete。

[接口与唯一流程](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:230) 必须让扫描按 durable `action` 分派，并明确验证是在 `completeResolution` 内完成，还是持久化带 profile 指纹的 validation evidence。

### 4. resolution 异常分支仍不完整

至少还有三类缺口：

- restore-snapshot 没有普通恢复那样的全 target snapshot Phase 0；可能先恢复部分 target，随后才发现另一个 snapshot 缺失或损坏。
- snapshot 缺失、hash/length/mode 不符没有出现在 resolution 异常表中。
- 仅有 `*.tmp`、尚未生成 manifest 的新 resolution 是正常创建崩溃状态，目前却一律判为 UNRECOVERABLE。[异常表](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:171)

另外，`OUTCOME=RESOLVED|ACCEPTED_CURRENT` 但 manifest 缺失时，扫描甚至无法取得 txid 来清理原 journal；表格中“成功 OUTCOME”和“manifest 缺失”两条的优先级因此不可执行。

### 5. snapshot 元数据与 op 链仍不自洽

数据模型虽然补上了 baseline length，但仍有以下契约歧义：[数据模型](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:23) [op 不变量](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:63)

- `FileState` 不包含 mode，所有 `current==next/before` 判断只比较 exists/hash；外部只改 mode 时仍会被判为 DONE/RESOLVED。
- “snapshot 的 mode 匹配”语义不成立：snapshot 文件自身固定为 0600，原 target mode 存在 manifest 中。应明确是校验 baseline.mode 合法，还是把 mode 纳入物理状态比较。
- delete 或 rollback-to-absent 时，op 的 `length`、`mode` 应缺省还是保留未定义。
- 同一 opId 的 INTENDED/CONFIRMED/CANCELLED 只规定共享 seq，未规定 expected、next、before、kind、mode、length 必须完全一致。
- schema 示例没有 `txid`、`targetKey` 字段，校验规则却要求其一致。

这些会让不同实现接受不同的 op 链，不能作为冻结 contract。

### 6. 锁只定义了算法，没有定义生命周期边界

takeover CAS 的局部边界基本补齐，但规格没有规定哪些 JournalPort 操作负责 acquire/release，以及锁要覆盖多长时间。[锁协议](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:208)

当前只明确普通恢复 Phase 2 持锁；以下写操作的整体边界不明确：

- `begin → write/delete → commit/rollback → cleanup`；
- archiveConflict、OUTCOME、tombstone；
- resolution 的 supersede、创建、执行、complete、清理；
- trash 和 stolen 遗留物清理；
- accept-current 的 validator 是否处于同一授权/锁区间。

“每次写前 fencing”不能替代锁生命周期契约。还应定义 lock 内容创建的 fsync、损坏/截断 lock、takeover 在 rename 后崩溃但 lock 路径不存在时的处理。

## 重要问题

### 1. durable 写原语仍不统一

普通 CONFIRMED 在 v5 中只写成“追加 CONFIRMED”，v4 原有的 append+file fsync+directory fsync 被删掉了。[写协议](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:84) RESOLVED、ACCEPTED_CURRENT、RESOLUTION_CONFLICTED 的 OUTCOME 也没有统一引用 durable marker 原语。

建议所有 manifest、op、marker、OUTCOME、report 和 tombstone 都引用一组公共原语，避免每节各自省略 durability 条件。

### 2. ResolutionPlan/op schema 不足以实现一致校验

规格没有给出 resolution op 的完整字段、版本、target 集合、mode/length 来源，以及 confirmed marker 的内容。`completeResolution` 也没有明确必须重新终检全部 target 后才能写成功 OUTCOME。

### 3. 接口类型仍过于宽松

`beginResolution(action, plan?)` 允许 restore-snapshot 不传 plan，也允许 accept-current 传 plan；`resolveTarget` 对 accept-current 是否非法没有规定。宜改成 discriminated request，并明确每种非法调用对应的错误和 durable 状态。

### 4. 测试矩阵尚未闭合

新增矩阵覆盖了 v4 指出的多数标题，但还缺：

- 新 rid 已 supersede 旧 rid、旧 OUTCOME 丢失时的不同枚举顺序；
- 成功 resolution 清理 conflict 目录的每个崩溃点；
- accept-current 在 manifest、validator、validation evidence、OUTCOME 各点崩溃；
- resolution snapshot 任一损坏时全 target 零写入；
- target 仅 mode 改变、delete/absent 元数据组合；
- resolution 目录仅有 tmp；
- 完整锁生命周期及损坏 lock。

而且“S5b/S5c 全部实测场景”依赖外部材料，与“测试矩阵自包含”的标题不一致。[测试矩阵](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:258)

## 建议优化

- 将扫描改成“按 tx 分组的证据归约表”，先验证并选择唯一权威 resolution，再执行副作用。
- 定义公共 durable primitives：atomic-file、append-record、marker、tombstone-directory。
- 将 mode 纳入可观察状态，或明确 mode 只是写入属性、不属于一致性和 RESOLVED 不变量。
- 为 accept-current 增加 durable validation evidence/profile fingerprint。
- 为 resolution 恢复增加与普通恢复相同的全量 snapshot Phase 0。
- 补齐 Manifest、ResolutionPlan、ResolutionOp、Outcome、RecoveryReport 的版本化 schema。
- 修正 §1 中“遵守 §9 锁协议”的编号；锁协议实际位于 §10。

本轮未修改文件、未联网；项目内容仅检查了指定规范、v4 评审和指定 diff。