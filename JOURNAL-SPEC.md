# cordis-mp 持久化事务 Journal 正式规格 v7

> 状态：v7 working draft → **S9 后条件冻结 v1.0-final（POSIX FULL）**
> Windows 平台为 BEST_EFFORT，已由 Windows CI 实证；不宣称 FULL
> v7 修订：修复 v6 评审全部阻断项：authoritative head 分派、tombstone 唯一命名与祖先清理、
> 普通锁 acquire 互斥、target durable 原语、validation gate 一次性写入、冲突证据协议恢复。

## 1. 范围与保证

target rel 封闭 allowlist：`package.json`、`pnpm-lock.yaml`、
`cordis.patch.yml`、`.cordis-mp/state.json`。

- 协作保证：遵守 §10 锁协议的进程单 owner、无静默覆盖。
- 非协作 best-effort：外部写入靠写前/终检检测；不可检测窗口为
  “检查后到 replace-target/unlink-target-durable 前”、“终检后到 marker 前”。
- 平台分级：`FULL` = POSIX + 同文件系统原子 rename CAS + 目录 fsync +
  进程身份判定；否则 `BEST_EFFORT`。
- Windows `BEST_EFFORT`：若常规文件或目录的 `fsync` 报已知能力限制
  （`EISDIR`/`EPERM`/`EINVAL`/`ENOTSUP`），记录一次降级告警后继续；未知
  I/O 错误及所有 POSIX `fsync` 错误仍必须失败，不能被降级吞掉。

## 2. 数据模型

- `FileState = { exists: boolean, hash: string | null }`；mode 不参与
  FileState 相等比较，只是写入属性；mode 差异不判冲突，恢复时设置并写入
  report.differences。
- `BaselineFile = { state: FileState, length?: number, mode?: string }`；
  exists=true 时 length/mode 必填。
- `targetKey = sha256(rel)`；`opId = "<txid>-<seq>"`。
- 同一 opId 的 phase 记录共享 seq 且除 phase 外字段完全一致；不同 opId 的
  seq 必须**连续递增**（前一 +1，不允许跳号）。
- fingerprint = `sha256(canonicalJson({rel: FileState...}))`，rel 按字典序，
  canonicalJson 为无空白、键排序 JSON，UTF-8。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json
  journal/<txid>/{manifest.json, snapshots/<key>.bin, ops/<key>.jsonl,
                 COMMITTED, OUTCOME.json}
  resolutions/<rid>/{manifest.json, ops/<key>.json, confirmed/<key>,
                     validation.json, OUTCOME.json}
  conflicts/<txid>/{evidence/..., report.json, accepted-<ts>/...}
  trash/<kind>-<name>-<nonce>/
```
目录 0700；文件 0600；父目录 lstat no-follow。

## 4. 公共 durable primitive

- `atomic-file(path, bytes, {mode, exclusive=false})`：
  写 tmp `open('wx')` → 写 bytes → **chmod mode** → fsync file → rename →
  fsync 父目录。exclusive=true 时用 `link/renameat2(NOREPLACE)` 或平台
  等价语义保证目标不存在才成功；失败即 EEXIST。
- `append-record(path, jsonline)`：append → fsync file → fsync dir。JSONL
  允许忽略唯一末尾截断行并告警，其余损坏 → UNRECOVERABLE。
- `marker(path)`：`atomic-file(path, EMPTY, {exclusive:true})`。
- `replace-target(path, bytes, mode)`：tmp `open('wx')` → 写 → chmod → fsync
  file → rename → fsync 父目录。
- `unlink-target-durable(path)`：unlink → fsync 父目录。
- `tombstone(kind, dir)`：`rename(dir, trash/<kind>-<basename>-<nonce>)` →
  fsync 源父目录 → fsync trash 父目录 → 递归删除；源不存在 → 幂等成功。
  nonce 为随机值，避免 journal/conflicts 同名冲突。

## 5. 普通事务状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest/op 链损坏 ──→ UNRECOVERABLE
```
COMMITTED marker 是提交唯一权威。PLAN-v4 `DIRTY` 映射见 §2。

## 6. 普通 op 协议

