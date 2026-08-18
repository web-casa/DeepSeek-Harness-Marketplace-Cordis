## 总体结论

当前 `JOURNAL-SPEC.md v1` **还不能直接作为 M2a 的正式实现契约，存在必须修改后才能开工的阻断问题**。

总体方向是正确的：per-write intent、以 COMMITTED marker 作为文件事务提交点、提交后禁止自动回滚，以及 FILE_COMMITTED 与插件激活分离，都延续了 S5 原型和 PLAN-v4 的核心决策。但 S5 只验证了“单文件、文件已存在、单次正向写”的基本路径；扩展到多次写、删除、回滚二次崩溃和清理时，当前规格出现互相矛盾或没有定义的状态。

结论分项：

- per-write intent：基本思想成立，但当前日志归约规则不闭环。
- 恢复矩阵：ABSENT、多次写、二次崩溃、FILE_COMMITTED 无 marker、清理中崩溃均未完整覆盖。
- repair：两个动作都没有可执行的确定终态，存在“部分恢复后被当成完成”的风险。
- JournalPort：同时存在关键原语缺失和职责越界。
- 测试矩阵：覆盖面看似较全，但尚不能防止上述核心回归。
- PLAN-v4：FILE_COMMITTED/激活分离一致；`DIRTY` 与新状态命名不一致。

## 阻断项

### 1. “最后一条 intent 权威”无法支持多次写和回滚二次崩溃

规格规定 JSONL 最后一条记录权威，[§4.6](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:118) 又要求未执行的 INTENDED 追加 CANCELLED。但这会丢失前一条 CONFIRMED 所代表的已拥有状态。

例如：

1. `A → B` 已 CONFIRMED；
2. 回滚追加 `INTENDED(expected=B,next=A)`；
3. 替换前崩溃；
4. 恢复判定当前 `B == expected`，追加 CANCELLED；
5. 此时最后记录是 CANCELLED，而 [§5.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:143) 要求 CANCELLED 时当前必须等于事务初始 before `A`，于是错误进入 CONFLICTED。

这直接违反 [§5.5](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:175) 所称的“继续回滚”。连续正向写 `A→B→C` 也有相同问题。

必须修改为：

- 每次逻辑写有稳定的 `opId/writeSeq`；
- INTENDED/CONFIRMED/CANCELLED 是同一操作的状态，而不是仅按最后一行解释；
- 明确 `kind: FORWARD | ROLLBACK` 或等价的恢复目标；
- 定义对完整日志的确定性 reducer，计算“最近确认拥有的状态”和“当前恢复目标”。

此外，当回滚 CONFIRMED 的 `next == before` 时，表中的 `CONFIRMED=current next` 与 `CONFIRMED=current before` 两行同时命中，必须规定优先级或消除重叠。

### 2. ABSENT/删除协议自相矛盾，且没有持久化删除原语

[§4.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:101) 只定义 tmp+rename，无法实现 `nextExists=false`；[§5.4](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:165) 虽写了“删除文件”，但没有规定 `unlink`、父目录 fsync 及对应崩溃点。

COMMITTED 矩阵也存在直接冲突：若 `before=存在、next=ABSENT、current=ABSENT`，它既满足“current == next → COMMITTED_OK”，又满足“current == ABSENT 但 before 存在 → CONFLICTED”。

必须统一用 `(exists, hash)` 状态，而不是混用 hash 和 ABSENT，并完整列出：

- absent→present；
- present→absent；
- absent→absent/no-op；
- 删除前、unlink 后、父目录 fsync 前后；
- COMMITTED 和未 COMMITTED 下各自的判定。

### 3. 持久化状态与 commit/cleanup 崩溃窗口没有闭环

关键缺口包括：

