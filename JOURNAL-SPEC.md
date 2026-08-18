# cordis-mp 持久化事务 Journal 正式规格 v4

> 状态：v4，待 Codex review
> v4 依据：S5b（独立 resolution journal 原型）、S5c（dead-owner takeover
> CAS 原型）实测结果；修复 v3 评审 4 个阻断项。

## 1. 范围与保证

本规格定义 cordis-mp mutation 对 profile 文本文件写入的崩溃恢复协议。
target rel 封闭 allowlist：`package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml`、`.cordis-mp/state.json`。

- **协作保证**：遵守 §9 锁协议的进程之间单 owner、无静默覆盖。
- **非协作 best-effort**：外部写入通过写前/终检检测；不可检测窗口为
  “检查后到 rename/unlink 前”、“终检后到 marker 前”。检测到即 CONFLICTED。
- **平台分级**：
  - `FULL`：POSIX，具备同文件系统 rename、目录 fsync、进程存活与启动时间
    判定、原子 rename CAS；
  - `BEST_EFFORT`：不具备上述全部能力时降级，诊断明示，不承诺 FULL。

## 2. 基本类型

- `FileState = { exists: boolean, hash: string | null }`；存在时
  `hash="sha256:<hex>"`；不存在 `exists:false, hash:null`。
- `FileMeta = { state: FileState, mode?: string }`。
- `targetKey = sha256(rel)`；`opId = "<txid>-<seq>"`。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json
  journal/<txid>/
    manifest.json           # schemaVersion=1，含 baseline FileMeta[]
    snapshots/<key>.bin     # before 内容；before absent 不落盘
    ops/<key>.jsonl         # 普通 op 日志
    COMMITTED               # 提交唯一权威 marker
    OUTCOME.json
  resolutions/<rid>/
    manifest.json           # action + immutable plan
    ops/<key>.json          # 每 target 一个 op（非 JSONL，原子替换）
    confirmed/<key>         # 每 target 确认 marker
    OUTCOME.json
  conflicts/<txid>/...
  trash/<txid>-<ts>/  trash/<rid>-<ts>/
```

journal/resolutions/trash/conflicts 0700；文件 0600；父目录 lstat no-follow。

## 4. 普通事务状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest 损坏/未知 schema/日志链校验失败 ──→ UNRECOVERABLE
```

- COMMITTED marker 是提交唯一权威；manifest.state=FILE_COMMITTED 仅信息。
- PLAN-v4 的 `DIRTY` = `CONFLICTED | RESOLUTION_CONFLICTED | UNRECOVERABLE`。

## 5. 普通 op 协议

### 5.1 op schema 与结构不变量
```json
{ "v":1, "opId":"<txid>-3", "seq":3,
  "kind":"FORWARD"|"ROLLBACK",
  "phase":"INTENDED"|"CONFIRMED"|"CANCELLED",
  "expected":{"exists":true,"hash":"sha256:B"},
  "next":{"exists":true,"hash":"sha256:C"},
  "before":{"exists":true,"hash":"sha256:A"},
  "mode":"0644","length":123 }
```
解析与校验（任一失败 → UNRECOVERABLE）：
- `op.before == manifest.baseline[rel].state`；
- 首 op `expected == before`；后续 op `expected == 前一逻辑 owned`；
- phase 只允许 `INTENDED→CONFIRMED|CANCELLED`，同 opId 禁止重复 CONFIRMED；
- seq 连续递增；opId/targetKey/kind/mode/length/hash 一致性；
- 每 target 至多一个 pending INTENDED（位于日志末尾）；
- JSONL 允许忽略**唯一**的末尾截断行并告警；其余损坏 → UNRECOVERABLE。

### 5.2 写协议（writePresent/delete 内部执行）
1. 追加 INTENDED（append+fsync file+fsync dir）；
2. 锁 token 校验 + 乐观检查 current==expected，否则 CONFLICTED；
3. 替换：present→present 用 tmp `wx`、写 bytes、**设置 before.mode**、
   fsync file、rename、fsync dir；absent→present mode=0600；
   present→absent = unlink + fsync dir；absent→absent 拒绝；
