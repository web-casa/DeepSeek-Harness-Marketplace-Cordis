# cordis-mp 持久化事务 Journal 正式规格 v3

> 状态：v3，待 Codex 第三轮 review
> v3 修订：修复 v2 评审 4 个阻断项：
> ① reducer 拆为无副作用逻辑归约 + 物理 current 判定，支持 A→B→C 与回滚二次崩溃；
> ② restore-snapshot 改为独立 RESOLUTION 事务，允许持久化进度但绝不虚报成功；
> ③ 锁规则改为“活进程禁止接管”，token fencing 只作纵深防御并明确 TOCTOU 边界；
> ④ 扫描优先级明确：tombstone → OUTCOME → COMMITTED marker → reducer，清理双目录 fsync。

## 1. 范围与保证

本规格定义 cordis-mp mutation 对 profile 文本文件写入的崩溃恢复协议。
target rel 路径封闭 allowlist：`package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml`、`.cordis-mp/state.json`。

保证分级：
- **协作保证**：遵守 §9 锁规则的进程之间不存在静默覆盖；锁禁止活进程被
  force 接管，因此旧 owner 恢复后继续写的情况被排除。
- **非协作 best-effort**：不参与锁的外部 `dsh plugin`/手工编辑通过写前检查
  检测；不可检测窗口为“检查后到 rename/unlink 前”与“终检后到 marker 前”。
  检测到即 CONFLICTED 并保全证据。
- **平台分级**：POSIX（父目录 fsync 可用）为 FULL durability；其他平台
  （含 Windows 未实现目录 FlushFileBuffers 时）为 BEST_EFFORT，诊断中明示。

## 2. 基本类型

- `FileState = { exists: boolean, hash: string | null }`；存在时
  `hash="sha256:<hex>"`，不存在时 `exists:false, hash:null`。
- `FileMeta = FileState & { mode?: string }`（mode 记录 before 权限）。
- `targetKey = sha256(rel)`。
- `opId = "<txid>-<seq>"`。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json
  journal/<txid>/{manifest.json, snapshots/<key>.bin, ops/<key>.jsonl,
                 COMMITTED, OUTCOME.json}
  conflicts/<txid>/{evidence/..., report.json, accepted-<ts>/...}
  trash/<txid>-<ts>/
```

journal/trash/conflicts 0700；文件 0600；父目录 lstat no-follow。

## 4. 状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
CONFLICTED ──用户 authorize──→ RESOLVING → RESOLVED|RESOLUTION_CONFLICTED
manifest 损坏/未知 schema/无法解释日志 ──→ UNRECOVERABLE
```

- `FILE_COMMITTED` 仅是 manifest 信息；**COMMITTED marker 是提交唯一权威**。
- `ROLLING_BACK`：自动回滚 op 已 INTENDED。
- `RESOLVING`：用户授权的 restore-snapshot 事务执行中；允许持久化进度，
  只有全部 target 回到 before 才写 `OUTCOME=RESOLVED`。

## 5. Op 日志协议

### 5.1 op schema
```json
{ "v":1, "opId":"<txid>-3", "seq":3,
  "kind":"FORWARD"|"ROLLBACK"|"RESOLUTION",
  "phase":"INTENDED"|"CONFIRMED"|"CANCELLED",
  "expected":{"exists":true,"hash":"sha256:B"},
  "next":{"exists":true,"hash":"sha256:C"},
  "before":{"exists":true,"hash":"sha256:A"},
  "mode":"0644","length":123 }
```
- `before` 必须等于 manifest baseline 的 before；
- 每 target 的 op 序列按 seq 递增；同 opId 只允许
  `INTENDED→CONFIRMED` 或 `INTENDED→CANCELLED`；重复 CONFIRMED 非法。

### 5.2 写协议（JournalPort.writePresent / delete 内部执行）
1. 追加 INTENDED（append+fsync file+fsync dir）；
2. 锁校验 + 乐观检查：current == expected，否则 CONFLICTED 不写；
3. 替换：
   - present→present：tmp 同目录随机名 `wx`，写 bytes，**在 fsync 前设置
     before.mode**，fsync file，rename，fsync 父目录；
   - absent→present：同上，mode 0600；
   - present→absent：unlink + fsync 父目录；
