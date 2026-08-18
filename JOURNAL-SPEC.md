# cordis-mp 持久化事务 Journal 正式规格 v2

> 状态：v2，待 Codex 二次 review
> v2 修订：修复 v1 评审 6 个阻断项：
> ① 追加式 op 日志 + 确定性 reducer，支持多次写/回滚二次崩溃；
> ② 文件状态统一为 (exists, hash) 二元组，增加 durable unlink 协议；
> ③ marker 为唯一提交权威，清理改为 rename tombstone，截断尾行可恢复；
> ④ repair 两个动作都有全量预检和确定终态；
> ⑤ JournalPort 收敛为 writeTarget/deleteTarget 等高层原语，内部强制完整写协议；
> ⑥ “不静默覆盖”只对协作锁内写入承诺，非协作写入为 best-effort 检测。

## 1. 范围与保证

本规格定义 cordis-mp mutation（install/update/uninstall/rollback）对 profile
文本文件写入的崩溃恢复协议。目标文件（target）rel 路径封闭 allowlist：
`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
`.cordis-mp/state.json`，其他路径拒绝。

保证分级：
- **协作保证**：所有持有 §8 锁并遵守本协议的进程之间，不存在静默覆盖。
- **非协作保证（best-effort）**：不参与锁的 `dsh plugin` 或手工编辑，通过写前
  乐观检查检测；已知不可检测窗口 = “检查后到 rename/unlink 前”、“终检后到
  marker 创建前”的非协作写入。检测到即 CONFLICTED 并保全证据，绝不静默覆盖。

## 2. 基本类型

- 文件状态 `FileState = { exists: boolean, hash: string | null }`：
  - 存在：`{exists:true, hash:"sha256:<hex>"}`；
  - 不存在：`{exists:false, hash:null}`，不再使用 ABSENT 字符串。
- hash = sha256 内容，hex；空文件 hash 为 sha256("")。
- `targetKey = sha256(rel)`。

## 3. 目录布局

```
profiles/web/.cordis-mp/
  lock.json                       # §8
  journal/<txid>/
    manifest.json                 # 原子写，schemaVersion=1
    snapshots/<key>.bin           # before 内容；before 不存在则不落盘
    ops/<key>.jsonl               # 追加式 op 日志
    COMMITTED                     # 提交唯一权威 marker
    OUTCOME.json                  # 终态（COMMITTED/ROLLED_BACK/ACCEPTED_CURRENT/...）
  conflicts/<txid>/
    evidence/...                  # 冲突证据副本
    report.json
  trash/<txid>-<ts>/              # 清理 tombstone
```

journal/trash/conflicts 目录 0700；文件 0600；父目录创建前 lstat no-follow。

## 4. 状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest 损坏/未知 schema ──→ UNRECOVERABLE
```

| 状态 | 含义 |
|---|---|
| PREPARING | manifest 尚未完整落盘（tx 目录已建） |
| PREPARED | manifest + snapshots 完整；未开始 target 写 |
| MUTATING | 至少一个 op 已 INTENDED |
| FILE_COMMITTED | manifest 记录已提交（仅信息性） |
| ROLLING_BACK | 回滚 op 已 INTENDED |
| ROLLED_BACK | 回滚 op 已 CONFIRMED 且目标达 before |
| CONFLICTED | 检测到外部编辑或修复校验失败 |
| UNRECOVERABLE | journal 损坏/未知版本，只诊断 |

**COMMITTED marker 是提交唯一权威**：
- 有 marker → 已提交，永不自动回滚；manifest.state 可滞后。
- 无 marker → 未提交；即使 manifest.state=FILE_COMMITTED 也按未提交回滚。

## 5. Op 日志协议（核心）

每次逻辑写（正向写、回滚写、删除）都生成一个 op 记录，追加到
`ops/<key>.jsonl`。**恢复不按“最后一行 phase”解释，而是按 opId 顺序运行
确定性 reducer。**

### 5.1 op 记录 schema
```json
{
  "v": 1,
  "opId": "<txid>-<seq>",
  "seq": 3,
  "kind": "FORWARD" | "ROLLBACK",
  "phase": "INTENDED" | "CONFIRMED" | "CANCELLED",
  "expected": { "exists": true, "hash": "sha256:B" },
  "next":     { "exists": true, "hash": "sha256:C" },
  "before":   { "exists": true, "hash": "sha256:A" },
  "mode": "0644",
  "length": 123
}
```
- `before`：事务初始状态；`expected`：执行本次写时期望的当前拥有状态；
  `next`：本次写目标状态。
