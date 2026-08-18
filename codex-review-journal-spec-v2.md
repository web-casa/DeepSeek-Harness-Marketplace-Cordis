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
diff --git a/JOURNAL-SPEC.md b/JOURNAL-SPEC.md
index 4eaa4938..5e0f2603 100644
--- a/JOURNAL-SPEC.md
+++ b/JOURNAL-SPEC.md
@@ -1,271 +1,303 @@
-# cordis-mp 持久化事务 Journal 正式规格 v1
-
-> 状态：待 Codex review
-> 输入：PLAN-v4.md §6、spikes/S5 的 per-write intent 原型与 crash-point 实验结果
-> 目标：作为 M2a 的实现契约与恢复矩阵的 contract test 来源
-> 保证范围：本规格只保证 cordis-mp 自己拥有的 profile 文本文件写操作
-> （package.json、pnpm-lock.yaml、cordis.patch.yml、.cordis-mp/state.json）
-> 崩溃后可判定并可恢复；不能阻止非协作外部进程在 hash 检查与 rename 之间写入，
-> 但能检测大多数此类编辑并永不静默覆盖。
-
-## 1. 术语
-
-- **tx**：一次 mutation（install/update/uninstall/rollback）产生的事务。
-- **目标文件（target）**：tx 声明要修改的 profile 文本文件，rel 路径必须来自
-  封闭 allowlist：
-  `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
-  `.cordis-mp/state.json`。其他路径拒绝。
-- **beforeHash / lastOwnedHash / nextHash**：
-  - `beforeHash`：事务开始时文件内容 hash（absent 用 `ABSENT` 哨兵）。
-  - `lastOwnedHash`：本事务最近一次成功写该文件后的 hash（初始 = beforeHash）。
-  - `nextHash`：本次准备写入内容的 hash。
-- **intent**：一次“将要写/已写”的持久化记录。
-- **COMMITTED marker**：表示所有目标文件写入已确认、文件事务提交完成的
-  独立 marker 文件。它与插件“激活/启用”无关。
-
-## 2. 目录布局与文件
+# cordis-mp 持久化事务 Journal 正式规格 v2
+
+> 状态：v2，待 Codex 二次 review
+> v2 修订：修复 v1 评审 6 个阻断项：
+> ① 追加式 op 日志 + 确定性 reducer，支持多次写/回滚二次崩溃；
+> ② 文件状态统一为 (exists, hash) 二元组，增加 durable unlink 协议；
+> ③ marker 为唯一提交权威，清理改为 rename tombstone，截断尾行可恢复；
+> ④ repair 两个动作都有全量预检和确定终态；
+> ⑤ JournalPort 收敛为 writeTarget/deleteTarget 等高层原语，内部强制完整写协议；
+> ⑥ “不静默覆盖”只对协作锁内写入承诺，非协作写入为 best-effort 检测。
+
+## 1. 范围与保证
+
+本规格定义 cordis-mp mutation（install/update/uninstall/rollback）对 profile
+文本文件写入的崩溃恢复协议。目标文件（target）rel 路径封闭 allowlist：
+`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
+`.cordis-mp/state.json`，其他路径拒绝。
+
+保证分级：
+- **协作保证**：所有持有 §8 锁并遵守本协议的进程之间，不存在静默覆盖。
+- **非协作保证（best-effort）**：不参与锁的 `dsh plugin` 或手工编辑，通过写前
+  乐观检查检测；已知不可检测窗口 = “检查后到 rename/unlink 前”、“终检后到
+  marker 创建前”的非协作写入。检测到即 CONFLICTED 并保全证据，绝不静默覆盖。
+
+## 2. 基本类型
+
+- 文件状态 `FileState = { exists: boolean, hash: string | null }`：
+  - 存在：`{exists:true, hash:"sha256:<hex>"}`；
+  - 不存在：`{exists:false, hash:null}`，不再使用 ABSENT 字符串。
+- hash = sha256 内容，hex；空文件 hash 为 sha256("")。
+- `targetKey = sha256(rel)`。
+
+## 3. 目录布局
 
 ```
 profiles/web/.cordis-mp/
-  lock.json                       # 跨进程锁（§8）
+  lock.json                       # §8
   journal/<txid>/
-    manifest.json                 # schemaVersion、state、targets、outcome
-    snapshots/<targetKey>.bin     # 事务前内容（absent 不落盘）
-    intents/<targetKey>.jsonl     # 追加式 intent 记录（每行一条）
-    COMMITTED                     # 空 marker
-    OUTCOME.json                  # 终态记录（可选，供清理幂等）
+    manifest.json                 # 原子写，schemaVersion=1
+    snapshots/<key>.bin           # before 内容；before 不存在则不落盘
+    ops/<key>.jsonl               # 追加式 op 日志
+    COMMITTED                     # 提交唯一权威 marker
+    OUTCOME.json                  # 终态（COMMITTED/ROLLED_BACK/ACCEPTED_CURRENT/...）
   conflicts/<txid>/
-    evidence/                     # 当前文件副本 + snapshot + manifest 副本
+    evidence/...                  # 冲突证据副本
     report.json
+  trash/<txid>-<ts>/              # 清理 tombstone
 ```
 
-- `<targetKey>` = sha256(rel)。JSONL 追加式 intent，最后一条是权威记录。
-- 所有 journal 文件 0600；journal 目录 0700；创建目录时对父目录做
-  no-follow/lstat 校验。
+journal/trash/conflicts 目录 0700；文件 0600；父目录创建前 lstat no-follow。
 
-## 3. 状态机
+## 4. 状态机
 
 ```
 PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                               ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
 任意态 ──冲突──→ CONFLICTED
-manifest 不可读/未知 schema ──→ UNRECOVERABLE
+manifest 损坏/未知 schema ──→ UNRECOVERABLE
 ```
 
-| 状态 | 含义 | 可授权动作 |
-|---|---|---|
-| PREPARING | manifest 尚未完整落盘 | 仅继续写 journal 自身文件 |
-| PREPARED | 快照与 intent 元数据完整，未开始改 target | 开始 MUTATING |
-| MUTATING | 正在修改 target 文件 | 按 intent 协议写 target；可进入回滚 |
-| FILE_COMMITTED | COMMITTED marker 已落盘 | 只清理；不得回滚 target |
-| ROLLING_BACK | 回滚意图已持久化 | 按回滚 intent 恢复 target |
-| ROLLED_BACK | 所有 target 已恢复 before | 清理 |
-| CONFLICTED | 检测到外部编辑 | 仅用户显式 resolve |
-| UNRECOVERABLE | journal 损坏/未知版本 | 仅诊断，禁止自动写 |
-
-状态迁移落盘顺序（关键）：
-- PREPARED：manifest + 全部 snapshot + 初始 intent 记录都 fsync 后，
-  最后把 manifest.state 原子更新为 `PREPARED`。
-- FILE_COMMITTED：所有 intent 已 CONFIRMED 且终检通过 → 原子写 manifest
-  state=`FILE_COMMITTED` → 创建 COMMITTED marker → fsync 目录。
-  恢复时 **COMMITTED marker 是权威**，manifest 只是加速信息。
-- ROLLING_BACK：先持久化回滚 intent（§5.4），再写 manifest state。
-- CONFLICTED：写 manifest state 与 conflicts/<txid>/report.json，**不修改
-  任何 target**。
-
-## 4. Per-write intent 协议
-
-对每个目标文件的每次写（包括回滚写）执行：
-
-### 4.1 追加 INTENDED 记录（先落盘）
+| 状态 | 含义 |
+|---|---|
+| PREPARING | manifest 尚未完整落盘（tx 目录已建） |
+| PREPARED | manifest + snapshots 完整；未开始 target 写 |
+| MUTATING | 至少一个 op 已 INTENDED |
+| FILE_COMMITTED | manifest 记录已提交（仅信息性） |
+| ROLLING_BACK | 回滚 op 已 INTENDED |
+| ROLLED_BACK | 回滚 op 已 CONFIRMED 且目标达 before |
+| CONFLICTED | 检测到外部编辑或修复校验失败 |
+| UNRECOVERABLE | journal 损坏/未知版本，只诊断 |
+
+**COMMITTED marker 是提交唯一权威**：
+- 有 marker → 已提交，永不自动回滚；manifest.state 可滞后。
+- 无 marker → 未提交；即使 manifest.state=FILE_COMMITTED 也按未提交回滚。
+
+## 5. Op 日志协议（核心）
+
+每次逻辑写（正向写、回滚写、删除）都生成一个 op 记录，追加到
+`ops/<key>.jsonl`。**恢复不按“最后一行 phase”解释，而是按 opId 顺序运行
+确定性 reducer。**
+
+### 5.1 op 记录 schema
 ```json
 {
-  "seq": 1,
-  "phase": "INTENDED",
-  "existsExpected": true,
-  "expectedHash": "sha256:<lastOwnedHash|ABSENT>",
-  "nextExists": true,
-  "nextHash": "sha256:<hex>",
-  "nextLength": 123
+  "v": 1,
+  "opId": "<txid>-<seq>",
+  "seq": 3,
+  "kind": "FORWARD" | "ROLLBACK",
+  "phase": "INTENDED" | "CONFIRMED" | "CANCELLED",
+  "expected": { "exists": true, "hash": "sha256:B" },
+  "next":     { "exists": true, "hash": "sha256:C" },
+  "before":   { "exists": true, "hash": "sha256:A" },
+  "mode": "0644",
+  "length": 123
 }
 ```
