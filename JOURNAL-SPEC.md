# cordis-mp 持久化事务 Journal 正式规格 v5

> 状态：v5，待 Codex review
> v5 修订：修复 v4 评审 5 个阻断项：
> ① accept-current 改为独立 resolution journal，终态不再被 conflict report 遮蔽；
> ② RESOLUTION_CONFLICTED 的重新授权协议（SUPERSEDED + supersedes）；
> ③ resolution 成功清理顺序：先原 journal、后 resolution；
> ④ resolution 的异常分支完整定义；
> ⑤ JournalPort 只保留一条 accept-current 路径，snapshot 元数据模型统一。

## 1. 范围与保证

本规格定义 cordis-mp mutation 对 profile 文本文件写入的崩溃恢复协议。
target rel 封闭 allowlist：`package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml`、`.cordis-mp/state.json`。

- 协作保证：遵守 §9 锁协议的进程单 owner、无静默覆盖。
- 非协作 best-effort：外部写入靠写前/终检检测；不可检测窗口为
  “检查后到 rename/unlink 前”与“终检后到 marker 前”。检测到即 CONFLICTED。
- 平台分级：`FULL` = POSIX + 同文件系统原子 rename CAS + 目录 fsync +
  进程身份判定；不满足为 `BEST_EFFORT`，诊断明示，不承诺 FULL。

## 2. 数据模型

- `FileState = { exists: boolean, hash: string | null }`；存在时
  `hash="sha256:<hex>"`；不存在 `exists:false, hash:null`。
- `BaselineFile = { state: FileState, length?: number, mode?: string }`：
  - 存在时 length 必填、mode 必填；
  - absent 时 length/mode 缺省。
- op 内不再重复保存 baseline 元数据，只通过 `targetKey` 引用 manifest
  baseline；`mode` 字段表示**本次写目标文件应使用的 mode**。
- `targetKey = sha256(rel)`；`opId = "<txid>-<seq>"`。
- 同一 opId 的 `INTENDED/...`、`CONFIRMED`、`CANCELLED` 记录**共享 seq**；
  不同 opId 的 seq 严格递增。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json
  journal/<txid>/{manifest.json, snapshots/<key>.bin, ops/<key>.jsonl,
                 COMMITTED, OUTCOME.json}
  resolutions/<rid>/{manifest.json, ops/<key>.json, confirmed/<key>,
                     OUTCOME.json}
  conflicts/<txid>/{evidence/..., report.json, accepted-<ts>/...}
  trash/<name>-<ts>/
```
目录 0700；文件 0600；父目录 lstat no-follow。

## 4. 普通事务状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest/op 链损坏 ──→ UNRECOVERABLE
```
COMMITTED marker 是提交唯一权威；manifest.state 仅信息。
PLAN-v4 的 `DIRTY` = `CONFLICTED | RESOLUTION_CONFLICTED | UNRECOVERABLE`。

## 5. 普通 op 协议

### 5.1 schema 与链不变量
```json
{ "v":1, "opId":"<txid>-3", "seq":3,
  "kind":"FORWARD"|"ROLLBACK",
  "phase":"INTENDED"|"CONFIRMED"|"CANCELLED",
  "expected":{"exists":true,"hash":"sha256:B"},
  "next":{"exists":true,"hash":"sha256:C"},
  "before":{"exists":true,"hash":"sha256:A"},
  "mode":"0644","length":123 }
```
校验（失败 → UNRECOVERABLE）：
- `op.before` == manifest baseline[rel].state；
- 首 op `expected == before`；后续 op `expected == 前一逻辑 owned`；
- `phase` 只允许 `INTENDED→CONFIRMED|CANCELLED`；同 opId 禁止重复 CONFIRMED；
- seq 规则见 §2；opId/txid/targetKey 一致；
- `length` = next 内容字节数；`mode` = 本次写目标 mode（present→present 取
  baseline.mode 或上一 CONFIRMED op 的 mode；absent→present 取 0600）；