### 6.1 schema 与链校验
op 字段：`v,txid,targetKey,opId,seq,kind,phase,expected,next,before,
mode,length`（present 目标 mode/length 必填并描述 next；absent 目标缺省）。
校验：before==baseline.state；首 op expected==before；后续 op
expected==前一逻辑 owned；phase 只允许 INTENDED→CONFIRMED|CANCELLED；同
opId 字段一致；seq 连续；kind=ROLLBACK 必须 next==baseline.state；每
target 至多一个 pending INTENDED；present 目标的 length 等于 next 内容
bytes、mode 合法。

### 6.2 写协议
1. append INTENDED；2. fencing + current==expected；3. `replace-target` 或
   `unlink-target-durable`（present→present 用 baseline.mode 或上一
   CONFIRMED.mode；**rollback 恢复 absent→present 时用 baseline.mode**；
   其他 absent→present 用 0600）；4. 复读 current==next；5. append
   CONFIRMED。absent→absent 拒绝。

### 6.3 提交
所有声明 target 最后 op CONFIRMED、无 pending → 复读 current==next →
`marker(COMMITTED)` → atomic manifest.state=FILE_COMMITTED。

## 7. 普通事务恢复

- Phase 0（零写入预检）：所有 before.exists=true 的 snapshot 存在且
  hash/length/mode 匹配；任一失败 → UNRECOVERABLE。
- Phase 1（纯读）：逻辑归约（CONFIRMED⇒owned=next；CANCELLED⇒owned 不变；
  末尾 INTENDED 为 pending）；物理判定：无 pending current==owned；pending
  current==expected→计划 CANCELLED，current==next→计划 CONFIRMED 并
  owned=next，其他 CONFLICT。
- Phase 2（持锁）：执行每个 planned append 前重读 current 复核。冲突 →
  archiveConflict + CONFLICTED，零 target 写。否则执行 appends；对
  pendingRollbackSet 生成 ROLLBACK op；全达 before → ROLLED_BACK →
  OUTCOME → tombstone。Phase 2 新冲突 → 进度持久、CONFLICTED、不报成功。
- COMMITTED 路径：最后 op CONFIRMED 且 current==next，否则 CONFLICTED
  不回滚。

### 7.1 冲突证据协议（archiveConflict）
1. 复制 current（或写 absent marker）到 evidence/，复制后校验 hash；
2. 复制 manifest/ops/snapshots；
3. 最后 atomic-file report.json（含 evidence 摘要与检测阶段）；
4. atomic manifest.state=CONFLICTED。
中途崩溃：report 不存在 → 重做；report 存在 → 补全 evidence 后视为权威。

## 8. Resolution journal

### 8.1 schemas
- manifest：`v,resolutionId,txid,createdAt,supersedes,action,state,plan?`
  restore-snapshot：plan 必填 immutable（expected=计划时 current；
  next=原 baseline.state）；accept-current：plan 缺省。
- resolution op（每 target 原子文件）：`v,resolutionId,txid,rel,targetKey,
  expected,next`。
- validation.json（accept-current，**once-only**）：
  `v,resolutionId,valid:true,fingerprint,baselineReport,createdAt`。
  只允许写一次（exclusive）；重复调用返回 JOURNALLED；写入时 JournalPort
  重新计算当前 fingerprint 并必须与 evidence 一致，否则拒绝。

### 8.2 执行
- restore-snapshot：
  - Phase 0：原 journal baseline 全部 snapshot 全量预检，失败 →
    UNRECOVERABLE，零 target 写；
  - 每 target：无 op → 按 plan 原子写 op；confirmed 且 current==next →
    DONE；confirmed 且 current==expected → 删 confirmed 重做；无 confirmed：
    current==expected → replace/unlink + confirmed；current==next → 补
    confirmed；其他 CONFLICT；
  - 终检全部 current==next → OUTCOME=RESOLVED；
  - 任一 CONFLICT → OUTCOME=RESOLUTION_CONFLICTED，进度持久、不报成功。
- accept-current：
  - 由单一原子流程执行：RepairService 持锁调用
    `JournalPort.beginResolution({action:'accept-current'})` →
    BaselineValidator（只读）→ `JournalPort.recordValidation(rid, evidence)`
    → `JournalPort.completeResolution(rid)`。JournalPort 在
    recordValidation 时复算 fingerprint 并拒绝第二次写入。
  - completeResolution 复读 fingerprint：==validation → OUTCOME=
    ACCEPTED_CURRENT；否则 OUTCOME=RESOLUTION_CONFLICTED。
  - 恢复续跑：validation 存在且指纹匹配 → 补 ACCEPTED_CURRENT；指纹不匹配
    → RESOLUTION_CONFLICTED；无 validation → PLANNED 等待重新授权。

