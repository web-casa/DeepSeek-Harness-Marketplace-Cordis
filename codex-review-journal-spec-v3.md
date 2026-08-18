## 总体结论

**v3 暂时不能冻结为 M2a contract。**

对 v2 的 4 个阻断项，严格判断如下：

| v2 阻断项 | v3 状态 | 结论 |
|---|---|---|
| 1. reducer 连续多写及纯逻辑归约 | **基本解除** | 普通 FORWARD/ROLLBACK 路径的 `A→B→C`、`A→B→A` 已闭环，Phase 1 也改成无副作用 |
| 2. restore-snapshot 确定终态 | **未解除** | “允许部分进度、全量成功才报成功”的语义成立，但 RESOLUTION 的持久化、归约和续跑协议互相冲突 |
| 3. 锁接管/fencing | **未解除** | 活 owner 禁止接管的方向正确，但接管本身没有原子竞争协议，`--force` 仍留下双 owner 缺口 |
| 4. OUTCOME/tombstone 优先级 | **未解除** | 普通终态和双目录 fsync 已补齐，但 `RESOLVED`、权威 conflict report、损坏 OUTCOME 等分支没有闭环 |

因此可以认为：**四项都有实质进展，但只有普通事务 reducer 的核心反例已经解决；其余三项仍有阻断性缺口。**

---

## 阻断项

### 1. RESOLUTION 并没有形成独立、可归约的事务

规范称 restore-snapshot 是“独立 RESOLUTION 事务”，但仍通过同一个 `tx` 向原 target op 链追加 `kind=RESOLUTION`：[JOURNAL-SPEC.md:164](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:164)、[JOURNAL-SPEC.md:226](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:226)。

这与普通 reducer 的不变量直接冲突：

- 普通链要求后续 op 的 `expected == 前一逻辑 owned`：[JOURNAL-SPEC.md:107](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:107)。
- RESOLUTION plan 却要求 `expected = 计划时的当前 current`：[JOURNAL-SPEC.md:167](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:167)。
- 对真正的冲突，定义上正是 `current != owned`，所以追加后的链会被 §6.2 判成 UNRECOVERABLE。

此外尚未定义：

- immutable resolution plan 落在哪个 durable 文件、何时 fsync；
- resolutionId、独立 seq、resolution baseline；
- 已完成 target 如何识别并跳过；
- pending RESOLUTION op 如何归约；
- `RESOLUTION_CONFLICTED` 后是等待重新授权、继续旧计划，还是生成新计划；
- `OUTCOME 或 manifest 置 RESOLVING` 中二者谁是权威。

因此，**部分进度语义本身成立，但其崩溃恢复机制不成立**。需要真正独立的 resolution journal，或为 RESOLUTION 明确定义一套不复用普通 owned 链的 reducer。

### 2. 扫描优先级仍存在不可达和遗漏分支

[JOURNAL-SPEC.md:96](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:96) 的优先级解决了 v2 的普通终态问题，但仍有三处硬缺口：

1. restore 完成会写 `OUTCOME=RESOLVED`，[JOURNAL-SPEC.md:171](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:171)；扫描的终态集合却只有 `ROLLED_BACK|COMMITTED|ACCEPTED_CURRENT`。在 RESOLVED 已写、tombstone 前崩溃时，没有续清理分支。

2. [JOURNAL-SPEC.md:162](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:162) 规定 `report.json` 存在即权威，但扫描优先级完全不检查 conflict report。若 current 后来碰巧回到 owned，扫描可能绕过用户授权重新自动恢复。

3. “有效 OUTCOME”有分支，但无效、截断、未知枚举的 OUTCOME 如何处理没有规定。此时不能安全地忽略 OUTCOME 后继续 marker/reducer。

另外，“无 manifest”判定列在 reducer 之后；而 reducer 本身需要 manifest baseline。顺序应调整为先判定 manifest 是否存在、有效，再进入 reducer。

### 3. 锁接管仍不能证明协作进程只有一个 owner

“活 PID 不接管”消除了 v2 中最直接的旧 owner 恢复反例，但死锁接管仍没有原子 claim/CAS：[JOURNAL-SPEC.md:201](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:201)。

仍存在如下协作竞争：

1. repair A、B 同时读取旧的 dead-owner lock；
2. 两者都判定可接管；
3. A 替换成 token A；
4. A 校验 token 后暂停；
5. B 根据先前结果替换成 token B；
6. A 恢复并执行 journal/target 写。