-写入 `intents/<key>.jsonl`（append + fsync 文件 + fsync 目录）。
-对 absent：`existsExpected:false, expectedHash:"ABSENT"`；
-写 absent：`nextExists:false, nextHash:"ABSENT"`。
-
-### 4.2 乐观检查（写前）
-读取当前 target：
-- 当前状态（exists + hash）必须等于 INTENDED 的 expected 状态；
-- 不等 → 进入 CONFLICTED，禁止写入。
-
-### 4.3 原子替换
-- `tmp` 文件同目录、随机名、`open('wx', 0600)`；
-- 写入全部字节、`fsync` 文件；
-- `rename` 到 target；
-- `fsync` 父目录。
-
-### 4.4 追加 CONFIRMED 记录
-```json
-{ "seq": 2, "phase": "CONFIRMED", "existsExpected": true, "expectedHash": "...",
-  "nextExists": true, "nextHash": "...", "nextLength": 123 }
-```
-append + fsync。CONFIRMED 存在即表示“本事务已拥有该文件当前状态”。
-
-### 4.5 提交前终检
-COMMITTED 前对每个 target 重新读取并验证当前 hash == 最后 CONFIRMED 的
-nextHash。任一不等 → CONFLICTED，不写 marker。
-
-### 4.6 崩溃语义（核心不变量）
-恢复时按“manifest 中的 state + 每条 intent 的最后 phase + target 当前
-状态”判定，**不得依赖进程内 lastOwnedHash 变量**。三类基本结果：
-- 未写：INTENDED 且当前 == expected → 该 intent 作废（追加 CANCELLED）。
-- 已写未确认：INTENDED 且当前 == next → 追加 CONFIRMED（认领自己的写）。
-- 已确认：CONFIRMED 且当前 == next → 正常。
-- 其余组合 → CONFLICTED。
-
-## 5. 恢复算法与矩阵
-
-### 5.1 扫描
-- 无 journal 目录 → `CLEAN`。
-- `manifest.json` 不可读、schemaVersion 未知、target 含 allowlist 外路径、
-  intent JSONL 不可读 → `UNRECOVERABLE`（只诊断）。
-- 有 COMMITTED marker → 走 §5.2。
-- 无 marker → 走 §5.3。
-
-### 5.2 已 COMMITTED
-| 证据 | 判定 | 动作 |
-|---|---|---|
-| 每个 target：最后 intent CONFIRMED 且当前 hash == nextHash | COMMITTED_OK | 清理 tx 目录 |
-| 任一 target 当前 hash 既不等于 nextHash 也不等于 beforeHash | CONFLICTED | 保留现场，生成 evidence/report；**不自动回滚** |
-| 当前 == beforeHash | COMMITTED_PARTIAL | 进入 CONFLICTED（commit 后文件被改回，需人判） |
-| 当前 == ABSENT 但 before 存在 | CONFLICTED | 同上 |
-
-### 5.3 未 COMMITTED（PREPARED / MUTATING / ROLLING_BACK / ROLLED_BACK）
-对每个 target 按最后 intent：
-| intent 最后 phase | 当前状态 | 判定 | 恢复动作 |
+- `before`：事务初始状态；`expected`：执行本次写时期望的当前拥有状态；
+  `next`：本次写目标状态。
+- seq 每 tx 严格递增，同一 op 更新只追加新 phase（同 opId、seq 相同），
+  不允许重复 CONFIRMED；恢复时同一 opId 取最后 phase。
+
+### 5.2 写协议（JournalPort.writeTarget 内部强制）
+1. **追加 INTENDED**（append + fsync 文件 + fsync 目录）；
+2. **乐观检查**：读取 target 当前 `FileState` 必须 == expected，否则
+   CONFLICTED，不写；
+3. **执行替换**（§5.3）；
+4. **复读校验**：当前 FileState == next，否则 CONFLICTED；
+5. **追加 CONFIRMED**（append + fsync + fsync 目录）。
+
+### 5.3 替换原语
+- present→present：tmp 同目录随机名 `open('wx')`，写入，fsync file，
+  rename 到 target，fsync 父目录；**保留 before 文件 mode**。
+- absent→present：同上，新文件 mode 0600。
+- present→absent：`unlink(target)`，fsync 父目录。
+- absent→absent：不允许作为 op；视为协议错误。
+- target 若是 symlink：lstat 发现即拒绝（UNRECOVERABLE 只诊断）。
+
+### 5.4 提交协议
+1. 对每个 target 复读 FileState == 最后 CONFIRMED.next；
+2. 任一不等 → CONFLICTED；
+3. 全部相等 → 原子创建 COMMITTED marker（tmp+rename+fsync 目录）；
+4. 写 manifest.state=FILE_COMMITTED（仅信息）。
+
+## 6. 恢复 reducer
+
+### 6.1 输入
+- manifest、COMMITTED 存在性、每个 target 当前 FileState；
+- 该 target 完整 op 日志（按 seq 排序）。
+
+### 6.2 逐 op 归约
+状态：`owned` = 最近一次被本事务 CONFIRMED 成功写入的 FileState；初始 =
+`before`（尚无确认写）。`lastOp` 记录最近 opId/phase。
+
+按 seq 顺序处理每个 op（同 opId 取最后 phase）：
+| phase | 条件 | 动作 | owned |
 |---|---|---|---|
