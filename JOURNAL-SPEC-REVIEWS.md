# Journal spec codex 评审记录

- v1 → 6 阻断：多次写 reducer、ABSENT/删除、marker 顺序、repair 终态、
  JournalPort 职责、保证边界。见 codex-review-journal-spec-v1.md。
- v2 → 6 阻断未全解：A→B→C 误判、restore 不可用/部分成功、fencing TOCTOU、
  OUTCOME/tombstone 缺口。见 codex-review-journal-spec-v2.md。
- v3 → 不能冻结：普通 reducer 基本解除；RESOLUTION 事务、扫描优先级、
  死锁接管竞争、自动回滚 snapshot 预检仍阻断。见 codex-review-journal-spec-v3.md。
- 当前状态：JOURNAL-SPEC.md v3 不冻结；M2a 开工前需出 v4 或先做
  resolution/lock 专项 spike。