`open('wx')` 只覆盖 lock 不存在时的首次获取，没有覆盖“替换已有死锁”的竞争。写前 token 检查依旧无法封闭这段 TOCTOU。

同时，“无法判断死亡时允许 `--force`”与“活进程禁止 force 接管”的总保证并不一致。至少需要：

- 用不可被替换的 OS lock 或独立 takeover mutex 串行化接管；
- 或明确可证明的原子 compare-and-replace 协议；
- 将无法验证死亡的 `--force` 明确降级为放弃协作保证，而不能继续宣称无双 owner；
- 定义持 token 的安全 release、heartbeat 更新和 token 不匹配后的只读退出行为。

### 4. 自动回滚缺少全量 snapshot 预检

restore-snapshot 明确要求执行前验证所有 snapshot，但普通未提交事务的自动回滚没有同等规则：[JOURNAL-SPEC.md:132](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:132)。

若 before snapshot 已损坏，实现可能先覆盖一个 target，随后复读发现 hash 不符才进入冲突，从而把损坏内容写进 live profile。测试矩阵虽然提到 snapshot hash 校验，[JOURNAL-SPEC.md:256](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:256)，但规范正文没有规定校验时点。

Phase 1 应在零 target 写入条件下验证：

- 所有 `before.exists=true` 的 snapshot 存在且 hash/length 匹配；
- `before.exists=false` 不要求内容 snapshot；
- mode 元数据合法；
- 所有回滚所需数据均可读。

任何失败都应在写入前进入 UNRECOVERABLE，而不是边回滚边发现。

### 5. 测试矩阵尚不足以承担冻结契约

当前矩阵覆盖面明显提升，但有一个直接矛盾：

- 测试 3 写的是回滚 `B→A INTENDED`、current=B 时“计划 CONFIRMED”：[JOURNAL-SPEC.md:251](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:251)。
- 按 §6.3，此时 current 等于 pending.expected，应追加 **CANCELLED**，然后生成新的 rollback op，而不是 CONFIRMED。

还缺少以下冻结级场景：

- `OUTCOME=RESOLVED` 已写、tombstone 前崩溃；
- report.json 已存在但 current 又回到 owned；
- RESOLVING 只写 manifest、只写 OUTCOME、plan 截断等组合；
- invalid/unknown OUTCOME 与 marker 的组合；
- 两个 repair 同时竞争 dead-owner lock；
- PID 复用、force 误判及 lock release 崩溃；
- JSONL 最后尾行截断。该规则在 v2 中存在，v3 正文和矩阵均删除；
- present→present same-state no-op；
- 提交态下的文件创建和删除；
- “RESOLVED 当且仅当全 target==before”及“RESOLUTION_CONFLICTED 后不得无授权继续”的模型不变量。

---

## 重要问题

### 1. 普通 reducer 主体成立，但结构校验还不完整

普通恢复现在正确地先归约历史 frontier、最后才比较 physical current，[JOURNAL-SPEC.md:107](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:107)，已经解决 `A→B→C` 误判。

但“kind 参与转移”只有一句声明，实际规则仍只按 phase 改 owned。应明确：

- FORWARD、ROLLBACK、RESOLUTION 分别允许出现在哪些状态；
- ROLLBACK 是否必须 `next==baseline.before`；
- RESOLUTION 是否禁止出现在普通 op 链；
- 同一 opId 的多条 phase 记录如何共享 seq；
- opId、txid、targetKey、length、mode、hash 的一致性校验。

Phase 2 执行 planned CONFIRMED/CANCELLED 前也应重新读取 current；否则 Phase 1 后发生的非协作修改可能使追加的 phase 与实际状态不一致。

### 2. JournalPort/RepairService 的宏观边界清楚了，但 API 尚未闭合

积极变化是：

- `writePresent` 只接收 bytes；
- delete 独立；
- BaselineValidatorPort 已移出 JournalPort；
- RepairService 负责业务编排。

这些修复了 v2 的主要职责混杂问题。

剩余问题在 accept-current 路径：[JOURNAL-SPEC.md:237](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:237)。

RepairService 调用“archive + validator + completeResolution”，但：

- `completeResolution(tx)` 没有 action 参数；
- accept-current 没有调用 `beginResolution`，JournalPort 无从知道应写 `ACCEPTED_CURRENT` 而非 `RESOLVED`；
- `archiveConflict` 与 `accepted-<ts>` 的“封存整个旧 journal”不是同一个原语；
- `ResolutionPlan` 没有 schema，也没有要求 JournalPort 再次验证 allowlist、expected、next 和 snapshot。