-| 无 intent | = before | NOT_WRITTEN | 无 |
-| INTENDED | = expected | NOT_WRITTEN | 追加 CANCELLED，无 target 写 |
-| INTENDED | = next | WRITTEN_UNCONFIRMED | 追加 CONFIRMED，进入待回滚 |
-| INTENDED | 其他 | CONFLICT | CONFLICTED |
-| CONFIRMED | = next | OWN_WRITE | 进入待回滚 |
-| CONFIRMED | = before | ALREADY_RESTORED | 幂等：无 target 写 |
-| CONFIRMED | 其他 | CONFLICT | CONFLICTED |
-| CANCELLED | = before | NOT_WRITTEN | 无 |
-| CANCELLED | ≠ before | CONFLICT | CONFLICTED |
-
-若任一 target CONFLICT → 整体 CONFLICTED。
-否则对每个“待回滚”target 执行回滚写（§5.4），完成后 state=ROLLED_BACK，
-校验所有 target == before，写 OUTCOME，清理。
-
-PREPARING / PREPARED 无 MUTATING 语义时按“无 intent”路径处理：
-- 所有 target == before → 清理（幂等 no-op）。
-- 任一 target ≠ before → CONFLICTED（事务还没声明写，现场却被改）。
-
-### 5.4 回滚写（同样走 intent 协议，保证二次崩溃可恢复）
-对每个待回滚 target：
-1. 追加 INTENDED：expected = 最后 CONFIRMED.nextHash（或认领后的 nextHash），
-   next = before（含 ABSENT）。
-2. 乐观检查。
-3. 原子替换为 before 内容 / 删除文件（nextExists=false 时）。
-4. 追加 CONFIRMED。
-5. 若回滚过程中再崩溃：恢复时看到回滚 intent，按同一矩阵继续，
-   最终收敛到 before 或 CONFLICTED。
-
-### 5.5 二次崩溃矩阵（实现为 contract tests）
-- 恢复写入 CANCELLED / CONFIRMED 之前崩溃 → 重跑扫描，结果一致。
-- 回滚 INTENDED 后、替换前崩溃 → NOT_WRITTEN，继续回滚。
-- 回滚替换后、CONFIRMED 前崩溃 → WRITTEN_UNCONFIRMED 认领，继续。
-- OUTCOME 已写但清理未完成 → 幂等清理。
-- 两个 cordis-mp 进程同时 recovery → 由 §8 锁串行；后到者看到 CLEAN。
-
-## 6. 冲突处置
-
-1. 任何 target 判 CONFLICT 后：
-   - 复制当前文件、manifest、相关 intent、snapshot 到
-     `conflicts/<txid>/evidence/`（复制失败则记录并停止，绝不移动 live 文件）。
-   - 写 `conflicts/<txid>/report.json`：txid、target、before/expected/next/
-     当前 hash、时间、检测阶段。
-   - manifest.state=CONFLICTED。
-2. repair 对 CONFLICTED 只提供两种显式动作：
-   - `accept-current`：对当前文件集执行一致性校验（manifest 与 lockfile、
-     patch 可解析、state.json 可解析），校验通过后建立新 baseline（重写
-     manifest 为 PREPARED 并更新 before 值）再按 §5.3 收敛；校验失败 →
-     UNRECOVERABLE。
-   - `restore-snapshot`：对“当前 == 最后 CONFIRMED.nextHash 或 beforeHash”
-     的目标执行回滚写恢复 before；其他冲突目标保持原样并在 report 列出；
-     完成后运行一致性校验，失败 → UNRECOVERABLE。
-3. 禁止任何“自动保留一方”的默认动作。
-
-## 7. repair CLI 三态
-
-`cordis-mp repair --profile web [--action accept-current|restore-snapshot] [--force] [--yes]`
-
-- 无 action：扫描并输出分类。
-- `RECOVERABLE`：自动幂等恢复（含 FILE_COMMITTED 的清理）；写入动作只
-  发生在“未写/已写未确认/已确认”三类可判定情况下。
-- `CONFLICTED`：必须提供 action；每次只处理一个 txid。
-- `UNRECOVERABLE`：输出精确手工步骤，不改文件。
-- repair 从 profile 外启动也能工作（不 import DSH/Cordis）；journal schema
-  版本不同只诊断。
-- repair 与 host 共用 §8 锁；stale lock 需要 `--force` 且打印 owner 信息。
-
-## 8. 跨进程锁
+| INTENDED | current == expected | 追加 CANCELLED（幂等） | 不变 |
+| INTENDED | current == next | 追加 CONFIRMED（认领） | = next |
+| INTENDED | 其他 | CONFLICT | — |
+| CONFIRMED | current == next | 接受 | = next |
+| CONFIRMED | current == owned | 已恢复/已替换 | 不变 |
+| CONFIRMED | 其他 | CONFLICT | — |
+| CANCELLED | current == owned | 接受 | 不变 |
+| CANCELLED | 其他 | CONFLICT | — |
+（匹配按 phase 行执行；`current == next` 与 `current == owned` 同时满足时
+取 phase 行中的第一条。）
+
+### 6.3 事务级恢复算法
+1. **只读分类**：对全部 target 运行 reducer，得到每 target 的
+   `owned`、`hasConflict`、`pendingRollback = (owned != before)`。
+2. 任一 target hasConflict → 整体 CONFLICTED；**不执行任何 target 写**。
+3. 无冲突：
+   - 有 COMMITTED marker → 进入 §6.4，永不回滚；
+   - 无 marker：
+     - 所有 target `pendingRollback=false` → ROLLED_BACK 终态（幂等）；
+     - 否则创建/继续 ROLLBACK ops，对每个 pendingRollback target 执行
+       `writeTarget`（expected=owned, next=before），完成 → ROLLED_BACK。
+4. 多 tx 目录：按 manifest.createdAt 升序逐个处理；存在未清理 tx 时，
+   cordis-mp host 禁止开启新 mutation。
+
+### 6.4 COMMITTED 路径
+| 条件（逐 target，唯一匹配） | 判定 |
+|---|---|
+| current == 最后 CONFIRMED.next | COMMITTED_OK |
+| current == before 且 before != next | CONFLICTED（提交后被改回） |
+| current == 某历史 CONFIRMED.next（多写场景） | CONFLICTED |
+| 其他 | CONFLICTED |
+全部 COMMITTED_OK → 写 OUTCOME 并清理；否则 CONFLICTED，不回滚。
+
+### 6.5 缺失/损坏判定
+- manifest 完全不存在（tx 目录只有垃圾）：target 写协议要求 manifest 先
+  落盘，因此判定 **RECOVERABLE_NOOP**，可直接清 tx 目录。
+- manifest 不可读/JSON 无效/schemaVersion 未知 → UNRECOVERABLE。
+- JSONL：允许**最后一条尾行截断**（忽略并记 warning）；除此之外任何行
+  不可解析、seq 跳变、同 opId 重复 CONFIRMED → UNRECOVERABLE。
+- PREPARING 无任何 op：检查所有 target == before → 清理；否则 CONFLICTED。
+
+## 7. 清理协议（tombstone）
+
+- 终态（ROLLED_BACK/COMMITTED/ACCEPTED_CURRENT）确认后：
+  1. 写 OUTCOME.json（原子写 + fsync）；
+  2. `rename(journal/<txid>, trash/<txid>-<ts>)` + fsync 父目录；
+  3. 递归删除 trash 目录。
+- 崩溃恢复：journal 已不在 → 看 OUTCOME 或 trash；trash 目录只做删除，
+  永不恢复。journal 半删除残骸按 RECOVERABLE_NOOP 处理（因为 marker/OUTCOME
+  决定语义已定）。
+
+## 8. 冲突证据与 repair
+
+### 8.1 冲突证据写入协议
+1. 复制当前文件到 `conflicts/<txid>/evidence/<targetKey>.bin`（tmp+rename，
+   fsync）；当前 absent 则写 `evidence/<key>.absent.json`；
+2. 复制 manifest、相关 op 日志、snapshot；
+3. 写 `report.json`（原子写）：txid、target、before/owned/current、
+   opId、检测阶段、时间；
+4. 写 manifest.state=CONFLICTED。
+崩溃恢复：report.json 存在即权威 → 补全 evidence 副本并置 CONFLICTED；
+evidence 半成品可重做，因为当前文件未被动过。
+
+### 8.2 repair 动作（全量预检，绝无部分成功）
+`cordis-mp repair --profile web [--tx <txid>] [--action restore-snapshot|accept-current] [--force] [--yes]`
+
+- 无 action：只读扫描输出 RECOVERABLE / CONFLICTED / UNRECOVERABLE。
+- RECOVERABLE：自动执行 §6.3 恢复（若用户未 --yes 则先打印计划）。
+- **restore-snapshot**：
+  1. 对 tx 全部 target 做只读 reducer；
+  2. 任一 hasConflict → 中止，保持 CONFLICTED；
+  3. 全部可恢复 → 新建一批 ROLLBACK ops 一次性执行；执行中再冲突 → 停止并
+     保持 CONFLICTED（已确认的回滚 op 会记录进度，但**不宣称恢复成功**）；
+  4. 全部 target == before → ROLLED_BACK + 清理；否则保持 CONFLICTED。
+- **accept-current**：
+  1. 封存旧 journal：copy 整个 journal 目录到
+     `conflicts/<txid>/accepted-<ts>/`，不修改旧 journal；
+  2. 调用业务一致性校验器（§10，独立于 JournalPort）验证当前 profile：
+     manifest 可解析、lockfile 与 manifest 一致（执行只读
+     `pnpm install --lockfile-only --frozen-lockfile` 语义检查）、
+     patch 可解析、state.json 可解析；
+  3. 通过 → 写 OUTCOME=ACCEPTED_CURRENT 并 tombstone；失败 → 保持
+     CONFLICTED，report 记录 resolution-failed（**不是 UNRECOVERABLE**）。
+
+## 9. 跨进程锁（fencing）
 
 `lock.json`：
 ```json
-{ "owner": "cordis-mp-host|repair", "bootId": "...", "pid": 123,
+{ "owner": "host|repair", "bootId": "...", "pid": 123,
+  "ownerToken": "<crypto random>", "epoch": 1,
   "acquiredAt": "...", "heartbeatAt": "..." }
 ```
-- 获取：`open('wx', 0600)` 原子创建；已存在则读 heartbeat。
-- 心跳每 5s 更新；陈旧阈值 30s（心跳 < 阈值）。
-- 宿主 mutation 与 repair 互斥；recovery 扫描不要求锁，但任何写动作要求锁。
-- 锁文件本身使用原子替换 + fsync；损坏时视为 stale 并提示。
-- 明确边界：外部 `dsh plugin` 或手工编辑不参与本锁。对这类写入，§4.2/§4.5
-  的 hash 检查是唯一防线；**规格不承诺“绝不覆盖非协作写入”**，只承诺
-  检测与证据保全。
-
-## 9. JournalPort（EffectPorts 中的实现边界）
+- 获取：`open('wx', 0600)`；已存在则读。
+- 心跳 5s，stale 阈值 30s；更新用原子替换 + fsync。
+- **fencing**：每次 journal 写（op append、manifest 写、marker 创建）前，
+  读取 lock 并校验 `ownerToken` == 当前持有者 token；不等 → 立即中止并置
+  CONFLICTED（老 owner 被接管后不能继续写）。
+- 接管：先 `kill(pid,0)` 检查旧 pid；旧 pid 不存在且 heartbeat stale →
+  允许替换 lock（新 token、epoch+1）；旧 pid 存活或无法判定 → repair 需
+  `--force`，host 永不 force。
+- 边界：锁只约束协作进程；非协作写入按 §1 best-effort。
+
+## 10. JournalPort（EffectPorts）
 
 ```ts
+interface FileState { exists: boolean; hash: string | null }
+interface OpRecord { v: 1; opId: string; seq: number; kind: 'FORWARD'|'ROLLBACK';
+  phase: 'INTENDED'|'CONFIRMED'|'CANCELLED'; expected: FileState;
+  next: FileState; before: FileState; mode?: string; length?: number }
+
 interface JournalPort {
-  begin(targets: TargetSpec[]): Promise<TxId>       // PREPARING→PREPARED
-  prepareWrite(tx: TxId, rel: string, next: Content): Promise<WriteHandle>
-  confirmWrite(tx: TxId, h: WriteHandle): Promise<void>
-  markMutating(tx: TxId): Promise<void>
-  commitFiles(tx: TxId): Promise<void>              // 终检 + COMMITTED marker
-  beginRollback(tx: TxId): Promise<void>
-  completeRollback(tx: TxId): Promise<void>
-  scan(): Promise<RecoveryReport>
-  resolveConflict(tx: TxId, action: 'accept-current'|'restore-snapshot'): Promise<Report>
+  begin(targets: TargetSpec[]): Promise<TxId>                 // PREPARING→PREPARED
+  writeTarget(tx: TxId, rel: string, next: FileState & { data?: Uint8Array; mode?: string }): Promise<void>
+  deleteTarget(tx: TxId, rel: string): Promise<void>          // present→absent
+  commitFiles(tx: TxId): Promise<void>                        // 终检+COMMITTED marker
+  rollback(tx: TxId): Promise<void>                           // §6.3 回滚
+  scan(): Promise<RecoveryReport>                             // 只读
+  recover(): Promise<RecoveryReport>                          // RECOVERABLE 自动恢复
+  resolveConflict(tx: TxId, action: 'restore-snapshot'|'accept-current',
+                  validateBaseline: (tx: TxId) => Promise<BaselineReport>): Promise<Report>
 }
-interface WriteHandle { rel: string; seq: number; expectedHash: string; nextHash: string }
 ```
