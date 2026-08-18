# cordis-mp 持久化事务 Journal 正式规格 v6

> 状态：v6，待 Codex review
> v6 修订：按 v5 评审收口：① 按 tx 分组的全局归约选择唯一 active resolution；
> ② 成功清理覆盖 journal + conflicts + resolution；③ accept-current 增加
> durable validation evidence；④ resolution 增加 Phase 0 预检与 tmp-only 分支；
> ⑤ 数据模型澄清 mode 语义与 op 全字段一致性；⑥ 定义公共 durable primitive
> 与 LockPort 生命周期。

## 1. 范围与保证

target rel 封闭 allowlist：`package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml`、`.cordis-mp/state.json`。

- 协作保证：遵守 §10 锁协议的进程单 owner、无静默覆盖。
- 非协作 best-effort：外部写入靠写前/终检检测；不可检测窗口为
  “检查后到 rename/unlink 前”、“终检后到 marker 前”。检测到即 CONFLICTED。
- 平台分级：`FULL` = POSIX + 同文件系统原子 rename CAS + 目录 fsync +
  进程身份判定；否则 `BEST_EFFORT`，诊断明示，不承诺 FULL。

## 2. 数据模型

- `FileState = { exists: boolean, hash: string | null }`。mode **不属于**
  FileState，不参与冲突/DONE/RESOLVED 判定；mode 只是写入属性，目标文件
  mode 与 baseline.mode 不一致不判 CONFLICT，恢复时尽力设置并记录差异。
- `BaselineFile = { state: FileState, length?: number, mode?: string }`；
  exists=true 时 length/mode 必填；absent 时缺省。snapshot 文件自身统一
  0600，Phase 0 校验 snapshot 内容 hash/length 等于 baseline。
- `targetKey = sha256(rel)`；`opId = "<txid>-<seq>"`。
- 同一 opId 的 phase 记录共享 seq，且除 `phase` 外所有字段必须完全一致；
  不同 opId 的 seq 严格递增。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json
  journal/<txid>/{manifest.json, snapshots/<key>.bin, ops/<key>.jsonl,
                 COMMITTED, OUTCOME.json}
  resolutions/<rid>/{manifest.json, ops/<key>.json, confirmed/<key>,
                     validation.json, OUTCOME.json}
  conflicts/<txid>/{evidence/..., report.json, accepted-<ts>/...}
  trash/<name>-<ts>/
```
目录 0700；文件 0600；父目录 lstat no-follow。

## 4. 公共 durable primitive（所有持久化统一引用）

- `atomic-file(path, bytes, {mode})`：tmp 同目录随机名 `open('wx')` → 写 →
  fsync file → 设置 mode → `rename` → fsync 父目录。
- `append-record(path, jsonline)`：append → fsync file → fsync dir。JSONL
  允许忽略唯一末尾截断行并告警，其余损坏 → UNRECOVERABLE。
- `marker(path)`：`atomic-file(path, EMPTY)`。
- `tombstone(dir)`：`rename(dir, trash/<basename>-<ts>)` → fsync 源父目录 →
  fsync trash 父目录 → 递归删除。若源不存在 → 幂等成功。
- 所有 journal/resolution/conflicts 文件使用上述 primitive；每处不再重复
  描述 fsync。

## 5. 普通事务状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest/op 链损坏 ──→ UNRECOVERABLE
```
COMMITTED marker 是提交唯一权威；manifest.state=FILE_COMMITTED 仅信息。
PLAN-v4 `DIRTY` = `CONFLICTED | RESOLUTION_CONFLICTED | UNRECOVERABLE`。

## 6. 普通 op 协议

### 6.1 op schema（完整字段）
```json
{ "v":1, "txid":"tx1", "targetKey":"<sha256>", "opId":"tx1-3", "seq":3,
  "kind":"FORWARD"|"ROLLBACK",
  "phase":"INTENDED"|"CONFIRMED"|"CANCELLED",
  "expected":{"exists":true,"hash":"sha256:B"},
  "next":{"exists":true,"hash":"sha256:C"},
  "before":{"exists":true,"hash":"sha256:A"},
  "mode":"0644","length":123 }
```
- present→present/absent→present：mode/length 描述 next；
- present→absent：next.exists=false，mode/length 缺省。
- 链校验（失败 → UNRECOVERABLE）：before==baseline.state；首 op
  expected==before；后续 op expected==前一逻辑 owned；phase 只允许
  INTENDED→CONFIRMED|CANCELLED；同 opId 字段除 phase 外一致；kind=ROLLBACK
  必须 next==baseline.state；每 target 至多一个 pending INTENDED。

