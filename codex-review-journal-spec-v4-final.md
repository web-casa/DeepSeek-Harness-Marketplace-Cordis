## 总体结论

**v4 仍不建议冻结为 M2a contract。**

v3 的核心阻断项中，**takeover CAS** 与**普通事务 Phase 0 snapshot 预检**已经实质解除；普通 reducer 继续成立。独立 resolution journal 已解决“复用普通 op 链”的结构性错误，但它的失败重试、终态清理和异常扫描尚未闭环。扫描决策表还存在一个明确冲突：`ACCEPTED_CURRENT` 会被更高优先级的 conflict report 遮蔽。

| 重点 | v4 结论 |
|---|---|
| 独立 resolution journal | **结构成立，生命周期未闭环** |
| 扫描优先级 | **不完整且存在冲突** |
| takeover CAS | **FULL 平台核心协议成立**，仍需补齐边界规则 |
| 普通事务两阶段 + snapshot 预检 | **核心成立**，但元数据 schema 有矛盾 |
| 接口与测试矩阵 | **未闭合** |
| 是否可冻结 | **否** |

S5b 证明了首次恢复、mid-resolve、部分冲突和 RESOLVED 后续清理的原型路径；S5c 也验证了双 repair 竞争的核心机制。但两个 spike 都没有覆盖下述契约缺口。[S5b RESULT](/home/ivmm/daohang/toolso-ai-open/cordis-mp/spikes/S5b/RESULT.md:8) [S5c RESULT](/home/ivmm/daohang/toolso-ai-open/cordis-mp/spikes/S5c/RESULT.md:11)

## 阻断项

### 1. `accept-current` 终态被 conflict report 遮蔽

`accept-current` 成功后先向原 journal 写 `OUTCOME=ACCEPTED_CURRENT`，再 tombstone。[JOURNAL-SPEC.md:187](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:187)

但扫描顺序先检查 conflict report，再检查 OUTCOME：

- report 存在即权威 CONFLICTED；
- 下一步才处理 `ACCEPTED_CURRENT`。[JOURNAL-SPEC.md:99](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:99)

因此在“ACCEPTED_CURRENT 已持久化、tombstone 前崩溃”时，重启会再次停在 CONFLICTED，而不是续清理。这是决策表的直接冲突。

冻结前必须规定一种唯一规则，例如：经校验的授权终态 OUTCOME 优先于旧 conflict report，或让 accept-current 也通过独立 resolution journal 完成。

### 2. `RESOLUTION_CONFLICTED` 后没有可执行的重新授权协议

当前规则在 `OUTCOME=RESOLUTION_CONFLICTED` 时停止等待重新授权，但没有说明重新授权后如何继续：[JOURNAL-SPEC.md:181](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:181)

- 原 plan 是 immutable，冲突 target 的 current 已经不再匹配旧 expected；
- 未定义是复用 rid、创建新 rid，还是 supersede 旧 rid；
- 未定义旧 resolution 如何 tombstone；
- 多个 rid 指向同一 tx 时扫描谁；
- 旧的 conflicted resolution 仍具有最高扫描优先级，可能永久挡住新动作。

所以独立 journal 的“首次执行和续跑”成立，但“冲突—重新授权—最终收敛”尚未闭环。

### 3. resolution 成功清理的崩溃顺序没有定义

成功后规定“resolution 与原 journal 一并 tombstone”，但没有规定两个目录的先后顺序及每步 fsync。[JOURNAL-SPEC.md:180](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:180)

如果先移走 resolution、再移原 journal，中间崩溃，重启只会看到原 journal 的 conflict report，于是退回 CONFLICTED，已经写入的 RESOLVED 权威信息却丢失。安全顺序应明确为：保留 resolution OUTCOME，先 durable tombstone 原 journal，再 tombstone resolution。

此外，正文没有定义 tombstone 的 rename、源/目标目录 fsync 协议；只有测试矩阵提到“双目录 fsync”。[JOURNAL-SPEC.md:267](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:267)

### 4. resolution 的最高优先级异常分支未定义

普通 OUTCOME 已规定无效、截断、未知枚举进入 UNRECOVERABLE；resolution 扫描却只处理：

- RESOLVED；
- RESOLUTION_CONFLICTED；
- 无 OUTCOME。[JOURNAL-SPEC.md:183](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:183)

以下最高优先级状态没有结论：

- resolution 目录存在但 manifest 缺失、截断或未知版本；
- OUTCOME 损坏或未知；
- op 损坏或与 immutable plan 不一致；
- confirmed 存在但 op 不存在；
- rid/txid/targetKey 不一致；
- 同一 tx 存在多个 resolution。

因为 resolution 优先于普通 journal，这些不是可延后处理的文档细节，而会直接令恢复行为未定义。

### 5. `accept-current` 接口同时定义了两条互斥路径

接口允许：

```ts
beginResolution(tx, 'accept-current')
completeResolution(rid)
```