4. 复读校验 current == next，否则 CONFLICTED；
5. 追加 CONFIRMED。

### 5.3 提交
1. 每个 target 最后 op 必须 CONFIRMED，无 pending INTENDED；
2. 复读 current == 最后 CONFIRMED.next；
3. 全等 → 创建 COMMITTED marker（tmp+rename+fsync 目录）；
4. 写 manifest.state=FILE_COMMITTED（仅信息，允许滞后）。

## 6. 恢复算法

### 6.1 扫描优先级（v3 新增，逐条短路）
1. `trash/*` 存在 → 只继续递归删除，不解释内容。
2. `journal/<txid>/OUTCOME.json` 有效 → 按 OUTCOME 续做：
   - `ROLLED_BACK|COMMITTED|ACCEPTED_CURRENT` → tombstone；
   - `RESOLVING|RESOLUTION_CONFLICTED` → 进入 §7 resolution 恢复。
3. `COMMITTED` marker 存在 → §6.4，永不回滚。
4. 否则 → §6.2/§6.3 未提交路径。
5. `journal/<txid>` 存在但无 manifest：
   - 目录为空或仅含 `*.tmp` → RECOVERABLE_NOOP 删除；
   - 含 snapshots/ops/marker 等 → UNRECOVERABLE（半残 journal）。

### 6.2 纯逻辑归约（无副作用，不读 current）
对每 target 解析 op 日志并校验链式不变量：
- `op.before == baseline.before`；
- 首 op `expected == baseline.before`；后续 op `expected == 前一逻辑 owned`；
- phase 转移合法；seq 连续；kind 参与转移：
  - `CONFIRMED` ⇒ owned = op.next；
  - `CANCELLED` ⇒ owned 不变；
  - `INTENDED` 必须是最后一条（至多一个 pending）。
- 校验失败 → UNRECOVERABLE（不是冲突）。

输出：`lastConfirmedOwned`（最后一个 CONFIRMED 的 next，无则 before）、
`pending`（末尾未决 INTENDED 或 null）。

### 6.3 物理 current 判定（仅用于最后状态）
- 无 pending：`current == lastConfirmedOwned` → consistent，否则 CONFLICT。
- 有 pending：
  - `current == pending.expected`（= 归约 owned）→ 计划追加 CANCELLED；
  - `current == pending.next` → 计划追加 CONFIRMED，owned=pending.next；
  - 其他 → CONFLICT。
- 归约结果 = `owned`；`pendingRollback = owned != before`。

说明：历史 CONFIRMED 不与 current 逐条比较，因此 `A→B→C` 时
current=C、owned=C，不会误判；`A→B→A` 时 owned=A 与 before 相同，
pendingRollback=false，合法。

### 6.4 事务级恢复（两阶段）
**Phase 1 只读**：对所有 target 执行 §6.2/§6.3 得到 plan：
`{appends[], pendingRollbackSet, conflictSet}`；不写任何文件。
**Phase 2 持锁执行**：
- conflictSet 非空 → archiveConflict + CONFLICTED；
- 否则先执行 appends（CANCELLED/CONFIRMED），再对 pendingRollbackSet 的
  每个 target 生成 ROLLBACK op 执行写协议（expected=owned, next=before）；
  全部达到 before → ROLLED_BACK → OUTCOME → tombstone。
- Phase 2 中再冲突：已 CONFIRMED 的回滚进度留在 op 日志中，事务置
  CONFLICTED；下一次 repair 按同一算法继续（幂等收敛），**不得报告成功**。

多 tx 按 manifest.createdAt 升序逐个恢复；存在未清理 tx 时 host 拒绝新
mutation。

### 6.5 COMMITTED 路径
对每个 target：
- 最后 op CONFIRMED 且 `current == 该 op.next` → OK；
- 其他 → CONFLICTED（提交后被外部改），不回滚。
全部 OK → OUTCOME=COMMITTED → tombstone。

## 7. Repair 与冲突处置

`cordis-mp repair --profile web [--tx txid] [--action restore-snapshot|accept-current] [--yes] [--force]`

