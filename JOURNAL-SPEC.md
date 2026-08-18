# cordis-mp 持久化事务 Journal 正式规格 v1

> 状态：待 Codex review
> 输入：PLAN-v4.md §6、spikes/S5 的 per-write intent 原型与 crash-point 实验结果
> 目标：作为 M2a 的实现契约与恢复矩阵的 contract test 来源
> 保证范围：本规格只保证 cordis-mp 自己拥有的 profile 文本文件写操作
> （package.json、pnpm-lock.yaml、cordis.patch.yml、.cordis-mp/state.json）
> 崩溃后可判定并可恢复；不能阻止非协作外部进程在 hash 检查与 rename 之间写入，
> 但能检测大多数此类编辑并永不静默覆盖。

## 1. 术语

- **tx**：一次 mutation（install/update/uninstall/rollback）产生的事务。
- **目标文件（target）**：tx 声明要修改的 profile 文本文件，rel 路径必须来自
  封闭 allowlist：
  `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、
  `.cordis-mp/state.json`。其他路径拒绝。
- **beforeHash / lastOwnedHash / nextHash**：
  - `beforeHash`：事务开始时文件内容 hash（absent 用 `ABSENT` 哨兵）。
  - `lastOwnedHash`：本事务最近一次成功写该文件后的 hash（初始 = beforeHash）。
  - `nextHash`：本次准备写入内容的 hash。
- **intent**：一次“将要写/已写”的持久化记录。
- **COMMITTED marker**：表示所有目标文件写入已确认、文件事务提交完成的
  独立 marker 文件。它与插件“激活/启用”无关。

## 2. 目录布局与文件

```
profiles/web/.cordis-mp/
  lock.json                       # 跨进程锁（§8）
  journal/<txid>/
    manifest.json                 # schemaVersion、state、targets、outcome
    snapshots/<targetKey>.bin     # 事务前内容（absent 不落盘）
    intents/<targetKey>.jsonl     # 追加式 intent 记录（每行一条）
    COMMITTED                     # 空 marker
    OUTCOME.json                  # 终态记录（可选，供清理幂等）
  conflicts/<txid>/
    evidence/                     # 当前文件副本 + snapshot + manifest 副本
    report.json
```

- `<targetKey>` = sha256(rel)。JSONL 追加式 intent，最后一条是权威记录。
- 所有 journal 文件 0600；journal 目录 0700；创建目录时对父目录做
  no-follow/lstat 校验。

## 3. 状态机

```
PREPARING → PREPARED → MUTATING → FILE_COMMITTED → CLEANED
                              ↘ ROLLING_BACK → ROLLED_BACK → CLEANED
任意态 ──冲突──→ CONFLICTED
manifest 不可读/未知 schema ──→ UNRECOVERABLE
```

| 状态 | 含义 | 可授权动作 |
|---|---|---|
| PREPARING | manifest 尚未完整落盘 | 仅继续写 journal 自身文件 |
| PREPARED | 快照与 intent 元数据完整，未开始改 target | 开始 MUTATING |
| MUTATING | 正在修改 target 文件 | 按 intent 协议写 target；可进入回滚 |
| FILE_COMMITTED | COMMITTED marker 已落盘 | 只清理；不得回滚 target |
| ROLLING_BACK | 回滚意图已持久化 | 按回滚 intent 恢复 target |
| ROLLED_BACK | 所有 target 已恢复 before | 清理 |
| CONFLICTED | 检测到外部编辑 | 仅用户显式 resolve |
| UNRECOVERABLE | journal 损坏/未知版本 | 仅诊断，禁止自动写 |

状态迁移落盘顺序（关键）：
- PREPARED：manifest + 全部 snapshot + 初始 intent 记录都 fsync 后，
  最后把 manifest.state 原子更新为 `PREPARED`。
- FILE_COMMITTED：所有 intent 已 CONFIRMED 且终检通过 → 原子写 manifest
  state=`FILE_COMMITTED` → 创建 COMMITTED marker → fsync 目录。
  恢复时 **COMMITTED marker 是权威**，manifest 只是加速信息。
- ROLLING_BACK：先持久化回滚 intent（§5.4），再写 manifest state。
- CONFLICTED：写 manifest state 与 conflicts/<txid>/report.json，**不修改
  任何 target**。

## 4. Per-write intent 协议

对每个目标文件的每次写（包括回滚写）执行：

### 4.1 追加 INTENDED 记录（先落盘）
```json
{
  "seq": 1,
  "phase": "INTENDED",
  "existsExpected": true,
  "expectedHash": "sha256:<lastOwnedHash|ABSENT>",
  "nextExists": true,
  "nextHash": "sha256:<hex>",
  "nextLength": 123
}
```
写入 `intents/<key>.jsonl`（append + fsync 文件 + fsync 目录）。
对 absent：`existsExpected:false, expectedHash:"ABSENT"`；
写 absent：`nextExists:false, nextHash:"ABSENT"`。

### 4.2 乐观检查（写前）
读取当前 target：
- 当前状态（exists + hash）必须等于 INTENDED 的 expected 状态；
- 不等 → 进入 CONFLICTED，禁止写入。

### 4.3 原子替换
- `tmp` 文件同目录、随机名、`open('wx', 0600)`；
- 写入全部字节、`fsync` 文件；
- `rename` 到 target；
- `fsync` 父目录。

### 4.4 追加 CONFIRMED 记录
```json
{ "seq": 2, "phase": "CONFIRMED", "existsExpected": true, "expectedHash": "...",
  "nextExists": true, "nextHash": "...", "nextLength": 123 }