### 8.3 supersedes 与 authoritative head
- 创建新 resolution：若同 tx 已有 RESOLUTION_CONFLICTED 的 head：先写旧
  `OUTCOME=SUPERSEDED`，再写新 manifest.supersedes。
- 全局归约定义：
  - 校验 supersedes 图：循环、跨 tx、悬空引用、一旧多新、分叉 →
    UNRECOVERABLE；
  - `authoritative head` = 唯一未被任何同 tx rid 的 supersedes 指向的 rid
    （**无论是否已有 OUTCOME**）；
  - 按 head 分派：
    - OUTCOME=RESOLVED|ACCEPTED_CURRENT → 成功清理路径 §8.4；
    - OUTCOME=RESOLUTION_CONFLICTED → waiting authorization；
    - OUTCOME=SUPERSEDED 或无 OUTCOME → executable active；
  - 有多个 head → UNRECOVERABLE。

### 8.4 成功清理（幂等，含祖先）
head 为 RESOLVED/ACCEPTED_CURRENT 时：
1. tombstone 原 `journal/<txid>`；
2. tombstone `conflicts/<txid>`；
3. tombstone 所有被 supersede 的祖先 resolution；
4. tombstone head resolution。
每一步使用 unique nonce；任一步崩溃后，下次扫描仍以 head 终态重新进入
清理，绝不回退到 conflict report。

## 9. 全局扫描归约

### 9.1 阶段 0（纯读）
1. 收集 journal/resolutions/conflicts/trash；
2. trash 标记待删；
3. 按 tx 分组校验 supersedes 图并选 head（§8.3）；
4. 生成 GlobalRecoveryPlan：trash、每 tx head 分派、无 resolution 的原
   journal 证据分类。
### 9.2 阶段 1（持锁执行）
- trash → 删除；
- 有 head → §8.2/§8.3/§8.4；
- 无 resolution：
  - conflict report 存在 → CONFLICTED，只允许 repair action；
  - OUTCOME 有效 ROLLED_BACK|COMMITTED → tombstone；缺失 → 继续；其他
    有效值按语义；损坏 → UNRECOVERABLE；
  - COMMITTED marker → 提交路径；
  - manifest 缺失：目录空或仅 *.tmp → RECOVERABLE_NOOP 删除；否则
    UNRECOVERABLE；
  - 否则 §7。
- **陈旧 plan 校验**：Phase 1 开始与每个写步骤前，重算 head、op/manifest
  摘要、planned current；任何变化 → 丢弃旧 plan 重新 scan。

### 9.3 resolution 异常表
| 证据 | 判定 |
|---|---|
| 目录仅 *.tmp | RECOVERABLE_NOOP |
| manifest 缺失/截断/未知版本 | UNRECOVERABLE |
| OUTCOME 损坏/未知/与 action 不匹配 | UNRECOVERABLE |
| supersedes 图非法 | UNRECOVERABLE |
| op/confirmed/validation 损坏或与 manifest 不一致 | UNRECOVERABLE |
| snapshot 预检失败 | UNRECOVERABLE，零 target 写 |
| plan target 集合 ≠ baseline 集合 | UNRECOVERABLE |
| head 成功终态但 manifest 缺失且无法反查 txid | UNRECOVERABLE |

## 10. 跨进程锁

### 10.1 锁文件与 acquire
- `lock.json` 字段：owner,bootId,pid,processStartToken,ownerToken,epoch,
  acquiredAt,heartbeatAt。
- **正常 acquire 必须互斥**：用 `atomic-file(..., {exclusive:true})` 创建
  lock；EEXIST → 读现有 lock：
  - owner 存活（三元组一致且 pid 活）且 heartbeat 未 stale → 等待或返回
    BUSY（不覆盖）；
  - dead+stale → 走 takeover CAS。
- heartbeat 5s，stale 30s；heartbeat 更新 = atomic-file 替换（此时仍是
  唯一 owner，不与其他 live owner 竞争）。
- takeover CAS（S5c）：读旧 → 拒绝活/未 stale → `rename(lock,
  lock.stolen-<token>)` 唯一赢家 → 复核 stolen 一致 → 复核 dead+stale →
  `open(lock,'wx')` 创建新锁；EEXIST → 失败者只读退出。间隙已出现新 lock
  时绝不覆盖。