4. 复读 current==next，否则 CONFLICTED；
5. 追加 CONFIRMED（append+fsync+fsync dir）。

### 5.3 提交
1. 所有声明 target 最后 op CONFIRMED，无 pending INTENDED；
2. 复读 current == 最后 CONFIRMED.next；
3. 全等 → COMMITTED marker（tmp+rename+fsync dir）；
4. 写 manifest.state=FILE_COMMITTED。

## 6. 普通事务恢复

### 6.1 扫描优先级（决策表，逐条短路）
1. `trash/*` → 只继续删除；
2. `resolutions/<rid>` 存在 → 走 §7 resolution 恢复（先于普通 journal）；
3. `journal/<txid>/conflict report`（`conflicts/<txid>/report.json`）存在 →
   权威 CONFLICTED，**不自动恢复**（即使 current 碰巧回到 owned），只允许
   repair action；
4. `journal/<txid>/OUTCOME.json`：
   - 有效且为 `ROLLED_BACK|COMMITTED|ACCEPTED_CURRENT` → tombstone；
   - 有效且为其他已知值 → 按对应协议；
   - 缺失 → 继续；无效/截断/未知枚举 → UNRECOVERABLE；
5. `COMMITTED` marker 存在 → 提交路径，永不回滚；
6. manifest 不存在：目录空或仅 `*.tmp` → RECOVERABLE_NOOP 删除；否则
   UNRECOVERABLE；
7. 否则 → 未提交路径 §6.2–§6.4。

### 6.2 纯逻辑归约（无副作用）
解析 op 链并按 §5.1 校验；依次归约：
- `CONFIRMED` ⇒ owned=op.next；
- `CANCELLED` ⇒ owned 不变；
- 末尾 `INTENDED` 保留为 pending（最多一个）。
输出 `lastConfirmedOwned`、`pending`。

### 6.3 物理 current 判定（只判断最终状态）
- 无 pending：`current == owned` → consistent；否则 CONFLICT。
- 有 pending：
  - `current == pending.expected` → 计划追加 CANCELLED，owned 不变；
  - `current == pending.next` → 计划追加 CONFIRMED，owned=next；
  - 其他 → CONFLICT。
历史 CONFIRMED 不与 current 逐条比较（`A→B→C` 不误判）。

### 6.4 事务级恢复（两阶段，含 snapshot 预检）
**Phase 0（纯读，零写入）**：
- 对所有 `before.exists=true` 的 target 校验 snapshot 存在、hash/length
  匹配、mode 合法；absent 不要求 snapshot。任一失败 → UNRECOVERABLE，
  **在写任何 target 之前结束**。
**Phase 1（纯读）**：§6.2/§6.3 生成 plan：
`{appends[], pendingRollbackSet, conflictSet}`。
**Phase 2（持锁执行）**：
- 执行每个 append 前**重新读取 current** 并复核该判定；不一致则转为
  CONFLICTED，不追加。
- conflictSet 非空 → archiveConflict + CONFLICTED，零 target 写。
- 否则执行 appends；再对 pendingRollbackSet 每 target 生成 ROLLBACK op
  执行 §5.2（expected=owned, next=before）；全达 before → ROLLED_BACK →
  OUTCOME → tombstone。
- Phase 2 中新冲突：已 CONFIRMED 的回滚进度持久保留，置 CONFLICTED；下次
  repair 继续收敛，**不得报告成功**。
多 tx 按 manifest.createdAt 升序恢复；有未清理 tx 时 host 拒绝新 mutation。

### 6.5 COMMITTED 路径
每 target：最后 op CONFIRMED 且 current==next → OK；否则 CONFLICTED（提交后
被外部改），不回滚。全 OK → OUTCOME=COMMITTED → tombstone。

## 7. Resolution 事务（独立 journal，S5b 实证）