且说明 `completeResolution` 根据 durable `plan.action` 写 `ACCEPTED_CURRENT`。[JOURNAL-SPEC.md:241](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:241)

但：

- manifest schema 只展示 `action:"restore-snapshot"`；
- §7.3 使用独立的 `acceptCurrent(tx, baseline)`；
- RepairService 也绕过 `beginResolution/completeResolution`，直接调用 `acceptCurrent`。[JOURNAL-SPEC.md:253](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:253)

M2a port contract 无法据此确定哪条才是权威流程。冻结前应二选一并删除另一套语义。

## 重要问题

### 1. 普通事务恢复核心成立，但 snapshot 元数据无法按正文实现

Phase 0 已满足“全量预检、任一失败时零 target 写入”，因此 v3 对普通自动回滚的阻断项已经解除。[JOURNAL-SPEC.md:129](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:129)

不过正文要求校验 snapshot 的 hash、length、mode，而 `FileMeta` 只有 state/hash/mode，没有 baseline length；op 中的 `length` 又没有说明代表 before 还是 next。[JOURNAL-SPEC.md:21](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:21)

同时，写协议引用 `before.mode`，但 op schema 的 `before` 是 `FileState`，mode 位于顶层。[JOURNAL-SPEC.md:64](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:64)

需要统一为一个可验证的数据模型，或删除没有比较基准的 length 要求。

### 2. resolution 的 durable 写原语没有规范化

普通 op 明确规定 append、file fsync、directory fsync、tmp rename；resolution 只写了“原子写 op”“执行替换”“写 confirmed”。[JOURNAL-SPEC.md:170](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:170)

还需明确：

- op、confirmed、OUTCOME 的创建和目录 fsync；
- target present/delete 的物理替换协议；
- 每次写前的 fencing；
- baseline absent 时不要求 snapshot，以及恢复为 absent 的 unlink 协议；
- RESOLVED 前的全 target 终检。

否则 S5b 的逻辑状态机虽然成立，不同实现仍可能采用不同 durability 语义。

### 3. takeover CAS 核心成立，但锁生命周期仍需收口

`rename(lock, unique-stolen)` 能串行化同一 dead lock 的竞争；胜者复核旧 token、再次检查 dead+stale，并用 `open('wx')` 创建新锁。`--force` 也已明确降级。因此 v3 的“双 repair 同时替换旧锁”反例在 FULL 平台已经解除。[JOURNAL-SPEC.md:210](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:210)

仍应明确：

- owner 存活必须按 `(bootId,pid,processStartToken)` 判断，而不是字面上的“PID 存活”；
- step 5 遇到 `EEXIST` 时必须作为失败者只读退出；
- step 4 恢复 stolen lock 时不得覆盖间隙中创建的新 lock；
- 正常 release 的 token 校验、unlink 和目录 fsync；
- `lock.stolen-*` 遗留物的扫描与清理规则。

这些主要是协议边界和可用性问题，当前不推翻 CAS 核心。

### 4. 普通 op 链仍有结构性歧义

“seq 连续递增”与同一 op 的 `INTENDED→CONFIRMED|CANCELLED` 两条记录之间是什么关系没有写清：两条 phase 记录是否共享 seq。`kind` 也只要求“一致性”，未规定 ROLLBACK 必须 `next==baseline.before`。[JOURNAL-SPEC.md:74](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:74)

这不会重现 v3 的 reducer 核心反例，但可能使不同实现对 malformed chain 作出不同分类。

### 5. 测试矩阵仍未闭合

当前矩阵已经补上 v3 指出的多数场景，但至少还缺：

- conflict report + `ACCEPTED_CURRENT` 的崩溃组合；
- `RESOLUTION_CONFLICTED` 后重新授权、新 rid/旧 rid 竞争；
- resolution manifest、OUTCOME、op、confirmed 的损坏组合；
- 原 journal 与 resolution 双 tombstone 的每个崩溃点；
- takeover rename 后、`open('wx')` 前被第三方成功获取；
- PID 复用、processStartToken、release 崩溃；
- Phase 0 hash/length/mode 任一失败时，多 target 全局零写入；
- accept-current 两套接口路径的一致性。

测试矩阵目前不能证明扫描决策表和接口契约闭合。[JOURNAL-SPEC.md:261](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:261)

## 建议优化

- 把扫描规则改为真正的状态组合表，分别列出 resolution、普通 OUTCOME、conflict report、COMMITTED、manifest 和 trash 的存在/合法性及权威顺序。
- 为 resolution 增加 `supersedesResolutionId` 或明确“旧 rid tombstone 后才能创建新 rid”的重新授权协议。
- 将 tombstone 定义成公共 durable primitive，明确两个目录的 rename 顺序和 fsync。
- 在接口中只保留一种 accept-current 工作流。
- 为 `Manifest`、`ResolutionPlan`、各类 OUTCOME、`RecoveryReport` 提供完整版本化 schema。

本轮仅只读检查了指定文件和指定 git diff，未修改文件，也未联网。