# S6 自审报告

## 本轮完成
- ResolutionJournal.recover()：按 tx 分组、校验 supersedes 图、按 OUTCOME 分派；
  restore 自动续跑/complete/cleanup；accept-current 自动按 validation 指纹续跑。
- Lock：Linux 下记录/比较 /proc/<pid> 启动 ticks 防 PID 复用；半初始化 lock 目录自动清理；
  sweepLockDebris 按 60s 陈旧阈值安全清理 stolen 目录。
- durable：durabilityTier()；Windows 目录 fsync 不可用时降级 BEST_EFFORT 并告警一次。
- 矩阵新增：append after-write、OUTCOME after-publish、resolution op after-publish。
- 最终 66 tests / 66 pass。

## 自审发现并修复
1. lock mkdir 成功但 owner 写入失败会留下永久 BUSY 半初始化目录 → try/catch 清理。
2. matrix-helper resolution 场景缺少 join 导入且 hash 生成错误 → 修复。
3. resolution.recover 对 list() 解析异常无保护 → 返回错误报告而非抛异常。
4. resolution.recover 中 cleanupTerminal 异常会吞掉成功结果 → 记录 cleanup 错误码。

## 仍未闭环
见 M2A-FREEZE-REPORT.md 待办 G1/G2/G6/G7/G10。