### 7.1 结构与 schema
`resolutions/<rid>/manifest.json`：
```json
{ "v":1, "resolutionId":"r1", "txid":"tx1",
  "action":"restore-snapshot",
  "state":"PLANNED|RESOLVING|RESOLUTION_CONFLICTED",
  "plan": { "<rel>": {
      "expected": {"exists":true,"hash":"sha256:X"},
      "next": {"exists":true,"hash":"sha256:A"} } } }
```
- plan immutable；`expected` = 计划时物理 current（对真正冲突也可表达，
  因为它不再受普通链 `expected==前一 owned` 约束）；
- `next` = 普通 journal 的 baseline before；
- 每 target：`ops/<key>.json`（原子替换，只含一个 op）+
  `confirmed/<key>` marker。
- resolution 不复用普通 op 链，也不修改原 journal。

### 7.2 执行与续跑
1. 前置：全部 target 的 baseline snapshot 完整可验；否则
   UNRECOVERABLE_RESTORE。
2. persist manifest（fsync）→ state=PLANNED；用户已授权后写 RESOLVING。
3. 对每 target：
   - 无 op 文件 → 按 plan 原子写 op（expected/next）；
   - 有 confirmed 且 current==next → DONE 跳过；
   - 有 confirmed 但 current==expected → 删除 confirmed 后重做；
   - 无 confirmed：current==expected → 执行替换并写 confirmed；
     current==next → 补写 confirmed；其他 → 该 target CONFLICT。
4. 全部 DONE → OUTCOME=RESOLVED → tombstone（原 journal 一并 tombstone）。
5. 任一 target CONFLICT → OUTCOME=RESOLUTION_CONFLICTED；已完成 target 的
   进度持久保留并如实报告，**绝不报告整体成功**。
6. 恢复扫描：`resolutions/<rid>` 优先于普通 journal；OUTCOME=RESOLVED →
   tombstone；OUTCOME=RESOLUTION_CONFLICTED → 停止等待重新授权；
   无 OUTCOME → 按 3 继续。

### 7.3 accept-current
1. 封存原 journal 到 `conflicts/<txid>/accepted-<ts>/`（copy+fsync，不改
   原 journal）；
2. `BaselineValidatorPort.validateCurrentProfile()` 只读校验；
3. 通过 → 原 journal OUTCOME=ACCEPTED_CURRENT → tombstone；失败 → 保持
   CONFLICTED，report 记 `resolution-failed`。

## 8. 冲突证据

1. 复制 current（或 absent marker）到 evidence/（tmp+rename+fsync，校验
   hash）；2. 复制 manifest/ops/snapshots；3. 原子写 report.json；
4. manifest.state=CONFLICTED。
恢复：report.json 存在即权威（§6.1 第 3 条），补全 evidence 副本。

## 9. 跨进程锁（S5c 实证协议）

`lock.json`：`{owner,bootId,pid,processStartToken,ownerToken,epoch,
acquiredAt,heartbeatAt}`。

### 9.1 获取与心跳
- 初始获取：`open('wx',0600)` 原子创建；失败则读现有 lock。
- 心跳 5s；stale 30s；更新为原子替换+fsync。

### 9.2 takeover CAS（死 owner）
1. 读旧 lock；`pid 存活` 或 `heartbeat 未 stale` → 拒绝接管；
2. CAS：`rename(lock, lock.stolen-<myToken>)`——同文件系统 rename 语义下
   只有一个进程成功，其余 ENOENT；
3. 赢家复核 stolen 内容与第 1 步读取的 ownerToken/processStartToken 一致；
4. 复核 pid 已死且 heartbeat stale；否则把 stolen rename 回 lock 并放弃；
5. `open(lock,'wx')` 写新 lock（新 token，epoch+1）。
- S5c 实测：双 repair 并发抢 dead lock ×5，恰好 1 个赢家。
- `--force` 仅在“pid 无法判定死亡”时允许，且明确降级为放弃 FULL 协作
  保证并记录 warning；活 pid 一律禁止 force。
