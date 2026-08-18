# S5c dead-owner lock takeover CAS 原型

协议（rename-to-stolen）：
1. 读旧 lock；若 pid 存活或 heartbeat 未 stale → 拒绝接管。
2. CAS：`rename(lock, lock.stolen-<myToken>)`，同源文件只允许一个赢家，
   输家 ENOENT。
3. 赢家复核 stolen 内容与读到的 ownerToken/processStartToken 一致。
4. 复核 pid 已死且 heartbeat stale；否则把 stolen rename 回 lock 并放弃。
5. `open(lock,'wx')` 创建新 lock（新 token、epoch+1）。

实测：
- 活 owner：拒绝接管，旧 lock 保持。
- 双 repair 并发抢 dead lock ×5：每次恰好 1 个赢家；输家原因
  heartbeat-not-stale 或 owner-alive（读到赢家新锁）；终态 lock 为新 token。
- 关键补充：只判 pid 死亡不够，必须同时要求 heartbeat stale；否则
  “新 repair 刚接管就崩溃”会被第二个 repair 立即再接管，产生级联。

结论：rename CAS + liveness/staleness 双条件可形成协作单 owner；spec v4
要求 FULL 平台具备原子 rename 原语，其他平台降级为 BEST_EFFORT。