### 7.1 冲突证据（archiveConflict）
1. 复制 current 文件（或写 absent marker）到 evidence/（tmp+rename+fsync，
   校验 hash）；
2. 复制 manifest/ops/snapshots；
3. 原子写 report.json；
4. manifest.state=CONFLICTED。
崩溃恢复：report.json 存在即权威，补全 evidence 后置 CONFLICTED。

### 7.2 restore-snapshot（独立 RESOLUTION 事务）
- 前置：所有 target 的 before snapshot 完整且 hash 可验证；任一 snapshot
  缺失/损坏 → 该动作不可用，报告 UNRECOVERABLE_RESTORE。
- 生成不可变 resolution plan：每 target `expected = 当前 current（计划时
  快照）`、`next = before`、`kind=RESOLUTION`；要求用户显式确认。
- 执行：对每 target 写 RESOLUTION op（§5.2 协议）。中断后续跑：OUTCOME 或
  manifest 置 `RESOLVING`；再次 repair 时按 §6.1 优先级继续。
- 终态：全部 target == before → OUTCOME=RESOLVED → tombstone；
  任一 target 因新外部编辑冲突 → `RESOLUTION_CONFLICTED`，已恢复的 target
  是持久化进度并如实展示，**绝不报告整体成功**。
- 明确放弃“跨文件物理原子性”：多文件恢复允许持久化部分进度，但成功
  声明以全量校验为准。

### 7.3 accept-current
1. 封存旧 journal 到 `conflicts/<txid>/accepted-<ts>/`（copy+fsync，不改旧件）；
2. 调用 `BaselineValidatorPort.validateCurrentProfile()`（独立于
   JournalPort）：manifest 可解析；`pnpm install --lockfile-only
   --frozen-lockfile` 只读检查通过；patch/state 可解析；
3. 通过 → OUTCOME=ACCEPTED_CURRENT → tombstone；失败 → 保持 CONFLICTED，
   report 记 `resolution-failed`。

## 8. 清理（tombstone）

- 终态写 OUTCOME（原子写+fsync journal 目录）后：
  1. `rename(journal/<txid>, trash/<txid>-<ts>)`；
  2. fsync `journal/` 与 `trash/` 两个父目录；
  3. 递归删除 trash。
- 同文件系统 rename 是前提；跨设备不适用（journal 与 trash 同根，自然满足）。
- 扫描时 trash 只删除；没有有效 OUTCOME/marker 的 journal 残骸不当作 trash。

## 9. 跨进程锁与 fencing

`lock.json`：
```json
{ "owner":"host|repair", "bootId":"...", "pid":123, "processStartToken":"...",
  "ownerToken":"...", "epoch":1, "acquiredAt":"...", "heartbeatAt":"..." }
```
- 获取：`open('wx', 0600)`；心跳 5s；stale 30s；更新原子替换+fsync。
- **接管规则（v3）**：
  - 必须先验证旧 pid 已死亡：POSIX 比较 `/proc/<pid>` 存在性与
    `processStartToken`（进程启动时间）；其他平台用平台等效 API；
  - 旧 pid 存活 → repair 拒绝执行写，host 永不接管；
  - 旧 pid 死亡 → 允许替换 lock（新 token，epoch+1）；
  - 无法判定死亡（无等效 API）→ 只读诊断，不接管；`--force` 仅在用户
    明确确认“进程已手工终止”后允许，并记录 warning。
- fencing 纵深防御：每次 journal 写与 target 写前读 lock 校验 ownerToken；
  不匹配 → 中止。该检查与后续写非原子，但活进程接管已被禁止，协作进程
  不会出现双 owner；TOCTOU 只影响非协作写入，归入 §1 best-effort。

## 10. 接口