- seq 每 tx 严格递增，同一 op 更新只追加新 phase（同 opId、seq 相同），
  不允许重复 CONFIRMED；恢复时同一 opId 取最后 phase。

### 5.2 写协议（JournalPort.writeTarget 内部强制）
1. **追加 INTENDED**（append + fsync 文件 + fsync 目录）；
2. **乐观检查**：读取 target 当前 `FileState` 必须 == expected，否则
   CONFLICTED，不写；
3. **执行替换**（§5.3）；
4. **复读校验**：当前 FileState == next，否则 CONFLICTED；
5. **追加 CONFIRMED**（append + fsync + fsync 目录）。

### 5.3 替换原语
- present→present：tmp 同目录随机名 `open('wx')`，写入，fsync file，
  rename 到 target，fsync 父目录；**保留 before 文件 mode**。
- absent→present：同上，新文件 mode 0600。
- present→absent：`unlink(target)`，fsync 父目录。
- absent→absent：不允许作为 op；视为协议错误。
- target 若是 symlink：lstat 发现即拒绝（UNRECOVERABLE 只诊断）。

### 5.4 提交协议
1. 对每个 target 复读 FileState == 最后 CONFIRMED.next；
2. 任一不等 → CONFLICTED；
3. 全部相等 → 原子创建 COMMITTED marker（tmp+rename+fsync 目录）；
4. 写 manifest.state=FILE_COMMITTED（仅信息）。

## 6. 恢复 reducer

### 6.1 输入
- manifest、COMMITTED 存在性、每个 target 当前 FileState；
- 该 target 完整 op 日志（按 seq 排序）。

### 6.2 逐 op 归约
状态：`owned` = 最近一次被本事务 CONFIRMED 成功写入的 FileState；初始 =
`before`（尚无确认写）。`lastOp` 记录最近 opId/phase。

按 seq 顺序处理每个 op（同 opId 取最后 phase）：
| phase | 条件 | 动作 | owned |
|---|---|---|---|
| INTENDED | current == expected | 追加 CANCELLED（幂等） | 不变 |
| INTENDED | current == next | 追加 CONFIRMED（认领） | = next |
| INTENDED | 其他 | CONFLICT | — |
| CONFIRMED | current == next | 接受 | = next |
| CONFIRMED | current == owned | 已恢复/已替换 | 不变 |
| CONFIRMED | 其他 | CONFLICT | — |
| CANCELLED | current == owned | 接受 | 不变 |
| CANCELLED | 其他 | CONFLICT | — |
（匹配按 phase 行执行；`current == next` 与 `current == owned` 同时满足时
取 phase 行中的第一条。）

### 6.3 事务级恢复算法
1. **只读分类**：对全部 target 运行 reducer，得到每 target 的
   `owned`、`hasConflict`、`pendingRollback = (owned != before)`。
2. 任一 target hasConflict → 整体 CONFLICTED；**不执行任何 target 写**。
3. 无冲突：
   - 有 COMMITTED marker → 进入 §6.4，永不回滚；
   - 无 marker：
     - 所有 target `pendingRollback=false` → ROLLED_BACK 终态（幂等）；
     - 否则创建/继续 ROLLBACK ops，对每个 pendingRollback target 执行
       `writeTarget`（expected=owned, next=before），完成 → ROLLED_BACK。
4. 多 tx 目录：按 manifest.createdAt 升序逐个处理；存在未清理 tx 时，
   cordis-mp host 禁止开启新 mutation。

### 6.4 COMMITTED 路径
| 条件（逐 target，唯一匹配） | 判定 |
|---|---|
| current == 最后 CONFIRMED.next | COMMITTED_OK |
| current == before 且 before != next | CONFLICTED（提交后被改回） |
| current == 某历史 CONFIRMED.next（多写场景） | CONFLICTED |
| 其他 | CONFLICTED |
全部 COMMITTED_OK → 写 OUTCOME 并清理；否则 CONFLICTED，不回滚。