### 6.2 写协议
1. append INTENDED；2. fencing + current==expected；3. 替换（present→
   present 设置 baseline.mode/上一 CONFIRMED.mode；absent→present 0600；
   present→absent unlink）；4. 复读 current==next；5. append CONFIRMED。
absent→absent 拒绝。

### 6.3 提交
所有声明 target 最后 op CONFIRMED、无 pending → 复读 current==next →
`marker(COMMITTED)` → atomic manifest.state=FILE_COMMITTED。

## 7. 普通事务恢复

- **Phase 0（零写入预检）**：所有 before.exists=true 的 snapshot 存在且
  hash/length 匹配、mode 合法；任一失败 → UNRECOVERABLE。
- **Phase 1（纯读）**：逻辑归约（CONFIRMED⇒owned=next；CANCELLED⇒owned
  不变；末尾 INTENDED 为 pending）；物理判定：
  - 无 pending：current==owned，否则 CONFLICT；
  - pending：current==expected→计划 CANCELLED；current==next→计划
    CONFIRMED 并 owned=next；其他 CONFLICT。
- **Phase 2（持锁）**：每个 planned append 前重新读 current 复核。
  conflictSet 非空 → archiveConflict + CONFLICTED，零 target 写。否则执行
  appends；对 pendingRollbackSet 生成 ROLLBACK op 执行 §6.2；全达 before →
  ROLLED_BACK → OUTCOME → tombstone。Phase 2 新冲突 → 进度持久、CONFLICTED、
  不报成功。
- 多 tx 按 createdAt 升序；存在未清理 tx 时 host 拒绝新 mutation。
- COMMITTED 路径：最后 op CONFIRMED 且 current==next，否则 CONFLICTED
  不回滚；全 OK → OUTCOME=COMMITTED → tombstone。

## 8. Resolution journal（独立，S5b 实证）

### 8.1 schemas
manifest：
```json
{ "v":1, "resolutionId":"r1", "txid":"tx1", "createdAt":"...",
  "supersedes": null, "action":"restore-snapshot"|"accept-current",
  "state":"PLANNED|RESOLVING|RESOLUTION_CONFLICTED",
  "plan": { "<rel>": {"expected":FileState, "next":FileState} } }
```
- restore-snapshot：plan 必填且 immutable；expected=计划时 current；
  next=原 journal baseline.state。
- accept-current：plan 缺省。
- resolution op（每 target 原子文件）：
  `{ "v":1, "resolutionId":"r1", "txid":"tx1", "rel":"...", "targetKey":"...",
     "expected":FileState, "next":FileState }`
- validation.json（accept-current）：
  `{ "v":1, "resolutionId":"r1", "fingerprint":"sha256:<canonical JSON of
     current FileState map>", "baselineReport": {...}, "createdAt":"..." }`

### 8.2 执行（按 action 分派）
- **restore-snapshot**：
  - Phase 0：对原 journal 所有 baseline.exists=true 的 snapshot 做与 §7 相同
    的全量预检；任一失败 → UNRECOVERABLE，零 target 写。
  - 每 target：无 op → 按 plan 原子写 op；有 confirmed 且 current==next →
    DONE；有 confirmed 且 current==expected → 删 confirmed 重做；无
    confirmed：current==expected → 写 target + confirmed；current==next →
    补 confirmed；其他 → CONFLICT。
  - 全 DONE 后终检全部 current==next → OUTCOME=RESOLVED。
  - 任一 CONFLICT → OUTCOME=RESOLUTION_CONFLICTED；进度持久、不报成功。
- **accept-current**：
  - manifest 持久化后，由 RepairService 调用 BaselineValidator（只读）。
  - 通过 → 写 validation.json（含 current 指纹）→ completeResolution。
  - `completeResolution` 复读当前 profile 指纹：等于 validation 指纹 →
    OUTCOME=ACCEPTED_CURRENT；不等 → OUTCOME=RESOLUTION_CONFLICTED。
  - 恢复续跑：有 validation.json 且指纹匹配 → 补 OUTCOME=ACCEPTED_CURRENT；
    有 validation 但指纹不匹配 → RESOLUTION_CONFLICTED；无 validation →
    保持 PLANNED，等待用户重新授权/重新校验。

### 8.3 生命周期与 supersede
- 创建新 resolution：若该 tx 已有 RESOLUTION_CONFLICTED 的 active rid：
  先 atomic 写旧 `OUTCOME=SUPERSEDED`，再 atomic 写新 manifest
  （`supersedes=<旧 rid>`）。崩溃恢复由 §9 全局归约判定。
- 同一 tx 至多一个 active（非 SUPERSEDED、非终态）resolution；多 active →
  UNRECOVERABLE。

### 8.4 成功清理（顺序固定，幂等）
RESOLVED / ACCEPTED_CURRENT 后：
1. tombstone 原 `journal/<txid>`；
2. tombstone `conflicts/<txid>`（防止 report 在 resolution 消失后重新触发
   CONFLICTED）；