### 10.1 JournalPort
```ts
interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>
  writePresent(tx: TxId, rel: string, data: Uint8Array): Promise<void> // hash 由实现计算
  delete(tx: TxId, rel: string): Promise<void>
  commitFiles(tx: TxId): Promise<void>
  rollback(tx: TxId): Promise<void>            // 自动回滚（§6.4）
  scan(): Promise<RecoveryReport>              // 只读
  recover(): Promise<RecoveryReport>           // 自动 RECOVERABLE
  archiveConflict(tx: TxId): Promise<void>
  beginResolution(tx: TxId, plan: ResolutionPlan): Promise<void>
  resolveTarget(tx: TxId, rel: string): Promise<void> // 执行计划中该 target 的 RESOLUTION op
  completeResolution(tx: TxId): Promise<Report>
}
```
- `writePresent` 只接受 bytes；hash/next 由 JournalPort 计算，杜绝
  `exists:true 无 data`、hash 不一致等非法输入。
- `commitFiles` 前置：所有声明 target 最后 op CONFIRMED；否则返回
  JOURNALLED 错误。
- JournalPort 不编排业务校验。

### 10.2 RepairService（install-core）
编排 `JournalPort + BaselineValidatorPort`：
- 读 scan → 分类；
- RECOVERABLE → recover；
- restore-snapshot → 验证 snapshot → 生成 plan → beginResolution /
  resolveTarget / completeResolution；
- accept-current → archive + BaselineValidatorPort + completeResolution。
- BaselineValidatorPort 只读：`validateCurrentProfile(): Promise<BaselineReport>`。

## 11. 测试矩阵（自包含）

A. 逻辑归约：
1. before=A；`A→B CONFIRMED`、`B→C CONFIRMED`，current=C → owned=C 不冲突。
2. `A→B→A`，current=A → owned=A，pendingRollback=false。
3. 回滚 `B→A INTENDED` 崩溃，current=B → 计划 CONFIRMED 后继续回滚。
4. 回滚 INTENDED 被 CANCELLED → owned 仍为 B，继续生成新回滚 op。
5. malformed chain（expected≠前一 owned、seq 跳变、重复 CONFIRMED、
   before≠baseline、双 pending）→ UNRECOVERABLE。

B. 物理写入：
6. present→present / absent→present / present→absent 在每步崩溃；
   absent→absent 拒绝。
7. mode 保留与恢复校验；snapshot hash 校验。
8. 非协作写入注入在检查→rename、终检→marker 窗口 → 预期 CONFLICTED
   （可检测）或文档化不可检测窗口。

C. 提交与清理：
9. COMMITTED marker 前/后崩溃；manifest=FILE_COMMITTED 但无 marker → 回滚。
10. OUTCOME 已写未 tombstone；tombstone rename 前/后崩溃；trash 残骸只删除。
11. 无 manifest：空目录 → NOOP；有 ops/snapshots → UNRECOVERABLE。

D. 冲突与 repair：
12. evidence 复制/report/state 三步各自崩溃。
13. restore-snapshot：resolution 计划后每 target 写前/写后崩溃、二次崩溃、
    中途新外部编辑 → RESOLUTION_CONFLICTED，进度可见，绝不报成功。
14. snapshot 缺失/损坏 → UNRECOVERABLE_RESTORE。
15. accept-current 校验失败 → 保持 CONFLICTED，不 UNRECOVERABLE。

E. 锁：
16. 活 pid 拒绝接管；死 pid 接管后旧 owner token 失效；
    force 路径记录 warning；接管竞态测试。
17. 多 tx 恢复顺序与 host 新 mutation 拒绝。

F. 契约：
18. JournalPort 非法输入与非法调用顺序（writePresent data 缺、commitFiles
    有 pending、未 begin 等）返回 JOURNALLED。
19. 全矩阵同时用 kill -9 与确定性 failpoint model test 双轨运行。
20. 不变量：恢复成功返回终态后，无 marker 不保留 owned 写；有 marker 永不
    自动回滚。

## 12. 明确不在本规格范围
- 插件激活 / PENDING_ACTIVATION（ACTIVATION-SPEC）。
- inspectArtifact / tarball（ARTIFACT-SPEC）。
- pnpm/dsh CLI 细节（PackageManagerPort）。
- 备份、WebDAV、Gist。

## 13. 与 PLAN-v4 状态命名映射
PLAN-v4 的 `DIRTY` = `CONFLICTED | RESOLUTION_CONFLICTED | UNRECOVERABLE`。
实现与验收只使用本规格状态名。
