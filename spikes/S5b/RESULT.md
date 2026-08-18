# S5b 独立 RESOLUTION journal 原型

设计：resolution 不复用普通 tx 的 op 链，写独立 `resolutions/<rid>/`：
- manifest（immutable plan：每 target expected=计划时 current，next=tx baseline）
- 每 target op 文件 + confirmed marker
- OUTCOME.json（RESOLVED / RESOLUTION_CONFLICTED）

实测场景：
- after-first：第一个 target 完成后崩溃 → 恢复继续第二个 → RESOLVED。
- after-outcome：OUTCOME=RESOLVED 已写、tombstone 前崩溃 → 恢复按 OUTCOME
  继续清理，不重跑恢复。
- mid-resolve：写文件后、confirmed 前崩溃 → 恢复识别 current==next 补
  confirmed，继续 → RESOLVED。
- 计划后外部再改 package.json：package=CONFLICT，pnpm=DONE；整体
  RESOLUTION_CONFLICTED，部分进度持久且如实报告。

结论：独立 resolution journal + immutable plan + 每 target confirmed marker
可以形成确定续跑协议；spec v4 采用该结构。