- `kind=ROLLBACK` 必须 `next == baseline.state`；
- 每 target 至多一个 pending INTENDED（日志末尾）；
- JSONL 允许忽略唯一末尾截断行并告警；其余损坏 → UNRECOVERABLE。

### 5.2 写协议（writePresent/delete 内部执行）
1. 追加 INTENDED（append+fsync file+fsync dir）；
2. fencing 校验 + 乐观检查 current==expected，否则 CONFLICTED；
3. 替换：present→present：tmp `wx`、写 bytes、设置 mode、fsync file、
   rename、fsync dir；absent→present 同上 mode=0600；present→absent：
   unlink+fsync dir；absent→absent 拒绝；
4. 复读 current==next，否则 CONFLICTED；
5. 追加 CONFIRMED。

### 5.3 提交
所有声明 target 最后 op CONFIRMED、无 pending → 复读 current==next 全等 →
COMMITTED marker（tmp+rename+fsync dir）→ 写 manifest.state=FILE_COMMITTED。

## 6. 普通事务恢复

### 6.1 纯逻辑归约（无副作用）
解析 op 链并校验 §5.1；依次归约：CONFIRMED ⇒ owned=next；CANCELLED ⇒
owned 不变；末尾 INTENDED 保留 pending（至多一个）。输出
`lastConfirmedOwned`、`pending`。

### 6.2 物理 current 判定
- 无 pending：current==owned → consistent；否则 CONFLICT。
- 有 pending：
  - current==pending.expected → 计划追加 CANCELLED；
  - current==pending.next → 计划追加 CONFIRMED（认领），owned=next；
  - 其他 → CONFLICT。
历史 CONFIRMED 不与 current 逐条比较。

### 6.3 事务级恢复
- **Phase 0（零写入预检）**：所有 `before.exists=true` 的 snapshot 存在且
  hash/length/mode 匹配；任一失败 → UNRECOVERABLE，写任何 target 前结束。
- **Phase 1（纯读）**：§6.1/§6.2 生成
  `{appends[], pendingRollbackSet, conflictSet}`。
- **Phase 2（持锁执行）**：执行每个 append 前重新读取 current 复核；有变
  → CONFLICTED。conflictSet 非空 → archiveConflict + CONFLICTED，零
  target 写。否则执行 appends；再对 pendingRollbackSet 生成 ROLLBACK op
  执行 §5.2；全达 before → ROLLED_BACK → OUTCOME → tombstone。Phase 2 新
  冲突：已确认回滚进度持久保留，置 CONFLICTED，不报成功。
- 多 tx 按 manifest.createdAt 升序；存在未清理 tx 时 host 拒绝新 mutation。

### 6.4 COMMITTED 路径
每 target 最后 op CONFIRMED 且 current==next → OK；否则 CONFLICTED（提交后
被外部改），不回滚。全 OK → OUTCOME=COMMITTED → tombstone。

## 7. Resolution journal（独立，S5b 实证）

### 7.1 manifest schema
```json
{ "v":1, "resolutionId":"r1", "txid":"tx1",
  "createdAt":"...", "supersedes": null,
  "action":"restore-snapshot"|"accept-current",
  "state":"PLANNED|RESOLVING|RESOLUTION_CONFLICTED",
  "plan": { "<rel>": {"expected":{"exists":true,"hash":"sha256:X"},
                       "next":{"exists":true,"hash":"sha256:A"}} } }
```
- restore-snapshot：plan 必填，immutable；`expected`=计划时 current，
  `next`=原 journal baseline.state。
- accept-current：plan 缺省（无 per-target op）。
- op 文件与 confirmed marker 的创建全部采用原子替换 + 文件 fsync + 目录
  fsync；target 替换执行 §5.2 的 present/absent 原语；每次写前 fencing。

### 7.2 生命周期与重新授权
1. 创建新 resolution：
   - 若已有该 tx 的 resolution 处于 `RESOLUTION_CONFLICTED`：先原子写旧
     `OUTCOME=SUPERSEDED`，再创建新 manifest（`supersedes=<旧 rid>`）。
     崩溃恢复：旧 OUTCOME=SUPERSEDED 或新 manifest.supersedes 均可使旧 rid
     失效。
   - 同一 tx 至多一个 active（非 SUPERSEDED、非终态）resolution；多于一个
     → UNRECOVERABLE。