```
append + fsync。CONFIRMED 存在即表示“本事务已拥有该文件当前状态”。

### 4.5 提交前终检
COMMITTED 前对每个 target 重新读取并验证当前 hash == 最后 CONFIRMED 的
nextHash。任一不等 → CONFLICTED，不写 marker。

### 4.6 崩溃语义（核心不变量）
恢复时按“manifest 中的 state + 每条 intent 的最后 phase + target 当前
状态”判定，**不得依赖进程内 lastOwnedHash 变量**。三类基本结果：
- 未写：INTENDED 且当前 == expected → 该 intent 作废（追加 CANCELLED）。
- 已写未确认：INTENDED 且当前 == next → 追加 CONFIRMED（认领自己的写）。
- 已确认：CONFIRMED 且当前 == next → 正常。
- 其余组合 → CONFLICTED。

## 5. 恢复算法与矩阵

### 5.1 扫描
- 无 journal 目录 → `CLEAN`。
- `manifest.json` 不可读、schemaVersion 未知、target 含 allowlist 外路径、
  intent JSONL 不可读 → `UNRECOVERABLE`（只诊断）。
- 有 COMMITTED marker → 走 §5.2。
- 无 marker → 走 §5.3。

### 5.2 已 COMMITTED
| 证据 | 判定 | 动作 |
|---|---|---|
| 每个 target：最后 intent CONFIRMED 且当前 hash == nextHash | COMMITTED_OK | 清理 tx 目录 |
| 任一 target 当前 hash 既不等于 nextHash 也不等于 beforeHash | CONFLICTED | 保留现场，生成 evidence/report；**不自动回滚** |
| 当前 == beforeHash | COMMITTED_PARTIAL | 进入 CONFLICTED（commit 后文件被改回，需人判） |
| 当前 == ABSENT 但 before 存在 | CONFLICTED | 同上 |

### 5.3 未 COMMITTED（PREPARED / MUTATING / ROLLING_BACK / ROLLED_BACK）
对每个 target 按最后 intent：
| intent 最后 phase | 当前状态 | 判定 | 恢复动作 |
|---|---|---|---|
| 无 intent | = before | NOT_WRITTEN | 无 |
| INTENDED | = expected | NOT_WRITTEN | 追加 CANCELLED，无 target 写 |
| INTENDED | = next | WRITTEN_UNCONFIRMED | 追加 CONFIRMED，进入待回滚 |
| INTENDED | 其他 | CONFLICT | CONFLICTED |
| CONFIRMED | = next | OWN_WRITE | 进入待回滚 |
| CONFIRMED | = before | ALREADY_RESTORED | 幂等：无 target 写 |
| CONFIRMED | 其他 | CONFLICT | CONFLICTED |
| CANCELLED | = before | NOT_WRITTEN | 无 |
| CANCELLED | ≠ before | CONFLICT | CONFLICTED |

若任一 target CONFLICT → 整体 CONFLICTED。
否则对每个“待回滚”target 执行回滚写（§5.4），完成后 state=ROLLED_BACK，
校验所有 target == before，写 OUTCOME，清理。

PREPARING / PREPARED 无 MUTATING 语义时按“无 intent”路径处理：
- 所有 target == before → 清理（幂等 no-op）。
- 任一 target ≠ before → CONFLICTED（事务还没声明写，现场却被改）。

### 5.4 回滚写（同样走 intent 协议，保证二次崩溃可恢复）
对每个待回滚 target：
1. 追加 INTENDED：expected = 最后 CONFIRMED.nextHash（或认领后的 nextHash），
   next = before（含 ABSENT）。
2. 乐观检查。
3. 原子替换为 before 内容 / 删除文件（nextExists=false 时）。
4. 追加 CONFIRMED。
5. 若回滚过程中再崩溃：恢复时看到回滚 intent，按同一矩阵继续，
   最终收敛到 before 或 CONFLICTED。

### 5.5 二次崩溃矩阵（实现为 contract tests）
- 恢复写入 CANCELLED / CONFIRMED 之前崩溃 → 重跑扫描，结果一致。
- 回滚 INTENDED 后、替换前崩溃 → NOT_WRITTEN，继续回滚。
- 回滚替换后、CONFIRMED 前崩溃 → WRITTEN_UNCONFIRMED 认领，继续。
- OUTCOME 已写但清理未完成 → 幂等清理。
- 两个 cordis-mp 进程同时 recovery → 由 §8 锁串行；后到者看到 CLEAN。

## 6. 冲突处置

1. 任何 target 判 CONFLICT 后：
   - 复制当前文件、manifest、相关 intent、snapshot 到
     `conflicts/<txid>/evidence/`（复制失败则记录并停止，绝不移动 live 文件）。
   - 写 `conflicts/<txid>/report.json`：txid、target、before/expected/next/
     当前 hash、时间、检测阶段。
   - manifest.state=CONFLICTED。
2. repair 对 CONFLICTED 只提供两种显式动作：
   - `accept-current`：对当前文件集执行一致性校验（manifest 与 lockfile、
     patch 可解析、state.json 可解析），校验通过后建立新 baseline（重写
     manifest 为 PREPARED 并更新 before 值）再按 §5.3 收敛；校验失败 →
     UNRECOVERABLE。
   - `restore-snapshot`：对“当前 == 最后 CONFIRMED.nextHash 或 beforeHash”
     的目标执行回滚写恢复 before；其他冲突目标保持原样并在 report 列出；
     完成后运行一致性校验，失败 → UNRECOVERABLE。
3. 禁止任何“自动保留一方”的默认动作。

## 7. repair CLI 三态

`cordis-mp repair --profile web [--action accept-current|restore-snapshot] [--force] [--yes]`

- 无 action：扫描并输出分类。
- `RECOVERABLE`：自动幂等恢复（含 FILE_COMMITTED 的清理）；写入动作只
  发生在“未写/已写未确认/已确认”三类可判定情况下。
- `CONFLICTED`：必须提供 action；每次只处理一个 txid。
- `UNRECOVERABLE`：输出精确手工步骤，不改文件。
- repair 从 profile 外启动也能工作（不 import DSH/Cordis）；journal schema
  版本不同只诊断。
- repair 与 host 共用 §8 锁；stale lock 需要 `--force` 且打印 owner 信息。

## 8. 跨进程锁

`lock.json`：
```json
{ "owner": "cordis-mp-host|repair", "bootId": "...", "pid": 123,
  "acquiredAt": "...", "heartbeatAt": "..." }