- 平台无原子 rename CAS → 该平台为 BEST_EFFORT，诊断明示。

### 9.3 fencing
每次 journal/target 写前校验 lock ownerToken 等于当前持有者；不匹配 →
只读退出（若已失去写权，不尝试置 CONFLICTED）。活进程被禁止接管，故协作
双 owner 不会出现；TOCTOU 仅归入非协作 best-effort。

## 10. 接口

### 10.1 JournalPort
```ts
interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>
  writePresent(tx: TxId, rel: string, data: Uint8Array): Promise<void> // hash 由实现计算
  delete(tx: TxId, rel: string): Promise<void>
  commitFiles(tx: TxId): Promise<void>
  rollback(tx: TxId): Promise<void>
  scan(): Promise<RecoveryReport>
  recover(): Promise<RecoveryReport>
  archiveConflict(tx: TxId): Promise<void>
  // resolution
  beginResolution(tx: TxId, action: 'restore-snapshot'|'accept-current',
                  plan?: ResolutionPlan): Promise<ResolutionId>
  resolveTarget(rid: ResolutionId, rel: string): Promise<void>
  completeResolution(rid: ResolutionId): Promise<ResolutionOutcome>
  acceptCurrent(tx: TxId, baseline: BaselineReport): Promise<void>
}
```
- `writePresent` 只接受 bytes；`commitFiles` 拒绝 pending INTENDED 或未声明
  target；所有非法状态迁移返回 JOURNALLED。
- `completeResolution` 根据 durable plan.action 写 RESOLVED 或
  ACCEPTED_CURRENT，不依赖调用方重复声明。

### 10.2 RepairService（install-core）
编排 JournalPort + BaselineValidatorPort：
- scan → RECOVERABLE 自动 recover；
- restore-snapshot → 验证 baseline snapshot → beginResolution(plan) →
  resolveTarget × N → completeResolution；
- accept-current → archive + BaselineValidatorPort → acceptCurrent。
BaselineValidatorPort 只读。

## 11. 测试矩阵（自包含）

A. 普通归约：A→B→C、A→B→A、回滚 B→A INTENDED 崩溃、CANCELLED 后继续
   回滚、malformed chain 全量。
B. 写入：present/absent 全组合每步崩溃；mode 恢复；snapshot 缺失在 Phase 0
   拒绝；非协作写入注入两个已知窗口。
C. 提交/清理：marker 前后崩溃；manifest=FILE_COMMITTED 无 marker → 回滚；
   OUTCOME 有效值/缺失/损坏分支；tombstone 双目录 fsync 与崩溃。
D. resolution（S5b 实测场景）：
   - plan 后无 op / op 后未写 / 写后未 confirmed / confirmed 后崩溃；
   - 部分 DONE 后整体 RESOLUTION_CONFLICTED，进度可见且不报成功；
   - OUTCOME=RESOLVED 后 tombstone 前崩溃 → 只清理；
   - plan 后外部再改 → 该 target CONFLICT，其他 target 继续。
E. 锁（S5c 实测场景）：
   - 活 owner 拒绝；dead+stale 接管；双 repair 竞争恰好 1 赢家；
   - 新 owner 崩溃且 heartbeat 未 stale → 拒绝二次接管；
   - token 不匹配只读退出；force 降级记录 warning。
F. JournalPort 非法输入/调用顺序；RepairService action 与 durable plan 一致。
G. 不变量模型测试：单协作 owner；冲突后未经授权不修改 target；
   RESOLVED 当且仅当全 target durable == before；恢复成功返回终态后无
   marker 不保留 owned 写、有 marker 永不自动回滚。

## 12. 明确不在本规格范围
- 插件激活 / PENDING_ACTIVATION（ACTIVATION-SPEC）。
- inspectArtifact / tarball（ARTIFACT-SPEC）。
- pnpm/dsh CLI 细节（PackageManagerPort）。
- 备份、WebDAV、Gist。