2. restore-snapshot 执行/续跑：
   - 每 target：无 op → 按 plan 原子写 op；有 confirmed 且 current==next
     → DONE；有 confirmed 但 current==expected → 删 confirmed 重做；
     无 confirmed：current==expected → 写 target+confirmed；current==next
     → 补 confirmed；其他 → CONFLICT。
   - 全部 DONE → OUTCOME=RESOLVED。
   - 任一 CONFLICT → OUTCOME=RESOLUTION_CONFLICTED，进度持久、如实报告，
     不报整体成功。
3. accept-current 执行：
   - beginResolution(tx,'accept-current') 持久化 manifest；
   - `BaselineValidatorPort.validateCurrentProfile()` 只读校验；
   - 通过 → `OUTCOME=ACCEPTED_CURRENT`；失败 → `OUTCOME=
     RESOLUTION_CONFLICTED` + report `resolution-failed`。
4. **清理顺序（固定）**：
   - RESOLVED 或 ACCEPTED_CURRENT：先 tombstone 原 journal，fsync 相关
     目录；再 tombstone resolution。中间崩溃后扫描看到 resolution
     OUTCOME，继续清理，绝不回退到原 conflict report。

### 7.3 resolution 扫描（优先级最高，普通 journal 之前）
对每个 `resolutions/<rid>`：
| 证据 | 判定/动作 |
|---|---|
| OUTCOME=RESOLVED | 先 tombstone 原 journal，再 tombstone resolution |
| OUTCOME=ACCEPTED_CURRENT | 同上 |
| OUTCOME=RESOLUTION_CONFLICTED | 停止，等待新 resolution（§7.2.1） |
| OUTCOME=SUPERSEDED | tombstone resolution，继续 |
| 无 OUTCOME，manifest.supersedes 指向它 | 视为 SUPERSEDED |
| manifest 缺失/截断/未知版本 | UNRECOVERABLE |
| OUTCOME 损坏/未知枚举 | UNRECOVERABLE |
| op 损坏/与 plan 不一致、confirmed 无 op、rid/txid/targetKey 不一致 | UNRECOVERABLE |
| 否则 | 按 §7.2.2 继续执行 |

## 8. 全局扫描决策表（顺序短路）

1. `trash/*` → 只删除。
2. `resolutions/*` 存在 → §7.3（**先于** conflict report）。
3. 原 journal 的 `conflicts/<txid>/report.json` 存在且无 resolution →
   CONFLICTED，只允许 repair action；不自动恢复。
4. 原 journal `OUTCOME.json`：
   - 有效 `ROLLED_BACK|COMMITTED` → tombstone；
   - 缺失 → 继续；
   - 其他有效值（如 ACCEPTED_CURRENT 残值）→ tombstone（该终态现在只能
     由 resolution 产生，残值视为可清理）；
   - 无效/截断/未知 → UNRECOVERABLE。
5. COMMITTED marker 存在 → §6.4。
6. manifest 不存在：目录空或仅 `*.tmp` → RECOVERABLE_NOOP 删除；否则
   UNRECOVERABLE。
7. 否则 → §6 未提交恢复。

## 9. 冲突证据

1. 复制 current（或 absent marker）到 evidence/（tmp+rename+fsync，校验
   hash）；2. 复制 manifest/ops/snapshots；3. 原子写 report.json；
4. manifest.state=CONFLICTED。恢复：report 存在但无 resolution 时权威。

## 10. 跨进程锁（S5c 实证）

`lock.json`：`{owner,bootId,pid,processStartToken,ownerToken,epoch,
acquiredAt,heartbeatAt}`。

- 获取：`open('wx',0600)`；心跳 5s；stale 30s；更新原子替换+fsync。
- **owner 存活判定 = `(bootId,pid,processStartToken)` 三元组一致且 pid
  存活**；三元组不同视为新 owner。
