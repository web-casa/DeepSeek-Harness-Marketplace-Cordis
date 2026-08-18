# 四轮 codex 评审结论（恢复版）

- v1 初稿：4 阻断（API 信任根、仅同源、tgz 校验、里程碑顺序）。
- v2：可进 M0 不能进 M2；残留 5 项。
- v3：残留 5 项；journal hash 逻辑错误、字节连续性、激活屏障、commit 边界、repair 过强。
- v4 最终结论：**可以立即启动 M0**；字节连续性与 COMMITTED/激活边界基本解决。
  3 个 M0 退出硬门：journal 崩溃原子性（per-write intent）、服务端激活门
  （PENDING_ACTIVATION 独立事务）、repair 恢复闭包（完整矩阵）。
  工期建议 9–13 周；GitHub-only v1 不做一键安装属合理收敛，需产品确认。