-约束：
-- JournalPort 只做持久化原语与恢复判定，**不包含业务状态机**；状态迁移由
-  install-core 根据本规格调用。
-- 所有 hash 用 sha256，hex 编码；ABSENT 使用固定哨兵。
-- 任何 prepareWrite 未 confirm 就调用下一 prepareWrite 是协议错误，返回
-  409 语义的 JOURNALLED 错误。
-
-## 10. 测试与验收矩阵
-
-M2a contract tests 必须逐项覆盖：
-
-1. §4.6 的每个 crash-point：manifest 落盘前/后、snapshot 后、INTENDED 后、
-   tmp 写后、rename 后、CONFIRMED 前/后、COMMITTED 前/后。
-2. §5.2 与 §5.3 每一行（含 ABSENT 创建/删除、CANCELLED 后又被外部改）。
-3. §5.5 二次崩溃每一步。
-4. 冲突证据完整性：evidence 文件内容、live 文件未被移动。
-5. lock：宿主持锁时 repair 拒绝；stale lock 提示；心跳陈旧边界。
-6. 性能：单次 mutation 的 journal 追加次数固定、无全量目录扫描（除 recovery）。
-7. 真实 kill -9 注入：用子进程执行预置场景，从 journal 状态中每个点强杀后
-   运行 repair，断言终态。
-8. 契约测试跑 Web adapter 与 desktop-shaped adapter 同一套用例。
-
-## 11. 明确不在本规格范围
-
-- 插件激活 / PENDING_ACTIVATION / entry-id 门禁（另立 ACTIVATION-SPEC）。
+- `writeTarget`/`deleteTarget` 内部强制 §5.2/§5.3 全顺序；调用方无法只
+  prepare 不 confirm，从而 contract test 能强制协议。
+- JournalPort **不包含业务状态机**；install-core 决定调用顺序和动作。
+- `resolveConflict` 只负责 journal 封存/回滚执行与记录；一致性校验通过
+  注入的 `validateBaseline` 完成。
+
+## 11. 文件系统前提
+
+- 支持 POSIX 与 Windows NTFS；要求 rename 同文件系统、父目录 fsync 可用。
+- target 为 symlink 时拒绝（lstat）；父目录 no-follow。
+- present→present 保留原 mode；新文件 0600；删除协议不恢复 mode。
+- 不支持无目录 fsync 语义的文件系统（检测不到时按 best-effort 记录警告）。
+
+## 12. 测试矩阵（M2a contract tests）
+
+除 v1 矩阵外，必须覆盖：
+1. 连续多写 `A→B→C`，在每次 INTENDED/替换/CONFIRMED 前后 kill。
+2. 正向 CONFIRMED 后回滚 INTENDED 崩溃 → reducer 仍以 owned=B 继续回滚。
+3. 回滚 CONFIRMED.next == before 的唯一匹配。
+4. absent→present、present→absent、absent→absent 拒绝；unlink 后、父
+   fsync 前崩溃。
+5. FILE_COMMITTED manifest 与 marker 四种先后组合（尤其
+   manifest=FILE_COMMITTED 且无 marker → 回滚）。
+6. manifest 缺失但 tx 目录残留 → RECOVERABLE_NOOP。
+7. JSONL 尾行截断可恢复；其他损坏 → UNRECOVERABLE。
+8. 多文件在第一/中间/最后 target 崩溃；一文件冲突时零 target 被恢复。
+9. evidence 复制/report/manifest.state 三步各自崩溃 → 最终 CONFLICTED。
+10. tombstone rename 前/后崩溃 → 幂等清理。
+11. stale lock 接管后旧 owner 再次 journal 写 → 被 fencing 拒绝。
+12. 检查→rename、终检→marker 窗口注入非协作写入 → 记录预期结果
+    （可检测或已知不可检测窗口，均需显式断言）。
+13. kill -9 矩阵 + 确定性 failpoint model test 双轨验证；不变量：
+    无 marker 永不保留 owned 写；有 marker 永不自动回滚。
+
+## 13. 明确不在本规格范围
+
+- 插件激活 / PENDING_ACTIVATION（另立 ACTIVATION-SPEC）。
 - inspectArtifact / tarball 校验（另立 ARTIFACT-SPEC）。
-- pnpm / dsh CLI 执行细节（PackageManagerPort）。
-- 跨设备备份、Gist、WebDAV。
+- pnpm/dsh CLI 执行细节（PackageManagerPort）。
+- 备份、WebDAV、Gist。
+
+## 14. 与 PLAN-v4 状态命名映射
+
+PLAN-v4 的 `DIRTY` = 本规格 `CONFLICTED | UNRECOVERABLE`。后续 PLAN 统一
+使用本规格命名，实现与验收只使用一套状态。