```
- 获取：`open('wx', 0600)` 原子创建；已存在则读 heartbeat。
- 心跳每 5s 更新；陈旧阈值 30s（心跳 < 阈值）。
- 宿主 mutation 与 repair 互斥；recovery 扫描不要求锁，但任何写动作要求锁。
- 锁文件本身使用原子替换 + fsync；损坏时视为 stale 并提示。
- 明确边界：外部 `dsh plugin` 或手工编辑不参与本锁。对这类写入，§4.2/§4.5
  的 hash 检查是唯一防线；**规格不承诺“绝不覆盖非协作写入”**，只承诺
  检测与证据保全。

## 9. JournalPort（EffectPorts 中的实现边界）

```ts
interface JournalPort {
  begin(targets: TargetSpec[]): Promise<TxId>       // PREPARING→PREPARED
  prepareWrite(tx: TxId, rel: string, next: Content): Promise<WriteHandle>
  confirmWrite(tx: TxId, h: WriteHandle): Promise<void>
  markMutating(tx: TxId): Promise<void>
  commitFiles(tx: TxId): Promise<void>              // 终检 + COMMITTED marker
  beginRollback(tx: TxId): Promise<void>
  completeRollback(tx: TxId): Promise<void>
  scan(): Promise<RecoveryReport>
  resolveConflict(tx: TxId, action: 'accept-current'|'restore-snapshot'): Promise<Report>
}
interface WriteHandle { rel: string; seq: number; expectedHash: string; nextHash: string }
```
约束：
- JournalPort 只做持久化原语与恢复判定，**不包含业务状态机**；状态迁移由
  install-core 根据本规格调用。
- 所有 hash 用 sha256，hex 编码；ABSENT 使用固定哨兵。
- 任何 prepareWrite 未 confirm 就调用下一 prepareWrite 是协议错误，返回
  409 语义的 JOURNALLED 错误。

## 10. 测试与验收矩阵

M2a contract tests 必须逐项覆盖：

1. §4.6 的每个 crash-point：manifest 落盘前/后、snapshot 后、INTENDED 后、
   tmp 写后、rename 后、CONFIRMED 前/后、COMMITTED 前/后。
2. §5.2 与 §5.3 每一行（含 ABSENT 创建/删除、CANCELLED 后又被外部改）。
3. §5.5 二次崩溃每一步。
4. 冲突证据完整性：evidence 文件内容、live 文件未被移动。
5. lock：宿主持锁时 repair 拒绝；stale lock 提示；心跳陈旧边界。
6. 性能：单次 mutation 的 journal 追加次数固定、无全量目录扫描（除 recovery）。
7. 真实 kill -9 注入：用子进程执行预置场景，从 journal 状态中每个点强杀后
   运行 repair，断言终态。
8. 契约测试跑 Web adapter 与 desktop-shaped adapter 同一套用例。

## 11. 明确不在本规格范围

- 插件激活 / PENDING_ACTIVATION / entry-id 门禁（另立 ACTIVATION-SPEC）。
- inspectArtifact / tarball 校验（另立 ARTIFACT-SPEC）。
- pnpm / dsh CLI 执行细节（PackageManagerPort）。
- 跨设备备份、Gist、WebDAV。
