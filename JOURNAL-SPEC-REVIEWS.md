# Journal spec codex 评审记录

- v1 → 6 阻断：多次写 reducer、ABSENT/删除、marker 顺序、repair 终态、
  JournalPort 职责、保证边界。见 codex-review-journal-spec-v1.md。
- v2 → 6 阻断未全解：A→B→C 误判、restore 不可用/部分成功、fencing TOCTOU、
  OUTCOME/tombstone 缺口。见 codex-review-journal-spec-v2.md。
- v3 → 不能冻结：普通 reducer 基本解除；RESOLUTION 事务、扫描优先级、
  死锁接管竞争、自动回滚 snapshot 预检仍阻断。见 codex-review-journal-spec-v3.md。
- 当前状态：JOURNAL-SPEC.md v3 不冻结；M2a 开工前需出 v4 或先做
  resolution/lock 专项 spike。

## v4-v7 补记（S5b/S5c 专项 spike 后）
- v4：takeover CAS 与 snapshot 预检解除；resolution 生命周期/扫描/接口仍阻断。
- v5：accept-current 双接口解除；supersedes 全局归约、conflicts 清理、validation 证据等仍阻断。
- v6：分组归约框架、三阶段清理、validation evidence 加入；authoritative head、
  普通 acquire 互斥、target durable 原语、validation gate 仍阻断。
- v7：authoritative head 不再排除终态、acquire 排他、chmod/fsync 顺序修复；
  仍剩 supersede 两步崩溃、祖先清理悬空引用、普通恢复/提交成功路径回退、
  lease CAS/fencing、validation 来源不可伪造性、测试矩阵自包含等问题。
- 当前结论：**JOURNAL-SPEC.md v7 仍不冻结**；建议作为 M2a 工作草案进入实现，
  以 v7 测试矩阵 + codex 阻断项为 M2a contract freeze gate。