### 6.5 缺失/损坏判定
- manifest 完全不存在（tx 目录只有垃圾）：target 写协议要求 manifest 先
  落盘，因此判定 **RECOVERABLE_NOOP**，可直接清 tx 目录。
- manifest 不可读/JSON 无效/schemaVersion 未知 → UNRECOVERABLE。
- JSONL：允许**最后一条尾行截断**（忽略并记 warning）；除此之外任何行
  不可解析、seq 跳变、同 opId 重复 CONFIRMED → UNRECOVERABLE。
- PREPARING 无任何 op：检查所有 target == before → 清理；否则 CONFLICTED。

## 7. 清理协议（tombstone）

- 终态（ROLLED_BACK/COMMITTED/ACCEPTED_CURRENT）确认后：
  1. 写 OUTCOME.json（原子写 + fsync）；
  2. `rename(journal/<txid>, trash/<txid>-<ts>)` + fsync 父目录；
  3. 递归删除 trash 目录。
- 崩溃恢复：journal 已不在 → 看 OUTCOME 或 trash；trash 目录只做删除，
  永不恢复。journal 半删除残骸按 RECOVERABLE_NOOP 处理（因为 marker/OUTCOME
  决定语义已定）。

## 8. 冲突证据与 repair

### 8.1 冲突证据写入协议
1. 复制当前文件到 `conflicts/<txid>/evidence/<targetKey>.bin`（tmp+rename，
   fsync）；当前 absent 则写 `evidence/<key>.absent.json`；
2. 复制 manifest、相关 op 日志、snapshot；
3. 写 `report.json`（原子写）：txid、target、before/owned/current、
   opId、检测阶段、时间；
4. 写 manifest.state=CONFLICTED。
崩溃恢复：report.json 存在即权威 → 补全 evidence 副本并置 CONFLICTED；
evidence 半成品可重做，因为当前文件未被动过。

### 8.2 repair 动作（全量预检，绝无部分成功）
`cordis-mp repair --profile web [--tx <txid>] [--action restore-snapshot|accept-current] [--force] [--yes]`

- 无 action：只读扫描输出 RECOVERABLE / CONFLICTED / UNRECOVERABLE。
- RECOVERABLE：自动执行 §6.3 恢复（若用户未 --yes 则先打印计划）。
- **restore-snapshot**：
  1. 对 tx 全部 target 做只读 reducer；
  2. 任一 hasConflict → 中止，保持 CONFLICTED；
  3. 全部可恢复 → 新建一批 ROLLBACK ops 一次性执行；执行中再冲突 → 停止并
     保持 CONFLICTED（已确认的回滚 op 会记录进度，但**不宣称恢复成功**）；
  4. 全部 target == before → ROLLED_BACK + 清理；否则保持 CONFLICTED。
- **accept-current**：
  1. 封存旧 journal：copy 整个 journal 目录到
     `conflicts/<txid>/accepted-<ts>/`，不修改旧 journal；
  2. 调用业务一致性校验器（§10，独立于 JournalPort）验证当前 profile：
     manifest 可解析、lockfile 与 manifest 一致（执行只读
     `pnpm install --lockfile-only --frozen-lockfile` 语义检查）、
     patch 可解析、state.json 可解析；
  3. 通过 → 写 OUTCOME=ACCEPTED_CURRENT 并 tombstone；失败 → 保持
     CONFLICTED，report 记录 resolution-failed（**不是 UNRECOVERABLE**）。

## 9. 跨进程锁（fencing）

`lock.json`：
```json
{ "owner": "host|repair", "bootId": "...", "pid": 123,
  "ownerToken": "<crypto random>", "epoch": 1,
  "acquiredAt": "...", "heartbeatAt": "..." }
```
- 获取：`open('wx', 0600)`；已存在则读。
- 心跳 5s，stale 阈值 30s；更新用原子替换 + fsync。
- **fencing**：每次 journal 写（op append、manifest 写、marker 创建）前，
  读取 lock 并校验 `ownerToken` == 当前持有者 token；不等 → 立即中止并置
  CONFLICTED（老 owner 被接管后不能继续写）。
- 接管：先 `kill(pid,0)` 检查旧 pid；旧 pid 不存在且 heartbeat stale →
  允许替换 lock（新 token、epoch+1）；旧 pid 存活或无法判定 → repair 需
  `--force`，host 永不 force。