3. tombstone 本 resolution。
每一步之间崩溃，恢复扫描仍按当前可见证据继续，不会回退。

## 9. 全局扫描归约

### 9.1 阶段 0：按 tx 分组预扫描（纯读，零副作用）
1. 收集 `journal/*`、`resolutions/*`、`conflicts/*`、`trash/*`。
2. `trash/*` 标记为待删除。
3. 对每个 tx 的 resolutions：
   - 解析所有 rid；损坏的 rid 按 §9.2 异常表标记 UNRECOVERABLE（但先继续
     读取其他证据以输出完整诊断）；
   - 构建 supersedes 链：`new.supersedes == old.rid` ⇒ old 失效；
   - 若 old 也有 OUTCOME=SUPERSEDED，双重确认；
   - 选出唯一 active rid（无 supersedes 指向它且自身无终态 OUTCOME）；
   - 多个候选 active → UNRECOVERABLE。
4. 输出 `GlobalRecoveryPlan`：待删 trash 列表、每 tx 的权威 resolution
   （或 none）、原 journal 证据分类、待处理 conflict report。

### 9.2 执行阶段（按 GlobalRecoveryPlan 持锁执行）
- trash 列表 → 继续删除。
- 有权威 resolution → 先处理 resolution（§8）；resolution 终态清理按
  §8.4，之后原 journal/conflicts 也随之 tombstone。
- 无 resolution：
  - conflict report 存在 → CONFLICTED，只允许 repair action；
  - OUTCOME 有效 ROLLED_BACK|COMMITTED → tombstone；缺失 → 继续；其他
    有效值 → 按对应语义；无效/截断/未知 → UNRECOVERABLE；
  - COMMITTED marker → 提交路径；
  - manifest 不存在：目录空或仅 `*.tmp` → RECOVERABLE_NOOP 删除；否则
    UNRECOVERABLE；
  - 否则 → §7 未提交恢复。

### 9.3 resolution 异常表
| 证据 | 判定 |
|---|---|
| 目录仅 `*.tmp`、无 manifest | RECOVERABLE_NOOP 删除（正常创建崩溃） |
| manifest 缺失/截断/未知版本 | UNRECOVERABLE |
| OUTCOME 损坏/未知枚举 | UNRECOVERABLE |
| OUTCOME=RESOLVED/ACCEPTED_CURRENT 且 manifest 缺失 | 若可从 rid 反查 txid 则按终态清理；不可 → UNRECOVERABLE |
| op 损坏/与 plan 不一致/confirmed 无 op/rid-txid-targetKey 不一致 | UNRECOVERABLE |
| snapshot 预检失败 | UNRECOVERABLE，零 target 写 |

## 10. 跨进程锁与 LockPort

### 10.1 锁文件
`lock.json`：`{owner,bootId,pid,processStartToken,ownerToken,epoch,
acquiredAt,heartbeatAt}`。创建/更新用 atomic-file；损坏/截断 → 视为 stale
并提示（不自动写）。

### 10.2 takeover CAS（S5c 实证）
1. 读旧 lock；owner 存活（`(bootId,pid,processStartToken)` 一致且 pid 活）
   或 heartbeat 未 stale → 拒绝；
2. `rename(lock, lock.stolen-<myToken>)`；FULL 平台仅一个赢家，其余
   ENOENT；
3. 赢家复核 stolen 与第 1 步读取一致；
4. 复核 owner 已死且 stale；否则若 lock 路径仍不存在则把 stolen 恢复；
   间隙已出现新 lock → 只读退出，不覆盖；
5. `open(lock,'wx')` 创建新 lock；EEXIST → 失败者只读退出。
- 活 owner 禁止 force；无法判定死亡时 `--force` 放弃 FULL 协作保证并记
  warning。无原子 rename CAS 的平台为 BEST_EFFORT。
- release：校验 ownerToken 后 unlink+fsync 目录。`stolen-*` 遗留物由持锁
  扫描清理。

### 10.3 LockPort 生命周期
```ts
interface LockPort {
  acquire(scope: LockScope): Promise<LockLease>
  withLock<T>(scope: LockScope, fn: () => Promise<T>): Promise<T>
  heartbeat(lease): Promise<void>
  release(lease): Promise<void>
}
type LockScope = 'mutation' | 'recovery' | 'resolution' | 'cleanup' | 'repair-action'
```
- 必须持锁的范围：普通事务 begin→write/delete→commit/rollback→cleanup；
  recovery Phase 2；resolution 创建/supersede/执行/complete/清理；
  archiveConflict、OUTCOME、tombstone、trash 与 stolen 清理。