- [状态表](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:55) 说 FILE_COMMITTED 表示 marker 已落盘，但落盘顺序却是先写 manifest.state，再创建 marker。两者之间崩溃会得到“FILE_COMMITTED、无 marker”，而 [§5.3](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:143) 没覆盖该组合。
- PREPARED 要求“初始 intent 记录”已落盘，但这些记录的 schema 和 phase 没有定义；后文又把 PREPARED 当成“无 intent”处理。
- manifest 首次创建前/中途崩溃会留下无 manifest 或不可读 tx 目录，目前只能判 UNRECOVERABLE。
- JSONL 追加时产生截断尾行同样被判 UNRECOVERABLE，因此一次正常掉电可能无法自动恢复。
- `OUTCOME.json` 被标为可选且位于待删除 tx 目录内部。递归清理中崩溃可能留下“manifest 已删除、目录仍存在”的残骸，下一次只能 UNRECOVERABLE，不能实现所称的幂等清理。

必须增加完整的持久化组合矩阵，并明确 marker 权威时：

- 无 marker，即使 manifest 已写 FILE_COMMITTED，也属于未提交并进入安全回滚；
- 有 marker时不得回滚，允许 manifest 状态滞后；
- 清理采用可恢复的原子 rename/tombstone 流程，而不是未规定顺序的目录删除。

### 4. repair 两个动作没有确定、可靠的终态

[冲突处置](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:182) 当前不可直接实现：

- `accept-current` 只说重写 before 和 PREPARED，没有规定旧 intents、snapshots 如何重建或封存，也没有定义最终 OUTCOME。
- `restore-snapshot` 允许可恢复目标回滚、其余冲突目标保持原样，然后只要“一致性校验”通过就可能结束。这会产生部分旧版本、部分外部版本的混合文件集，与动作名称不符。
- “解析成功”不是充分的一致性定义；manifest、lockfile、patch、state.json 各自可解析，不代表相互一致。
- 校验失败不应自动变成 UNRECOVERABLE；journal 证据仍完整时，更合理的是保持 CONFLICTED 并报告 resolution failure。

必须规定全目标预检和终态：要么全部满足恢复条件后执行 `restore-snapshot`，要么保持 CONFLICTED；不得把部分恢复当作成功。`accept-current` 应明确为封存旧事务并记录 `ACCEPTED_CURRENT`，而不是复用含旧 intent 的 PREPARED 状态。

### 5. JournalPort 无法保证规格中的关键写协议

[JournalPort](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:228) 只有 `prepareWrite` 和 `confirmWrite`，没有执行原子 target 替换的操作，也没有说明由哪个 Port 完成写入。因而无法由 contract test 强制保证“乐观检查→原子替换→父目录 fsync→确认”的顺序。

同时存在以下缺口：

- `confirmWrite` 未规定必须重新读取并验证 current==next；
- 没有正常 I/O 失败时的 `cancelWrite/abortWrite`；
- `scan()` 看似只读，但 repair 对 RECOVERABLE 要自动写，缺少 `recover()`；
- `WriteHandle` 缺少 `nextExists`、写操作类型和稳定 opId；
- `resolveConflict` 需要业务一致性校验，却被放进声称“不包含业务状态机”的 JournalPort。

建议二选一：

- 由 JournalPort 提供封装完整协议的 `write/replace` 操作；或
- 明确定义 FilePort、JournalPort、LockPort 的调用序列和不可违反的前后条件。

### 6. “永不静默覆盖”承诺与协议能力矛盾

文件开头承诺“永不静默覆盖”，但 [§8](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:213) 又明确不承诺阻止非协作进程写入。

外部进程若恰好在 hash 检查后、rename 前修改 target，其内容会被 rename 直接覆盖；最终文件等于 next，后续检查无法发现。提交终检与 marker 创建之间也存在类似 TOCTOU 窗口。

标准跨平台文件 API 下无法实现基于内容的原子 CAS。必须在契约中改成：

- 对参与同一锁的协作写入保证不静默覆盖；
- 对非协作外部写入仅提供 best-effort 检测，明确列出无法检测的竞争窗口。

如果产品确实要求绝不静默覆盖，则需另行设计平台相关的交换/备份证据机制，当前协议不满足。