- takeover CAS：
  1. 读旧 lock；owner 存活 或 heartbeat 未 stale → 拒绝；
  2. `rename(lock, lock.stolen-<myToken>)`——FULL 平台仅一个赢家，其余
     ENOENT；
  3. 赢家复核 stolen 与第 1 步读取一致；
  4. 复核 owner 已死且 stale；否则若 lock 路径仍不存在才把 stolen 恢复；
     若间隙已有人创建新 lock → 只读退出，不覆盖；
  5. `open(lock,'wx')` 创建新 lock；EEXIST → 失败者只读退出。
- release：校验 ownerToken 后 unlink + fsync 目录。
- `lock.stolen-*` 遗留物：扫描时若对应 lock 的 epoch 更新或 ownerToken 不
  匹配，删除遗留物并记录。
- 活 owner 一律禁止 force；无法判定死亡时 `--force` 明确降级放弃 FULL
  协作保证并记 warning。平台无原子 rename CAS → BEST_EFFORT。

## 11. 接口

```ts
interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>
  writePresent(tx: TxId, rel: string, data: Uint8Array): Promise<void>
  delete(tx: TxId, rel: string): Promise<void>
  commitFiles(tx: TxId): Promise<void>
  rollback(tx: TxId): Promise<void>
  scan(): Promise<RecoveryReport>
  recover(): Promise<RecoveryReport>
  archiveConflict(tx: TxId): Promise<void>

  beginResolution(tx: TxId, action: 'restore-snapshot'|'accept-current',
                  plan?: ResolutionPlan): Promise<ResolutionId>
  resolveTarget(rid: ResolutionId, rel: string): Promise<void>
  completeResolution(rid: ResolutionId): Promise<ResolutionOutcome>
}
interface BaselineValidatorPort {
  validateCurrentProfile(): Promise<BaselineReport>   // 只读
}
```
- accept-current 的唯一路径：`beginResolution(tx,'accept-current')` →
  validator → `completeResolution`；不再提供 acceptCurrent 方法。
- `writePresent` 只收 bytes；`commitFiles` 拒绝 pending/未声明 target；
  非法状态迁移返回 JOURNALLED。
- RepairService（install-core）只做编排，不越过 JournalPort 写文件。

## 12. 测试矩阵（自包含）

A. 普通归约：A→B→C、A→B→A、回滚 INTENDED 崩溃、CANCELLED 后继续回滚、
   malformed chain（含 seq/phase/before/ROLLBACK.next 违规）。
B. 写入：present/absent 全组合每步崩溃；mode/length/hash 预检；非协作
   写入两个窗口。
C. 提交/清理：marker 前后；manifest=FILE_COMMITTED 无 marker；OUTCOME 各
   分支；tombstone 每步崩溃。
D. resolution：
   - S5b 全部实测场景；
   - OUTCOME=RESOLVED/ACCEPTED_CURRENT 后原 journal 先删、resolution 后删
     的每个崩溃点；
   - RESOLUTION_CONFLICTED → SUPERSEDED → 新 rid 全流程与每步崩溃；
   - 双 active resolution → UNRECOVERABLE；
   - manifest/OUTCOME/op/confirmed 损坏组合；
   - accept-current 唯一路径（beginResolution→validator→completeResolution）。
E. 锁：
   - S5c 全部实测场景；
   - takeover step4 间隙新 owner 出现 → 不覆盖；
   - step5 EEXIST → 失败者退出；
   - processStartToken 变化、release 崩溃、stolen 遗留清理。
F. 接口：JournalPort 非法输入/调用顺序；RepairService 不直接写文件。
G. 不变量模型测试：单协作 owner；冲突后未经授权不修改 target；RESOLVED
   当且仅当全 target durable==before；恢复成功返回终态后无 marker 不保留
   owned 写、有 marker 永不自动回滚。

## 13. 明确不在本规格范围
- 插件激活 / PENDING_ACTIVATION（ACTIVATION-SPEC）。
- inspectArtifact / tarball（ARTIFACT-SPEC）。
- pnpm/dsh CLI 细节（PackageManagerPort）。
- 备份、WebDAV、Gist。