- 只读范围可无锁：scan/Phase 0/Phase 1/BaselineValidator（其结果在持锁
  执行前必须复验）。

## 11. 接口

```ts
interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>
  writePresent(tx: TxId, rel: string, data: Uint8Array): Promise<void>
  delete(tx: TxId, rel: string): Promise<void>
  commitFiles(tx: TxId): Promise<void>
  rollback(tx: TxId): Promise<void>
  scan(): Promise<GlobalRecoveryPlan>
  recover(plan: GlobalRecoveryPlan): Promise<RecoveryReport>
  archiveConflict(tx: TxId): Promise<void>

  beginResolution(req: ResolutionRequest): Promise<ResolutionId>
    // discriminated: {txId, action:'restore-snapshot', plan} |
    //                {txId, action:'accept-current'}
  resolveTarget(rid: ResolutionId, rel: string): Promise<void>  // 仅 restore
  recordValidation(rid: ResolutionId, evidence: BaselineReport & { fingerprint }): Promise<void>
  completeResolution(rid: ResolutionId): Promise<ResolutionOutcome>
}
interface BaselineValidatorPort {
  validateCurrentProfile(): Promise<BaselineReport & { fingerprint }>  // 只读
}
```
- `writePresent` 只收 bytes；非法状态迁移/非法 action/非法参数返回
  JOURNALLED；`resolveTarget` 对 accept-current 非法。

## 12. 测试矩阵（自包含，列明具体场景）

A. 普通归约：
A1 A→B→C 全 CONFIRMED，current=C；
A2 A→B→A；
A3 回滚 B→A INTENDED 崩溃 current=B → 计划 CANCELLED 后新 rollback 继续；
A4 CANCELLED 后继续回滚；
A5 malformed：expected 链断裂、seq 跳变、重复 CONFIRMED、before 错、
ROLLBACK.next≠baseline、双 pending、同 opId 字段不一致、尾行截断（可忽略）
与非尾行损坏。

B. 写入：
B1 present→present / absent→present / present→absent 每步崩溃；
B2 absent→absent 拒绝；B3 mode 仅变化不判冲突；B4 Phase 0 snapshot
hash/length/mode 任一失败零写入；B5 非协作写入两个已知窗口。

C. 提交/清理：
C1 marker 前后崩溃；C2 manifest=FILE_COMMITTED 无 marker → 回滚；
C3 OUTCOME 有效/缺失/损坏；C4 tombstone 源缺失幂等与每步崩溃。

D. resolution（含 S5b 实测路径，全部内联）：
D1 plan 后无 op；D2 op 后未写；D3 写后未 confirmed；D4 confirmed 后崩溃；
D5 部分 DONE 后整体 RESOLUTION_CONFLICTED，不报成功；
D6 OUTCOME=RESOLVED 后、三阶段清理每个崩溃点（journal/conflicts/
resolution）；
D7 plan 后外部再改 → 该 target CONFLICT，其他继续；
D8 旧 rid RESOLUTION_CONFLICTED → SUPERSEDED → 新 rid，各步崩溃；
D9 双 active rid → UNRECOVERABLE；D10 resolution 仅 tmp → NOOP；
D11 manifest/OUTCOME/op/confirmed 损坏组合；D12 snapshot 预检失败零写入；
D13 accept-current：manifest 后崩溃、validation 后崩溃、指纹匹配/不匹配、
validator 未运行。

E. 锁（含 S5c 实测路径，全部内联）：
E1 活 owner 拒绝；E2 dead+stale 接管；E3 双 repair 竞争恰好 1 赢家；
E4 新 owner 崩溃且 heartbeat 未 stale 拒绝；E5 takeover step4 间隙新 owner
出现不覆盖；E6 step5 EEXIST 退出；E7 release 崩溃；E8 stolen 遗留清理；
E9 损坏 lock；E10 每个 LockScope 的持锁覆盖与越界写入被拒。

F. 接口：
F1 JournalPort 非法输入/调用顺序；F2 仅 restore 可 resolveTarget；
F3 RepairService 不直接写文件；F4 validation evidence 只能由 recordValidation
进入 journal。

G. 不变量模型测试：
G1 单协作 owner；G2 冲突后未经授权不修改 target；G3 RESOLVED 当且仅当全
target durable==before；G4 恢复成功返回终态后无 marker 不保留 owned 写、
有 marker 永不自动回滚；G5 accept-current 终态不被残留 report 重新触发。

## 13. 明确不在本规格范围
- 插件激活 / PENDING_ACTIVATION（ACTIVATION-SPEC）。
- inspectArtifact / tarball（ARTIFACT-SPEC）。
- pnpm/dsh CLI 细节（PackageManagerPort）。
- 备份、WebDAV、Gist。