## 重要问题

### 1. 多文件恢复只有逐文件表，没有事务级算法

必须明确先对所有 target 完成只读分类，再决定整体动作；若恢复过程中后续文件发生冲突，应记录此前哪些文件已经恢复，事务继续保持 CONFLICTED。还应规定存在多个 tx 目录时的扫描顺序，以及宿主在旧 tx 未处理完之前不得开启新 mutation。

### 2. 锁的 stale takeover 存在双 owner 风险

心跳使用原子替换，而 stale lock 可被 `--force` 接管。旧进程暂停超过 30 秒后恢复，仍可能再次替换新 owner 的 lock 文件。当前没有 fencing token 或每次 journal 写前的 owner 校验，因此 [“两个 recovery 串行”](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:175) 并不成立。

应增加同 bootId 下 PID 存活检查、不可复用的 owner token及接管后的 fencing 规则，或使用有明确失效语义的系统锁。

### 3. 冲突证据自身的崩溃恢复未定义

复制 evidence、写 report、更新 manifest.state 三者没有顺序和幂等规则。若中途崩溃，可能出现 CONFLICTED 但无完整报告，或报告存在而 manifest 仍是 MUTATING。还需为 absent current 建立明确证据表示，并在复制后校验内容 hash。

### 4. 测试矩阵还不足以防回归

[现有矩阵](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:251) 应补充：

- 同一 target 连续两次以上正向写；
- 正向 CONFIRMED 后回滚 INTENDED/CANCELLED；
- `before==next` 的 no-op/往返写；
- ABSENT 的完整状态组合及 durable unlink；
- FILE_COMMITTED manifest 与 marker 的所有先后组合；
- JSONL 截断尾行、重复记录和 seq 跳变；
- 多文件在第一/中间/最后一个 target 崩溃，以及其中一文件冲突；
- conflict evidence 和 tx cleanup 每一步崩溃；
- stale lock 接管与旧 owner 恢复；
- 外部写入发生在检查→rename、终检→marker 窗口的预期结果。

`kill -9` 只模拟进程死亡，不等价于断电；应同时使用确定性 failpoint/model test 验证 fsync 顺序。所谓“单次 mutation 追加次数固定”也应改成“每次逻辑写的追加次数有界”。

### 5. 文件系统与安全前提需要明确

应定义支持的文件系统语义：同文件系统 rename、目录 fsync 可用性、符号链接处理、目标文件模式是否保留。目前 target tmp 使用 0600，会把原本 0644 的 `package.json` 等文件替换成 0600；需明确这是策略还是遗漏。

## 建议优化

- 将 JSONL 改成每个操作一个原子状态文件，或者为 JSONL 增加长度、校验和及“只允许忽略一个截断尾记录”的规则。
- 给 manifest/intent 写出完整 schema，包括 `beforeExists`、length、snapshot hash、opId、kind、时间及严格的 seq 约束。
- 用状态机模型或属性测试验证两个不变量：无 marker 永远不会保留已认领写；有 marker 永远不会自动回滚。
- 为所有矩阵规定唯一匹配规则，禁止依赖表格行顺序解决重叠。

## 与 PLAN-v4 的一致性

FILE_COMMITTED 与激活分离在概念上是**一致的**：[PLAN-v4](/home/ivmm/daohang/toolso-ai-open/cordis-mp/PLAN-v4.md:14) 明确 `VERIFY → FILE_COMMITTED → 用户显式启用`，本规格也把 COMMITTED 限定为文件事务，并在 [§11](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:266) 排除激活状态。此项无需改变方向。

但 PLAN-v4 的事务状态仍包含 `DIRTY`，而规格改为 `CONFLICTED/UNRECOVERABLE`。正式开工前应更新 PLAN 或在规格中明确 `DIRTY` 的映射与废弃关系，避免实现和验收使用两套状态名。

本次仅进行了指定文件的只读评审，没有修改仓库内容。