建议把接口拆成明确的 `completeRestoreResolution` 与 `completeAcceptCurrent`，或让 durable plan 明确记录 action，并由 JournalPort 验证所有安全不变量。

### 3. mode 与 absent snapshot 的表达仍不一致

规范定义了 `FileMeta`，但 op 示例中的 `before` 仍是纯 FileState，mode 位于 op 顶层；写协议却引用 `before.mode`：[JOURNAL-SPEC.md:25](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:25)、[JOURNAL-SPEC.md:77](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:77)。

还应明确：

- baseline mode 究竟存于 manifest、snapshot metadata 还是每个 op；
- baseline absent 时，“snapshot 完整”是无需 snapshot，还是必须有 absent marker；
- baseline absent 后连续两次 present 写，第二次应继承 0600，而不是读取不存在的 before.mode。

### 4. 日志损坏语义发生回退

v2 明确允许最后一条 JSONL 尾行截断，其余损坏为 UNRECOVERABLE；v3 删除了这套规则。考虑到 append 本身就是 crash point，这不是纯编辑细节。

需要恢复完整定义：尾部截断识别、未知字段/版本、非尾行损坏、重复 phase、部分 UTF-8/换行，以及对应 warning/UNRECOVERABLE 分类。

---

## 建议优化

- 为普通事务和 RESOLUTION 分别给出伪代码及独立 reducer，不要让一个 `kind` 字段隐含两套 baseline。
- 增加 marker、OUTCOME、report、manifest、journal、trash 的完整决策表，包含无效和互相矛盾的组合。
- 明确定义 `manifest.json`、`OUTCOME.json`、`ResolutionPlan`、RecoveryReport 的 schema 与版本规则。
- 在模型测试中增加三个核心不变量：单一协作 owner；冲突后未经授权不得修改 target；RESOLVED 当且仅当全 target durable 地等于 before。
- 将平台能力写成 adapter contract：FULL 模式必须具备哪些目录 fsync、进程身份和 OS lock 能力，缺失时哪些保证自动降级。

本轮仅以只读方式检查了指定文件、v2→v3 diff 和 v2 评审记录；未修改文件，也未联网。
tokens used
52,679
## 总体结论

**v3 暂时不能冻结为 M2a contract。**

对 v2 的 4 个阻断项，严格判断如下：

| v2 阻断项 | v3 状态 | 结论 |
|---|---|---|
| 1. reducer 连续多写及纯逻辑归约 | **基本解除** | 普通 FORWARD/ROLLBACK 路径的 `A→B→C`、`A→B→A` 已闭环，Phase 1 也改成无副作用 |
| 2. restore-snapshot 确定终态 | **未解除** | “允许部分进度、全量成功才报成功”的语义成立，但 RESOLUTION 的持久化、归约和续跑协议互相冲突 |
| 3. 锁接管/fencing | **未解除** | 活 owner 禁止接管的方向正确，但接管本身没有原子竞争协议，`--force` 仍留下双 owner 缺口 |
| 4. OUTCOME/tombstone 优先级 | **未解除** | 普通终态和双目录 fsync 已补齐，但 `RESOLVED`、权威 conflict report、损坏 OUTCOME 等分支没有闭环 |

因此可以认为：**四项都有实质进展，但只有普通事务 reducer 的核心反例已经解决；其余三项仍有阻断性缺口。**

---

## 阻断项

### 1. RESOLUTION 并没有形成独立、可归约的事务

规范称 restore-snapshot 是“独立 RESOLUTION 事务”，但仍通过同一个 `tx` 向原 target op 链追加 `kind=RESOLUTION`：[JOURNAL-SPEC.md:164](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:164)、[JOURNAL-SPEC.md:226](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:226)。

这与普通 reducer 的不变量直接冲突：

- 普通链要求后续 op 的 `expected == 前一逻辑 owned`：[JOURNAL-SPEC.md:107](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:107)。
- RESOLUTION plan 却要求 `expected = 计划时的当前 current`：[JOURNAL-SPEC.md:167](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:167)。
- 对真正的冲突，定义上正是 `current != owned`，所以追加后的链会被 §6.2 判成 UNRECOVERABLE。

此外尚未定义：