exec
/bin/bash -lc "nl -ba JOURNAL-SPEC.md | sed -n '1,360p'" in /home/ivmm/daohang/toolso-ai-open/cordis-mp
 succeeded in 0ms:
     1	# cordis-mp 持久化事务 Journal 正式规格 v2
     2	
     3	> 状态：v2，待 Codex 二次 review
     4	> v2 修订：修复 v1 评审 6 个阻断项：
     5	> ① 追加式 op 日志 + 确定性 reducer，支持多次写/回滚二次崩溃；
     6	> ② 文件状态统一为 (exists, hash) 二元组，增加 durable unlink 协议；
     7	> ③ marker 为唯一提交权威，清理改为 rename tombstone，截断尾行可恢复；
     8	> ④ repair 两个动作都有全量预检和确定终态；
     9	> ⑤ JournalPort 收敛为 writeTarget/deleteTarget 等高层原语，内部强制完整写协议；
    10	> ⑥ “不静默覆盖”只对协作锁内写入承诺，非协作写入为 best-effort 检测。
    11	
    12	## 1. 范围与保证
    13	
    14	本规格定义 cordis-mp mutation（install/update/uninstall/rollback）对 profile
    15	文本文件写入的崩溃恢复协议。目标文件（target）rel 路径封闭 allowlist：
    16	`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
    17	`.cordis-mp/state.json`，其他路径拒绝。
    18	
    19	保证分级：
    20	- **协作保证**：所有持有 §8 锁并遵守本协议的进程之间，不存在静默覆盖。
    21	- **非协作保证（best-effort）**：不参与锁的 `dsh plugin` 或手工编辑，通过写前
    22	  乐观检查检测；已知不可检测窗口 = “检查后到 rename/unlink 前”、“终检后到
    23	  marker 创建前”的非协作写入。检测到即 CONFLICTED 并保全证据，绝不静默覆盖。
    24	
    25	## 2. 基本类型
    26	
    27	- 文件状态 `FileState = { exists: boolean, hash: string | null }`：
    28	  - 存在：`{exists:true, hash:"sha256:<hex>"}`；
    29	  - 不存在：`{exists:false, hash:null}`，不再使用 ABSENT 字符串。
    30	- hash = sha256 内容，hex；空文件 hash 为 sha256("")。
    31	- `targetKey = sha256(rel)`。
    32	
    33	## 3. 目录布局
    34	
    35	```
    36	profiles/web/.cordis-mp/
    37	  lock.json                       # §8
    38	  journal/<txid>/
    39	    manifest.json                 # 原子写，schemaVersion=1
    40	    snapshots/<key>.bin           # before 内容；before 不存在则不落盘
    41	    ops/<key>.jsonl               # 追加式 op 日志
    42	    COMMITTED                     # 提交唯一权威 marker
    43	    OUTCOME.json                  # 终态（COMMITTED/ROLLED_BACK/ACCEPTED_CURRENT/...）
    44	  conflicts/<txid>/
    45	    evidence/...                  # 冲突证据副本
    46	    report.json
    47	  trash/<txid>-<ts>/              # 清理 tombstone
    48	```
    49	
    50	journal/trash/conflicts 目录 0700；文件 0600；父目录创建前 lstat no-follow。
    51	
    52	## 4. 状态机
    53	
    54	```
    55	PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
    56	                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
    57	任意态 ──冲突──→ CONFLICTED
    58	manifest 损坏/未知 schema ──→ UNRECOVERABLE
    59	```
    60	
    61	| 状态 | 含义 |
    62	|---|---|
    63	| PREPARING | manifest 尚未完整落盘（tx 目录已建） |
    64	| PREPARED | manifest + snapshots 完整；未开始 target 写 |
    65	| MUTATING | 至少一个 op 已 INTENDED |
    66	| FILE_COMMITTED | manifest 记录已提交（仅信息性） |
    67	| ROLLING_BACK | 回滚 op 已 INTENDED |
    68	| ROLLED_BACK | 回滚 op 已 CONFIRMED 且目标达 before |
    69	| CONFLICTED | 检测到外部编辑或修复校验失败 |
    70	| UNRECOVERABLE | journal 损坏/未知版本，只诊断 |
    71	
    72	**COMMITTED marker 是提交唯一权威**：
    73	- 有 marker → 已提交，永不自动回滚；manifest.state 可滞后。
    74	- 无 marker → 未提交；即使 manifest.state=FILE_COMMITTED 也按未提交回滚。
    75	
    76	## 5. Op 日志协议（核心）
    77	
    78	每次逻辑写（正向写、回滚写、删除）都生成一个 op 记录，追加到
    79	`ops/<key>.jsonl`。**恢复不按“最后一行 phase”解释，而是按 opId 顺序运行
    80	确定性 reducer。**
    81	
    82	### 5.1 op 记录 schema
    83	```json
    84	{
    85	  "v": 1,
    86	  "opId": "<txid>-<seq>",
    87	  "seq": 3,
    88	  "kind": "FORWARD" | "ROLLBACK",
    89	  "phase": "INTENDED" | "CONFIRMED" | "CANCELLED",
    90	  "expected": { "exists": true, "hash": "sha256:B" },
    91	  "next":     { "exists": true, "hash": "sha256:C" },
    92	  "before":   { "exists": true, "hash": "sha256:A" },
    93	  "mode": "0644",
    94	  "length": 123
    95	}
    96	```
    97	- `before`：事务初始状态；`expected`：执行本次写时期望的当前拥有状态；
    98	  `next`：本次写目标状态。
    99	- seq 每 tx 严格递增，同一 op 更新只追加新 phase（同 opId、seq 相同），
   100	  不允许重复 CONFIRMED；恢复时同一 opId 取最后 phase。
   101	
   102	### 5.2 写协议（JournalPort.writeTarget 内部强制）
   103	1. **追加 INTENDED**（append + fsync 文件 + fsync 目录）；
   104	2. **乐观检查**：读取 target 当前 `FileState` 必须 == expected，否则
   105	   CONFLICTED，不写；
   106	3. **执行替换**（§5.3）；
   107	4. **复读校验**：当前 FileState == next，否则 CONFLICTED；
   108	5. **追加 CONFIRMED**（append + fsync + fsync 目录）。
   109	
   110	### 5.3 替换原语
   111	- present→present：tmp 同目录随机名 `open('wx')`，写入，fsync file，
   112	  rename 到 target，fsync 父目录；**保留 before 文件 mode**。
   113	- absent→present：同上，新文件 mode 0600。
   114	- present→absent：`unlink(target)`，fsync 父目录。
   115	- absent→absent：不允许作为 op；视为协议错误。
   116	- target 若是 symlink：lstat 发现即拒绝（UNRECOVERABLE 只诊断）。
   117	
   118	### 5.4 提交协议
   119	1. 对每个 target 复读 FileState == 最后 CONFIRMED.next；
   120	2. 任一不等 → CONFLICTED；
   121	3. 全部相等 → 原子创建 COMMITTED marker（tmp+rename+fsync 目录）；
   122	4. 写 manifest.state=FILE_COMMITTED（仅信息）。
   123	
   124	## 6. 恢复 reducer
   125	
   126	### 6.1 输入
   127	- manifest、COMMITTED 存在性、每个 target 当前 FileState；
   128	- 该 target 完整 op 日志（按 seq 排序）。
   129	
   130	### 6.2 逐 op 归约
   131	状态：`owned` = 最近一次被本事务 CONFIRMED 成功写入的 FileState；初始 =
   132	`before`（尚无确认写）。`lastOp` 记录最近 opId/phase。
   133	
   134	按 seq 顺序处理每个 op（同 opId 取最后 phase）：
   135	| phase | 条件 | 动作 | owned |
   136	|---|---|---|---|
   137	| INTENDED | current == expected | 追加 CANCELLED（幂等） | 不变 |
   138	| INTENDED | current == next | 追加 CONFIRMED（认领） | = next |
   139	| INTENDED | 其他 | CONFLICT | — |
   140	| CONFIRMED | current == next | 接受 | = next |
   141	| CONFIRMED | current == owned | 已恢复/已替换 | 不变 |
   142	| CONFIRMED | 其他 | CONFLICT | — |
   143	| CANCELLED | current == owned | 接受 | 不变 |
   144	| CANCELLED | 其他 | CONFLICT | — |
   145	（匹配按 phase 行执行；`current == next` 与 `current == owned` 同时满足时
   146	取 phase 行中的第一条。）
   147	
   148	### 6.3 事务级恢复算法
   149	1. **只读分类**：对全部 target 运行 reducer，得到每 target 的
   150	   `owned`、`hasConflict`、`pendingRollback = (owned != before)`。
   151	2. 任一 target hasConflict → 整体 CONFLICTED；**不执行任何 target 写**。
   152	3. 无冲突：
   153	   - 有 COMMITTED marker → 进入 §6.4，永不回滚；
   154	   - 无 marker：
   155	     - 所有 target `pendingRollback=false` → ROLLED_BACK 终态（幂等）；
   156	     - 否则创建/继续 ROLLBACK ops，对每个 pendingRollback target 执行
   157	       `writeTarget`（expected=owned, next=before），完成 → ROLLED_BACK。
   158	4. 多 tx 目录：按 manifest.createdAt 升序逐个处理；存在未清理 tx 时，
   159	   cordis-mp host 禁止开启新 mutation。
   160	
   161	### 6.4 COMMITTED 路径
   162	| 条件（逐 target，唯一匹配） | 判定 |
   163	|---|---|
   164	| current == 最后 CONFIRMED.next | COMMITTED_OK |
   165	| current == before 且 before != next | CONFLICTED（提交后被改回） |
   166	| current == 某历史 CONFIRMED.next（多写场景） | CONFLICTED |
   167	| 其他 | CONFLICTED |
   168	全部 COMMITTED_OK → 写 OUTCOME 并清理；否则 CONFLICTED，不回滚。
   169	
   170	### 6.5 缺失/损坏判定
   171	- manifest 完全不存在（tx 目录只有垃圾）：target 写协议要求 manifest 先
   172	  落盘，因此判定 **RECOVERABLE_NOOP**，可直接清 tx 目录。
   173	- manifest 不可读/JSON 无效/schemaVersion 未知 → UNRECOVERABLE。
   174	- JSONL：允许**最后一条尾行截断**（忽略并记 warning）；除此之外任何行
   175	  不可解析、seq 跳变、同 opId 重复 CONFIRMED → UNRECOVERABLE。
   176	- PREPARING 无任何 op：检查所有 target == before → 清理；否则 CONFLICTED。
   177	
   178	## 7. 清理协议（tombstone）
   179	
   180	- 终态（ROLLED_BACK/COMMITTED/ACCEPTED_CURRENT）确认后：
   181	  1. 写 OUTCOME.json（原子写 + fsync）；
   182	  2. `rename(journal/<txid>, trash/<txid>-<ts>)` + fsync 父目录；
   183	  3. 递归删除 trash 目录。
   184	- 崩溃恢复：journal 已不在 → 看 OUTCOME 或 trash；trash 目录只做删除，
   185	  永不恢复。journal 半删除残骸按 RECOVERABLE_NOOP 处理（因为 marker/OUTCOME
   186	  决定语义已定）。
   187	
   188	## 8. 冲突证据与 repair
   189	
   190	### 8.1 冲突证据写入协议
   191	1. 复制当前文件到 `conflicts/<txid>/evidence/<targetKey>.bin`（tmp+rename，
   192	   fsync）；当前 absent 则写 `evidence/<key>.absent.json`；
   193	2. 复制 manifest、相关 op 日志、snapshot；
   194	3. 写 `report.json`（原子写）：txid、target、before/owned/current、
   195	   opId、检测阶段、时间；
   196	4. 写 manifest.state=CONFLICTED。
   197	崩溃恢复：report.json 存在即权威 → 补全 evidence 副本并置 CONFLICTED；
   198	evidence 半成品可重做，因为当前文件未被动过。
   199	
   200	### 8.2 repair 动作（全量预检，绝无部分成功）
   201	`cordis-mp repair --profile web [--tx <txid>] [--action restore-snapshot|accept-current] [--force] [--yes]`
   202	
   203	- 无 action：只读扫描输出 RECOVERABLE / CONFLICTED / UNRECOVERABLE。
   204	- RECOVERABLE：自动执行 §6.3 恢复（若用户未 --yes 则先打印计划）。
   205	- **restore-snapshot**：
   206	  1. 对 tx 全部 target 做只读 reducer；
   207	  2. 任一 hasConflict → 中止，保持 CONFLICTED；
   208	  3. 全部可恢复 → 新建一批 ROLLBACK ops 一次性执行；执行中再冲突 → 停止并
   209	     保持 CONFLICTED（已确认的回滚 op 会记录进度，但**不宣称恢复成功**）；
   210	  4. 全部 target == before → ROLLED_BACK + 清理；否则保持 CONFLICTED。
   211	- **accept-current**：
   212	  1. 封存旧 journal：copy 整个 journal 目录到
   213	     `conflicts/<txid>/accepted-<ts>/`，不修改旧 journal；
   214	  2. 调用业务一致性校验器（§10，独立于 JournalPort）验证当前 profile：
   215	     manifest 可解析、lockfile 与 manifest 一致（执行只读
   216	     `pnpm install --lockfile-only --frozen-lockfile` 语义检查）、
   217	     patch 可解析、state.json 可解析；
   218	  3. 通过 → 写 OUTCOME=ACCEPTED_CURRENT 并 tombstone；失败 → 保持
   219	     CONFLICTED，report 记录 resolution-failed（**不是 UNRECOVERABLE**）。
   220	
   221	## 9. 跨进程锁（fencing）
   222	
   223	`lock.json`：
   224	```json
   225	{ "owner": "host|repair", "bootId": "...", "pid": 123,
   226	  "ownerToken": "<crypto random>", "epoch": 1,
   227	  "acquiredAt": "...", "heartbeatAt": "..." }
   228	```
   229	- 获取：`open('wx', 0600)`；已存在则读。
   230	- 心跳 5s，stale 阈值 30s；更新用原子替换 + fsync。
   231	- **fencing**：每次 journal 写（op append、manifest 写、marker 创建）前，
   232	  读取 lock 并校验 `ownerToken` == 当前持有者 token；不等 → 立即中止并置
   233	  CONFLICTED（老 owner 被接管后不能继续写）。
   234	- 接管：先 `kill(pid,0)` 检查旧 pid；旧 pid 不存在且 heartbeat stale →
   235	  允许替换 lock（新 token、epoch+1）；旧 pid 存活或无法判定 → repair 需
   236	  `--force`，host 永不 force。
   237	- 边界：锁只约束协作进程；非协作写入按 §1 best-effort。
   238	
   239	## 10. JournalPort（EffectPorts）
   240	
   241	```ts
   242	interface FileState { exists: boolean; hash: string | null }
   243	interface OpRecord { v: 1; opId: string; seq: number; kind: 'FORWARD'|'ROLLBACK';
   244	  phase: 'INTENDED'|'CONFIRMED'|'CANCELLED'; expected: FileState;
   245	  next: FileState; before: FileState; mode?: string; length?: number }
   246	
   247	interface JournalPort {
   248	  begin(targets: TargetSpec[]): Promise<TxId>                 // PREPARING→PREPARED
   249	  writeTarget(tx: TxId, rel: string, next: FileState & { data?: Uint8Array; mode?: string }): Promise<void>
   250	  deleteTarget(tx: TxId, rel: string): Promise<void>          // present→absent
   251	  commitFiles(tx: TxId): Promise<void>                        // 终检+COMMITTED marker
   252	  rollback(tx: TxId): Promise<void>                           // §6.3 回滚
   253	  scan(): Promise<RecoveryReport>                             // 只读
   254	  recover(): Promise<RecoveryReport>                          // RECOVERABLE 自动恢复
   255	  resolveConflict(tx: TxId, action: 'restore-snapshot'|'accept-current',
   256	                  validateBaseline: (tx: TxId) => Promise<BaselineReport>): Promise<Report>
   257	}
   258	```
   259	- `writeTarget`/`deleteTarget` 内部强制 §5.2/§5.3 全顺序；调用方无法只
   260	  prepare 不 confirm，从而 contract test 能强制协议。
   261	- JournalPort **不包含业务状态机**；install-core 决定调用顺序和动作。
   262	- `resolveConflict` 只负责 journal 封存/回滚执行与记录；一致性校验通过
   263	  注入的 `validateBaseline` 完成。
   264	
   265	## 11. 文件系统前提
   266	
   267	- 支持 POSIX 与 Windows NTFS；要求 rename 同文件系统、父目录 fsync 可用。
   268	- target 为 symlink 时拒绝（lstat）；父目录 no-follow。
   269	- present→present 保留原 mode；新文件 0600；删除协议不恢复 mode。
   270	- 不支持无目录 fsync 语义的文件系统（检测不到时按 best-effort 记录警告）。
   271	
   272	## 12. 测试矩阵（M2a contract tests）
   273	
   274	除 v1 矩阵外，必须覆盖：
   275	1. 连续多写 `A→B→C`，在每次 INTENDED/替换/CONFIRMED 前后 kill。
   276	2. 正向 CONFIRMED 后回滚 INTENDED 崩溃 → reducer 仍以 owned=B 继续回滚。
   277	3. 回滚 CONFIRMED.next == before 的唯一匹配。
   278	4. absent→present、present→absent、absent→absent 拒绝；unlink 后、父
   279	   fsync 前崩溃。
   280	5. FILE_COMMITTED manifest 与 marker 四种先后组合（尤其
   281	   manifest=FILE_COMMITTED 且无 marker → 回滚）。
   282	6. manifest 缺失但 tx 目录残留 → RECOVERABLE_NOOP。
   283	7. JSONL 尾行截断可恢复；其他损坏 → UNRECOVERABLE。
   284	8. 多文件在第一/中间/最后 target 崩溃；一文件冲突时零 target 被恢复。
   285	9. evidence 复制/report/manifest.state 三步各自崩溃 → 最终 CONFLICTED。
   286	10. tombstone rename 前/后崩溃 → 幂等清理。
   287	11. stale lock 接管后旧 owner 再次 journal 写 → 被 fencing 拒绝。
   288	12. 检查→rename、终检→marker 窗口注入非协作写入 → 记录预期结果
   289	    （可检测或已知不可检测窗口，均需显式断言）。
   290	13. kill -9 矩阵 + 确定性 failpoint model test 双轨验证；不变量：
   291	    无 marker 永不保留 owned 写；有 marker 永不自动回滚。
   292	
   293	## 13. 明确不在本规格范围
   294	
   295	- 插件激活 / PENDING_ACTIVATION（另立 ACTIVATION-SPEC）。
   296	- inspectArtifact / tarball 校验（另立 ARTIFACT-SPEC）。
   297	- pnpm/dsh CLI 执行细节（PackageManagerPort）。
   298	- 备份、WebDAV、Gist。
   299	
   300	## 14. 与 PLAN-v4 状态命名映射
   301	
   302	PLAN-v4 的 `DIRTY` = 本规格 `CONFLICTED | UNRECOVERABLE`。后续 PLAN 统一
   303	使用本规格命名，实现与验收只使用一套状态。

codex
初步结论已经明确：v2 修正了术语和若干持久化顺序，但核心闭环仍未成立。最关键的反例是 `A→B→C`：reducer 用同一个物理 `current=C` 逐条匹配历史 op，处理第一条 `A→B CONFIRMED` 时就会误判冲突；此外，“只读分类”本身又会追加日志，破坏了事务级零写预检。接下来我会把这些反例映射回六个 v1 阻断项并区分真正阻断与重要问题。
codex
## 总体结论

**6 个 v1 阻断项没有全部解除，`JOURNAL-SPEC.md v2` 目前仍不能作为 M2a 的正式实现契约。**

| v1 阻断项 | v2 状态 | 结论 |
|---|---|---|
| 1. 多次写/回滚二次崩溃 | 未解除 | reducer 对历史 op 使用同一个物理 `current`，`A→B→C` 会误判冲突 |
| 2. `(exists,hash)` 与删除 | 基本解除 | 状态统一、durable unlink 已定义；但 mode、snapshot 完整性仍不充分 |
| 3. marker/滞后/清理 | 部分解除 | marker 顺序已修正；OUTCOME 恢复优先级和 tombstone 持久化仍有缺口 |
| 4. repair 确定终态 | 未解除 | 真正的冲突无法进入 restore，且执行中仍会产生部分文件恢复 |
| 5. JournalPort 写协议 | 部分解除 | 高层原语方向正确，但类型允许非法输入，commit 前置条件不足，repair 职责仍混杂 |
| 6. 保证边界与 fencing | 部分解除 | 非协作 best-effort 边界已澄清，但当前 fencing 不能真正隔离旧 owner |

因此，建议完成第三轮修订后再冻结为 M2a contract。

## 阻断项

### 1. reducer 仍不能处理连续多写，且不是纯 reducer

[`§6.2`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:130) 对每个历史 op 都拿同一个物理 `current` 做比较。

反例：

1. before=`A`
2. `A→B CONFIRMED`
3. `B→C CONFIRMED`
4. 崩溃时 current=`C`

处理第一条 op 时，`C != B` 且 `C != owned(A)`，立即进入 CONFLICT。也就是说，[测试矩阵第 1 项](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:275) 按当前算法必然失败。多次写后再进入回滚也存在同类问题。

更危险的是，当 current 恰好等于历史状态时，`CONFIRMED/current == owned` 可能把没有对应回滚 op 的外部改回误认为“已恢复/已替换”，随后自动覆盖。

正确结构应是：

- 先仅根据日志校验 phase 转移、`expected == 前一 owned`，并归约出逻辑 frontier；
- 已完成的历史 CONFIRMED 不与当前文件逐条比较；
- 最后只用 current 判断最终 frontier 或最后一个未决 INTENDED 是“未执行、已执行未确认、还是冲突”；
- `kind=ROLLBACK` 必须参与状态转移，而不是只记录不用。

此外，[`§6.3`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:148) 称第一阶段为“只读分类”，但 reducer 表内会追加 CANCELLED/CONFIRMED。这会在尚未完成全目标预检时修改 journal。应拆成纯 `reduce → RecoveryPlan` 和持锁执行两个阶段。

### 2. `restore-snapshot` 对真正的 CONFLICTED 事务不可用，也不能保证无部分成功

[`restore-snapshot` 第 2 步](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:205) 规定只要任一 target 的 reducer 得到 `hasConflict` 就中止。可是该动作正是用来处理 CONFLICTED 的；一个真正被外部修改的 target 永远无法通过该预检，因此动作只能处理“冲突已自行消失”的特殊情况。

第 3 步又明确允许部分 target 已 CONFIRMED 回滚、后续 target 冲突后停止。“不宣称成功”不等于“绝无部分成功”：此时 live profile 已经是部分 before、部分 current 的混合集。

需要定义独立的 resolution transaction：

- 先验证全部 snapshot、记录全部当前状态并生成不可变计划；
- 用户授权后，以预检时的 current 作为每个 target 的 expected；
- 中断后进入明确的 `RESOLVING/RESOLUTION_CONFLICTED` 状态并可确定性续跑；
- 若要求物理全有或全无，则普通多文件 rename 无法提供，规格必须改成“允许有持久化进度，但绝不把部分进度报告为成功”。

### 3. fencing token 不能提供规格承诺的协作隔离

[`§9`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:229) 只是“写前读取 token”，检查和实际 append/rename/unlink 之间仍是 TOCTOU：

1. 老 owner 校验 token；
2. 老 owner 暂停；
3. repair 强制接管；
4. 老 owner恢复并继续 append 或修改 target。

尤其 fencing 只列出了 journal 写，根本没有要求 target rename/unlink 前校验。即使补一次校验，校验与文件修改也不是原子的。

另外，token 不匹配后要求“置 CONFLICTED”也无法执行：老 owner 已无权写 manifest。允许 `--force` 在旧 PID 存活或无法判断时接管，则明确制造双 owner。

在普通文件系统上，应采用不能被活进程强制窃取的 OS 锁；`--force` 只应在能够确认旧进程死亡后执行写操作。否则协作进程间“不存在静默覆盖”的保证不能成立。

### 4. OUTCOME 与 tombstone 的恢复优先级没有闭环

marker 与 FILE_COMMITTED 的顺序已经修正：marker 先落盘、manifest 后更新，这部分成立。

但 [`§6.3`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:148) 的恢复分支没有读取 OUTCOME。若 `accept-current` 已写 `OUTCOME=ACCEPTED_CURRENT`，却在 tombstone rename 前崩溃，下次扫描可能重新运行旧的冲突 reducer，而不是继续清理。

此外：

- `journal→trash` 是跨两个父目录的 rename，[清理协议](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:180) 应明确 fsync `journal/` 和 `trash/` 两个目录；
- “journal 半删除残骸一律 RECOVERABLE_NOOP”不安全。缺少有效 marker/OUTCOME 时不能证明语义已定；
- manifest 缺失的“初建垃圾目录”和异常半残 journal 应区分，后者应 UNRECOVERABLE。

需要明确扫描优先级，例如：有效 tombstone → 仅清理；有效终态 OUTCOME → 续做 tombstone；否则 marker 决定提交与否；再运行 reducer。

## 重要问题

### 1. op 日志缺少结构不变量

[`op schema`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:82) 尚未要求验证：

- 每个 op 的 before 必须等于 manifest baseline；
- 新 op 的 expected 必须等于前一逻辑 owned；
- phase 只能 `INTENDED→CONFIRMED|CANCELLED`；
- opId、seq、targetKey、kind 必须一致；
- next/data/hash/length/mode 必须互相匹配；
- snapshot hash 必须等于 before.hash。

当前只检查 seq 跳变和重复 CONFIRMED，不足以防实现 bug 或 journal 损坏导致错误恢复。

### 2. JournalPort 仍允许绕过合法状态

[`writeTarget`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:247) 接收调用方提供的 FileState，且 data 可选，因此可以传入：

- `exists:true` 但无 data；
- data 与 hash 不一致；
- `exists:false`，绕过专门的 deleteTarget；
- 不合法的 `hash:null` 组合。

建议 `writeTarget` 只接收 bytes/mode，由 JournalPort 自己计算 hash 和 next；delete 使用独立方法。`commitFiles` 也应明确拒绝未决 INTENDED、无 CONFIRMED 的声明 target，以及异常状态迁移。

`resolveConflict` 仍在 JournalPort 内编排业务一致性校验。即使通过 callback 注入，它仍跨越了 journal 持久化边界；更清晰的做法是由 RepairService 编排 JournalPort 与 BaselineValidatorPort。

### 3. mode、snapshot 与平台持久化语义不足

FileState 只覆盖内容，snapshot 也只说明保存 bytes，但回滚现存文件需要可靠保存并校验原 mode。present→present 的“保留 before mode”还需规定在 tmp fsync 前设置 mode。

同时，“支持 Windows NTFS”“要求父目录 fsync”“不可用时仅 warning”三者不能同时构成强崩溃保证。需要按 adapter 明确哪些平台满足 durable contract，哪些只提供降级保证。

### 4. 测试矩阵仍不足以冻结契约

[`§12`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:272) 有明显进步，也会直接发现当前多写 reducer 错误，但仍有缺口：

- “除 v1 矩阵外”使 v2 不是自包含契约，应完整纳入全部用例；
- 缺少 restore/accept-current 每一步崩溃、重试及多文件部分进度；
- 缺少 OUTCOME 已写但尚未 tombstone 的恢复；
- 缺少 malformed op chain、snapshot hash/mode 损坏；
- 缺少 fencing 检查后、实际 journal/target 写前被接管的竞争；
- 缺少 `A→B→A`、same-state no-op、提交态创建/删除组合；
- 缺少 JournalPort 非法参数及非法调用顺序测试。

“无 marker 永不保留 owned 写”还应限定为“恢复成功返回终态后”；在 rename 后、恢复前，短暂存在无 marker 的 owned 写是协议本身允许的。

## 建议优化

- 将 reducer 明确定义为无副作用纯函数：`JournalEvidence → Classification + PlannedAppends + PlannedWrites`。
- 为日志解析、逻辑归约、物理 current 判定分别给出伪代码，避免一张表同时承担三种语义。
- 为 repair 增加独立 resolution 状态和 op kind，避免复用普通自动回滚语义。
- 给 marker、OUTCOME、tombstone、manifest 制定一张全组合优先级表。
- 用小型状态机/model test 穷举两次正向写、一次回滚、任意两个 crash point及外部写入，而不只依赖手写场景。

本轮仅使用只读方式检查了指定文件及 v1→v2 diff，没有修改仓库，也没有联网。
tokens used
44,033
## 总体结论

**6 个 v1 阻断项没有全部解除，`JOURNAL-SPEC.md v2` 目前仍不能作为 M2a 的正式实现契约。**

| v1 阻断项 | v2 状态 | 结论 |
|---|---|---|
| 1. 多次写/回滚二次崩溃 | 未解除 | reducer 对历史 op 使用同一个物理 `current`，`A→B→C` 会误判冲突 |
| 2. `(exists,hash)` 与删除 | 基本解除 | 状态统一、durable unlink 已定义；但 mode、snapshot 完整性仍不充分 |
| 3. marker/滞后/清理 | 部分解除 | marker 顺序已修正；OUTCOME 恢复优先级和 tombstone 持久化仍有缺口 |
| 4. repair 确定终态 | 未解除 | 真正的冲突无法进入 restore，且执行中仍会产生部分文件恢复 |
| 5. JournalPort 写协议 | 部分解除 | 高层原语方向正确，但类型允许非法输入，commit 前置条件不足，repair 职责仍混杂 |
| 6. 保证边界与 fencing | 部分解除 | 非协作 best-effort 边界已澄清，但当前 fencing 不能真正隔离旧 owner |

因此，建议完成第三轮修订后再冻结为 M2a contract。

## 阻断项

### 1. reducer 仍不能处理连续多写，且不是纯 reducer

[`§6.2`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:130) 对每个历史 op 都拿同一个物理 `current` 做比较。

反例：

1. before=`A`
2. `A→B CONFIRMED`
3. `B→C CONFIRMED`
4. 崩溃时 current=`C`

处理第一条 op 时，`C != B` 且 `C != owned(A)`，立即进入 CONFLICT。也就是说，[测试矩阵第 1 项](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:275) 按当前算法必然失败。多次写后再进入回滚也存在同类问题。

更危险的是，当 current 恰好等于历史状态时，`CONFIRMED/current == owned` 可能把没有对应回滚 op 的外部改回误认为“已恢复/已替换”，随后自动覆盖。

正确结构应是：

- 先仅根据日志校验 phase 转移、`expected == 前一 owned`，并归约出逻辑 frontier；
- 已完成的历史 CONFIRMED 不与当前文件逐条比较；
- 最后只用 current 判断最终 frontier 或最后一个未决 INTENDED 是“未执行、已执行未确认、还是冲突”；
- `kind=ROLLBACK` 必须参与状态转移，而不是只记录不用。

此外，[`§6.3`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:148) 称第一阶段为“只读分类”，但 reducer 表内会追加 CANCELLED/CONFIRMED。这会在尚未完成全目标预检时修改 journal。应拆成纯 `reduce → RecoveryPlan` 和持锁执行两个阶段。

### 2. `restore-snapshot` 对真正的 CONFLICTED 事务不可用，也不能保证无部分成功

[`restore-snapshot` 第 2 步](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:205) 规定只要任一 target 的 reducer 得到 `hasConflict` 就中止。可是该动作正是用来处理 CONFLICTED 的；一个真正被外部修改的 target 永远无法通过该预检，因此动作只能处理“冲突已自行消失”的特殊情况。

第 3 步又明确允许部分 target 已 CONFIRMED 回滚、后续 target 冲突后停止。“不宣称成功”不等于“绝无部分成功”：此时 live profile 已经是部分 before、部分 current 的混合集。

需要定义独立的 resolution transaction：

- 先验证全部 snapshot、记录全部当前状态并生成不可变计划；
- 用户授权后，以预检时的 current 作为每个 target 的 expected；
- 中断后进入明确的 `RESOLVING/RESOLUTION_CONFLICTED` 状态并可确定性续跑；
- 若要求物理全有或全无，则普通多文件 rename 无法提供，规格必须改成“允许有持久化进度，但绝不把部分进度报告为成功”。

### 3. fencing token 不能提供规格承诺的协作隔离

[`§9`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:229) 只是“写前读取 token”，检查和实际 append/rename/unlink 之间仍是 TOCTOU：

1. 老 owner 校验 token；
2. 老 owner 暂停；
3. repair 强制接管；
4. 老 owner恢复并继续 append 或修改 target。

尤其 fencing 只列出了 journal 写，根本没有要求 target rename/unlink 前校验。即使补一次校验，校验与文件修改也不是原子的。

另外，token 不匹配后要求“置 CONFLICTED”也无法执行：老 owner 已无权写 manifest。允许 `--force` 在旧 PID 存活或无法判断时接管，则明确制造双 owner。

在普通文件系统上，应采用不能被活进程强制窃取的 OS 锁；`--force` 只应在能够确认旧进程死亡后执行写操作。否则协作进程间“不存在静默覆盖”的保证不能成立。

### 4. OUTCOME 与 tombstone 的恢复优先级没有闭环

marker 与 FILE_COMMITTED 的顺序已经修正：marker 先落盘、manifest 后更新，这部分成立。

但 [`§6.3`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:148) 的恢复分支没有读取 OUTCOME。若 `accept-current` 已写 `OUTCOME=ACCEPTED_CURRENT`，却在 tombstone rename 前崩溃，下次扫描可能重新运行旧的冲突 reducer，而不是继续清理。

此外：

- `journal→trash` 是跨两个父目录的 rename，[清理协议](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:180) 应明确 fsync `journal/` 和 `trash/` 两个目录；
- “journal 半删除残骸一律 RECOVERABLE_NOOP”不安全。缺少有效 marker/OUTCOME 时不能证明语义已定；
- manifest 缺失的“初建垃圾目录”和异常半残 journal 应区分，后者应 UNRECOVERABLE。

需要明确扫描优先级，例如：有效 tombstone → 仅清理；有效终态 OUTCOME → 续做 tombstone；否则 marker 决定提交与否；再运行 reducer。

## 重要问题

### 1. op 日志缺少结构不变量

[`op schema`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:82) 尚未要求验证：

- 每个 op 的 before 必须等于 manifest baseline；
- 新 op 的 expected 必须等于前一逻辑 owned；
- phase 只能 `INTENDED→CONFIRMED|CANCELLED`；
- opId、seq、targetKey、kind 必须一致；
- next/data/hash/length/mode 必须互相匹配；
- snapshot hash 必须等于 before.hash。

当前只检查 seq 跳变和重复 CONFIRMED，不足以防实现 bug 或 journal 损坏导致错误恢复。

### 2. JournalPort 仍允许绕过合法状态

[`writeTarget`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:247) 接收调用方提供的 FileState，且 data 可选，因此可以传入：

- `exists:true` 但无 data；
- data 与 hash 不一致；
- `exists:false`，绕过专门的 deleteTarget；
- 不合法的 `hash:null` 组合。

建议 `writeTarget` 只接收 bytes/mode，由 JournalPort 自己计算 hash 和 next；delete 使用独立方法。`commitFiles` 也应明确拒绝未决 INTENDED、无 CONFIRMED 的声明 target，以及异常状态迁移。

`resolveConflict` 仍在 JournalPort 内编排业务一致性校验。即使通过 callback 注入，它仍跨越了 journal 持久化边界；更清晰的做法是由 RepairService 编排 JournalPort 与 BaselineValidatorPort。

### 3. mode、snapshot 与平台持久化语义不足

FileState 只覆盖内容，snapshot 也只说明保存 bytes，但回滚现存文件需要可靠保存并校验原 mode。present→present 的“保留 before mode”还需规定在 tmp fsync 前设置 mode。

同时，“支持 Windows NTFS”“要求父目录 fsync”“不可用时仅 warning”三者不能同时构成强崩溃保证。需要按 adapter 明确哪些平台满足 durable contract，哪些只提供降级保证。

### 4. 测试矩阵仍不足以冻结契约

[`§12`](/home/ivmm/daohang/toolso-ai-open/cordis-mp/JOURNAL-SPEC.md:272) 有明显进步，也会直接发现当前多写 reducer 错误，但仍有缺口：

- “除 v1 矩阵外”使 v2 不是自包含契约，应完整纳入全部用例；
- 缺少 restore/accept-current 每一步崩溃、重试及多文件部分进度；
- 缺少 OUTCOME 已写但尚未 tombstone 的恢复；
- 缺少 malformed op chain、snapshot hash/mode 损坏；
- 缺少 fencing 检查后、实际 journal/target 写前被接管的竞争；
- 缺少 `A→B→A`、same-state no-op、提交态创建/删除组合；
- 缺少 JournalPort 非法参数及非法调用顺序测试。

“无 marker 永不保留 owned 写”还应限定为“恢复成功返回终态后”；在 rename 后、恢复前，短暂存在无 marker 的 owned 写是协议本身允许的。

## 建议优化

- 将 reducer 明确定义为无副作用纯函数：`JournalEvidence → Classification + PlannedAppends + PlannedWrites`。
- 为日志解析、逻辑归约、物理 current 判定分别给出伪代码，避免一张表同时承担三种语义。
- 为 repair 增加独立 resolution 状态和 op kind，避免复用普通自动回滚语义。
- 给 marker、OUTCOME、tombstone、manifest 制定一张全组合优先级表。
- 用小型状态机/model test 穷举两次正向写、一次回滚、任意两个 crash point及外部写入，而不只依赖手写场景。

本轮仅使用只读方式检查了指定文件及 v1→v2 diff，没有修改仓库，也没有联网。