- 边界：锁只约束协作进程；非协作写入按 §1 best-effort。

## 10. JournalPort（EffectPorts）

```ts
interface FileState { exists: boolean; hash: string | null }
interface OpRecord { v: 1; opId: string; seq: number; kind: 'FORWARD'|'ROLLBACK';
  phase: 'INTENDED'|'CONFIRMED'|'CANCELLED'; expected: FileState;
  next: FileState; before: FileState; mode?: string; length?: number }

interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>                 // PREPARING→PREPARED
  writeTarget(tx: TxId, rel: string, next: FileState & { data?: Uint8Array; mode?: string }): Promise<void>
  deleteTarget(tx: TxId, rel: string): Promise<void>          // present→absent
  commitFiles(tx: TxId): Promise<void>                        // 终检+COMMITTED marker
  rollback(tx: TxId): Promise<void>                           // §6.3 回滚
  scan(): Promise<RecoveryReport>                             // 只读
  recover(): Promise<RecoveryReport>                          // RECOVERABLE 自动恢复
  resolveConflict(tx: TxId, action: 'restore-snapshot'|'accept-current',
                  validateBaseline: (tx: TxId) => Promise<BaselineReport>): Promise<Report>
}
```
- `writeTarget`/`deleteTarget` 内部强制 §5.2/§5.3 全顺序；调用方无法只
  prepare 不 confirm，从而 contract test 能强制协议。
- JournalPort **不包含业务状态机**；install-core 决定调用顺序和动作。
- `resolveConflict` 只负责 journal 封存/回滚执行与记录；一致性校验通过
  注入的 `validateBaseline` 完成。

## 11. 文件系统前提

- 支持 POSIX 与 Windows NTFS；要求 rename 同文件系统、父目录 fsync 可用。
- target 为 symlink 时拒绝（lstat）；父目录 no-follow。
- present→present 保留原 mode；新文件 0600；删除协议不恢复 mode。
- 不支持无目录 fsync 语义的文件系统（检测不到时按 best-effort 记录警告）。

## 12. 测试矩阵（M2a contract tests）

除 v1 矩阵外，必须覆盖：
1. 连续多写 `A→B→C`，在每次 INTENDED/替换/CONFIRMED 前后 kill。
2. 正向 CONFIRMED 后回滚 INTENDED 崩溃 → reducer 仍以 owned=B 继续回滚。
3. 回滚 CONFIRMED.next == before 的唯一匹配。
4. absent→present、present→absent、absent→absent 拒绝；unlink 后、父
   fsync 前崩溃。
5. FILE_COMMITTED manifest 与 marker 四种先后组合（尤其
   manifest=FILE_COMMITTED 且无 marker → 回滚）。
6. manifest 缺失但 tx 目录残留 → RECOVERABLE_NOOP。
7. JSONL 尾行截断可恢复；其他损坏 → UNRECOVERABLE。
8. 多文件在第一/中间/最后 target 崩溃；一文件冲突时零 target 被恢复。
9. evidence 复制/report/manifest.state 三步各自崩溃 → 最终 CONFLICTED。
10. tombstone rename 前/后崩溃 → 幂等清理。
11. stale lock 接管后旧 owner 再次 journal 写 → 被 fencing 拒绝。
12. 检查→rename、终检→marker 窗口注入非协作写入 → 记录预期结果
    （可检测或已知不可检测窗口，均需显式断言）。
13. kill -9 矩阵 + 确定性 failpoint model test 双轨验证；不变量：
    无 marker 永不保留 owned 写；有 marker 永不自动回滚。

## 13. 明确不在本规格范围

- 插件激活 / PENDING_ACTIVATION（另立 ACTIVATION-SPEC）。
- inspectArtifact / tarball 校验（另立 ARTIFACT-SPEC）。
- pnpm/dsh CLI 执行细节（PackageManagerPort）。
- 备份、WebDAV、Gist。

## 14. 与 PLAN-v4 状态命名映射

PLAN-v4 的 `DIRTY` = 本规格 `CONFLICTED | UNRECOVERABLE`。后续 PLAN 统一
使用本规格命名，实现与验收只使用一套状态。