- immutable resolution plan 落在哪个 durable 文件、何时 fsync；
- resolutionId、独立 seq、resolution baseline；
- 已完成 target 如何识别并跳过；
- pending RESOLUTION op 如何归约；
- `RESOLUTION_CONFLICTED` 后是等待重新授权、继续旧计划，还是生成新计划；
- `OUTCOME 或 manifest 置 RESOLVING` 中二者谁是权威。

因此，**部分进度语义本身成立，但其崩溃恢复机制不成立**。需要真正独立的 resolution journal，或为 RESOLUTION 明确定义一套不复用普通 owned 链的 reducer。

### 2. 扫描优先级仍存在不可达和遗漏分支

[JOURNAL-SPEC.md:96](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:96) 的优先级解决了 v2 的普通终态问题，但仍有三处硬缺口：

1. restore 完成会写 `OUTCOME=RESOLVED`，[JOURNAL-SPEC.md:171](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:171)；扫描的终态集合却只有 `ROLLED_BACK|COMMITTED|ACCEPTED_CURRENT`。在 RESOLVED 已写、tombstone 前崩溃时，没有续清理分支。

2. [JOURNAL-SPEC.md:162](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:162) 规定 `report.json` 存在即权威，但扫描优先级完全不检查 conflict report。若 current 后来碰巧回到 owned，扫描可能绕过用户授权重新自动恢复。

3. “有效 OUTCOME”有分支，但无效、截断、未知枚举的 OUTCOME 如何处理没有规定。此时不能安全地忽略 OUTCOME 后继续 marker/reducer。

另外，“无 manifest”判定列在 reducer 之后；而 reducer 本身需要 manifest baseline。顺序应调整为先判定 manifest 是否存在、有效，再进入 reducer。

### 3. 锁接管仍不能证明协作进程只有一个 owner

“活 PID 不接管”消除了 v2 中最直接的旧 owner 恢复反例，但死锁接管仍没有原子 claim/CAS：[JOURNAL-SPEC.md:201](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:201)。

仍存在如下协作竞争：

1. repair A、B 同时读取旧的 dead-owner lock；
2. 两者都判定可接管；
3. A 替换成 token A；
4. A 校验 token 后暂停；
5. B 根据先前结果替换成 token B；
6. A 恢复并执行 journal/target 写。

`open('wx')` 只覆盖 lock 不存在时的首次获取，没有覆盖“替换已有死锁”的竞争。写前 token 检查依旧无法封闭这段 TOCTOU。

同时，“无法判断死亡时允许 `--force`”与“活进程禁止 force 接管”的总保证并不一致。至少需要：

- 用不可被替换的 OS lock 或独立 takeover mutex 串行化接管；
- 或明确可证明的原子 compare-and-replace 协议；
- 将无法验证死亡的 `--force` 明确降级为放弃协作保证，而不能继续宣称无双 owner；
- 定义持 token 的安全 release、heartbeat 更新和 token 不匹配后的只读退出行为。

### 4. 自动回滚缺少全量 snapshot 预检

restore-snapshot 明确要求执行前验证所有 snapshot，但普通未提交事务的自动回滚没有同等规则：[JOURNAL-SPEC.md:132](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:132)。

若 before snapshot 已损坏，实现可能先覆盖一个 target，随后复读发现 hash 不符才进入冲突，从而把损坏内容写进 live profile。测试矩阵虽然提到 snapshot hash 校验，[JOURNAL-SPEC.md:256](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:256)，但规范正文没有规定校验时点。

Phase 1 应在零 target 写入条件下验证：

- 所有 `before.exists=true` 的 snapshot 存在且 hash/length 匹配；
- `before.exists=false` 不要求内容 snapshot；
- mode 元数据合法；
- 所有回滚所需数据均可读。

任何失败都应在写入前进入 UNRECOVERABLE，而不是边回滚边发现。

### 5. 测试矩阵尚不足以承担冻结契约

当前矩阵覆盖面明显提升，但有一个直接矛盾：

- 测试 3 写的是回滚 `B→A INTENDED`、current=B 时“计划 CONFIRMED”：[JOURNAL-SPEC.md:251](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:251)。
- 按 §6.3，此时 current 等于 pending.expected，应追加 **CANCELLED**，然后生成新的 rollback op，而不是 CONFIRMED。

还缺少以下冻结级场景：