- release：校验 token → unlink + fsync 目录。
- `stolen-*` 遗留物由持锁扫描清理。

### 10.2 LockPort 生命周期
```ts
interface LockPort {
  acquire(scope, {force?}): Promise<LockLease>
  withLock(scope, fn): Promise<T>
  heartbeat(lease): Promise<void>
  release(lease): Promise<void>
}
type LockScope = 'mutation'|'recovery'|'resolution'|'cleanup'|'repair-action'
```
持锁范围：普通事务 begin→cleanup；recovery Phase 2；resolution 创建/
supersede/执行/complete/清理；archiveConflict、OUTCOME、tombstone、trash/
stolen 清理。只读范围可无锁：scan/Phase 0/Phase 1/validator。
- heartbeat 失败或 lease 被接管 → 当前操作在下一个写步骤前终止。
- `acquire` 无 force 参数时永不接管活 owner；`--force` 只在无法判定死亡时
  由 repair-action 使用并降级保证、记 warning。

## 11. 接口

```ts
interface JournalPort {
  begin(targets): Promise<TxId>
  writePresent(tx, rel, data): Promise<void>
  delete(tx, rel): Promise<void>
  commitFiles(tx): Promise<void>
  rollback(tx): Promise<void>
  scan(): Promise<GlobalRecoveryPlan>
  recover(plan): Promise<RecoveryReport>
  archiveConflict(tx): Promise<void>

  beginResolution(req: ResolutionRequest): Promise<ResolutionId>
  resolveTarget(rid, rel): Promise<void>
  recordValidation(rid, evidence: {valid:true, fingerprint, baselineReport}): Promise<void>
  completeResolution(rid): Promise<ResolutionOutcome>
}
interface BaselineValidatorPort {
  validateCurrentProfile(): Promise<BaselineReport & { fingerprint }>
}
```
- `recordValidation` once-only；写入时重算 fingerprint；action 必须为
  accept-current；否则 JOURNALLED。
- `resolveTarget` 对 accept-current 非法。
- 恶意/越权进程内调用不在威胁模型内；所有 gate 只防止崩溃/顺序错误与
  绕过 validator 流程。

## 12. 测试矩阵（自包含）

A 普通归约：A1 A→B→C；A2 A→B→A；A3 回滚 INTENDED 崩溃 current=B；
A4 CANCELLED 后继续回滚；A5 seq 跳号/重复/字段不一致/双 pending/尾行截断
与非尾行损坏。
B 写入：B1 present→present/absent→present/present→absent 每步崩溃；
B2 absent→absent 拒绝；B3 mode 仅变化不冲突且记录差异；B4 Phase 0
hash/length/mode 失败零写入；B5 非协作写入两个窗口。
C 提交/清理：C1 marker 前后；C2 FILE_COMMITTED 无 marker 回滚；
C3 OUTCOME 有效/缺失/损坏；C4 tombstone unique nonce、源缺失幂等、每步
崩溃。
D resolution：D1-D13（v6 全保留）外加：
D14 head=RESOLVED 后第 1 次 tombstone 前崩溃 → 继续清理不回退；
D15 清理祖先链每步崩溃；D16 journal/conflicts 同名 basename 不冲突；
D17 supersedes 循环/分叉/跨 tx/悬空/一旧多新；D18 plan 集合≠baseline 集合。
E 锁：E1-E10（v6 全保留）外加：
E11 两个普通 acquire 并发恰好一个成功；E12 heartbeat 更新与 takeover
rename 竞争；E13 lease 丢失后下一写步骤拒绝；E14 recordValidation 重复
调用拒绝；E15 acquire 时 owner 存活返回 BUSY。
F 接口：F1-F4（v6 保留）外加 F5 recover(plan) 陈旧 plan 丢弃并重新 scan。
G 不变量：G1-G5（v6 保留）外加 G6 成功终态不会被残留 report 重新触发；
G7 validation 只能写一次且必须与当前 fingerprint 匹配。

## 13. 明确不在本规格范围
- 插件激活 / PENDING_ACTIVATION（ACTIVATION-SPEC）。
- inspectArtifact / tarball（ARTIFACT-SPEC）。
- pnpm/dsh CLI 细节（PackageManagerPort）。
- 备份、WebDAV、Gist。
