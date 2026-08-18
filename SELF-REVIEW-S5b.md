# S5b 自审报告

## 本轮完成
1. **Lock 改为目录锁**：mkdir 原子排他；heartbeat/owner 写在自有目录内；
   takeover = rename(lockdir, stolen-<tag>) CAS + 复核 dead+stale + mkdir 新锁。
   消除“check-then-overwrite lock.json”的旧 owner 覆盖新锁路径。
2. **ValidationEvidence ticket**：Symbol-brand 对象，plain object 无法通过
   recordValidation；once-only + fingerprint 复算保持。
3. **Conflict evidence**：archive 前先写 evidence-manifest（name/hash/length），
   report 携带 evidence 清单；恢复扫描逐文件校验 hash/length；report 已存在则
   archive JOURNALLED；evidence 缺失/损坏返回 BAD_REPORT/BAD_EVIDENCE。
4. **Trash 清扫**：tombstone 在双目录 fsync 后递归删除；`Journal.recover()`
   入口先 sweepTrash，解决 trash 永久增长与 tombstone 崩溃残留。
5. **参数化磁盘矩阵**（公开 Journal API + 子进程直接 exit(43)）：
   - forward 写 crash after-rename / after-dirfsync → 二次恢复 ROLLED_BACK
   - delete crash after-unlink → 恢复 present
   - rollback crash after-rename → 二次恢复完成
   - committed recover crash after tombstone rename → sweep + 清理
6. 修复 `Journal.begin()` 的 active tx 检查、损坏 manifest 的 BAD_MANIFEST、
   commitFiles OUTCOME 前 fence、Resolution 的 BAD_ACTION / 仅冲突 head 可
   supersede / complete once-only / cleanup 祖先 txid 校验。

## 测试
- 61 tests / 61 pass。
- 运行：`node --test test/*.test.mjs`

## 仍明确未闭环（诚实清单）
- `ownerAlive` 仍只验证 pid；`bootId/processStartToken` 尚未绑定 OS 进程启动时间。
- `fsyncDir` 在 Windows 的 BEST_EFFORT 降级未实现（POSIX 环境无法验证）。
- Resolution 的恢复扫描（根据 OUTCOME 自动续跑/清理）尚未完全实现；
  `completeResolution` 恢复路径仍需要调用方驱动。
- 全边界 kill -9 矩阵仍缺：append file/dir fsync、atomic exclusive publish、
  outcome、validation、resolution op/confirmed 每个窗口的独立子进程用例。
- `sweepLockDebris` 未接入自动清理（避免误删进行中的 takeover 证据）。
- evidence 的 directory fsync 通过 atomicFile 间接保证，未单独注入测试。

## 结论
S5b 主体完成：普通事务 + resolution 核心 + 锁 + 证据 + 矩阵测试均有实质
进展。Freeze gate G3/G8/G9 的普通路径更接近关闭；G4/G5/G10 仍有明确缺口。