- `OUTCOME=RESOLVED` 已写、tombstone 前崩溃；
- report.json 已存在但 current 又回到 owned；
- RESOLVING 只写 manifest、只写 OUTCOME、plan 截断等组合；
- invalid/unknown OUTCOME 与 marker 的组合；
- 两个 repair 同时竞争 dead-owner lock；
- PID 复用、force 误判及 lock release 崩溃；
- JSONL 最后尾行截断。该规则在 v2 中存在，v3 正文和矩阵均删除；
- present→present same-state no-op；
- 提交态下的文件创建和删除；
- “RESOLVED 当且仅当全 target==before”及“RESOLUTION_CONFLICTED 后不得无授权继续”的模型不变量。

---

## 重要问题

### 1. 普通 reducer 主体成立，但结构校验还不完整

普通恢复现在正确地先归约历史 frontier、最后才比较 physical current，[JOURNAL-SPEC.md:107](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:107)，已经解决 `A→B→C` 误判。

但“kind 参与转移”只有一句声明，实际规则仍只按 phase 改 owned。应明确：

- FORWARD、ROLLBACK、RESOLUTION 分别允许出现在哪些状态；
- ROLLBACK 是否必须 `next==baseline.before`；
- RESOLUTION 是否禁止出现在普通 op 链；
- 同一 opId 的多条 phase 记录如何共享 seq；
- opId、txid、targetKey、length、mode、hash 的一致性校验。

Phase 2 执行 planned CONFIRMED/CANCELLED 前也应重新读取 current；否则 Phase 1 后发生的非协作修改可能使追加的 phase 与实际状态不一致。

### 2. JournalPort/RepairService 的宏观边界清楚了，但 API 尚未闭合

积极变化是：

- `writePresent` 只接收 bytes；
- delete 独立；
- BaselineValidatorPort 已移出 JournalPort；
- RepairService 负责业务编排。

这些修复了 v2 的主要职责混杂问题。

剩余问题在 accept-current 路径：[JOURNAL-SPEC.md:237](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:237)。

RepairService 调用“archive + validator + completeResolution”，但：

- `completeResolution(tx)` 没有 action 参数；
- accept-current 没有调用 `beginResolution`，JournalPort 无从知道应写 `ACCEPTED_CURRENT` 而非 `RESOLVED`；
- `archiveConflict` 与 `accepted-<ts>` 的“封存整个旧 journal”不是同一个原语；
- `ResolutionPlan` 没有 schema，也没有要求 JournalPort 再次验证 allowlist、expected、next 和 snapshot。

建议把接口拆成明确的 `completeRestoreResolution` 与 `completeAcceptCurrent`，或让 durable plan 明确记录 action，并由 JournalPort 验证所有安全不变量。

### 3. mode 与 absent snapshot 的表达仍不一致

规范定义了 `FileMeta`，但 op 示例中的 `before` 仍是纯 FileState，mode 位于 op 顶层；写协议却引用 `before.mode`：[JOURNAL-SPEC.md:25](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:25)、[JOURNAL-SPEC.md:77](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:77)。

还应明确：

- baseline mode 究竟存于 manifest、snapshot metadata 还是每个 op；
- baseline absent 时，“snapshot 完整”是无需 snapshot，还是必须有 absent marker；
- baseline absent 后连续两次 present 写，第二次应继承 0600，而不是读取不存在的 before.mode。

### 4. 日志损坏语义发生回退

v2 明确允许最后一条 JSONL 尾行截断，其余损坏为 UNRECOVERABLE；v3 删除了这套规则。考虑到 append 本身就是 crash point，这不是纯编辑细节。

需要恢复完整定义：尾部截断识别、未知字段/版本、非尾行损坏、重复 phase、部分 UTF-8/换行，以及对应 warning/UNRECOVERABLE 分类。

---

## 建议优化

- 为普通事务和 RESOLUTION 分别给出伪代码及独立 reducer，不要让一个 `kind` 字段隐含两套 baseline。
- 增加 marker、OUTCOME、report、manifest、journal、trash 的完整决策表，包含无效和互相矛盾的组合。
- 明确定义 `manifest.json`、`OUTCOME.json`、`ResolutionPlan`、RecoveryReport 的 schema 与版本规则。
- 在模型测试中增加三个核心不变量：单一协作 owner；冲突后未经授权不得修改 target；RESOLVED 当且仅当全 target durable 地等于 before。
- 将平台能力写成 adapter contract：FULL 模式必须具备哪些目录 fsync、进程身份和 OS lock 能力，缺失时哪些保证自动降级。

本轮仅以只读方式检查了指定文件、v2→v3 diff 和 v2 评审记录；未修改文件，也未联网。
