# M0 执行结果与决策记录（2026-08-18）

工作区：`/home/ivmm/daohang/toolso-ai-open/cordis-mp`（/home/ivmm 目标目录当前只读）。
所有实验使用临时 DSH_HOME，未触碰真实 profile。

## 决策（D1-D7）

- **D1 API schema**：按 PLAN v4 §4 实现 fixture + parser 验证通过。需要
  cordis.run 后端提供真实 fixture 才能关闭该硬门。
- **D2 安装路径**：选 **路径 B**——`packageName@exactVersion --ignore-scripts`。
  证据：pnpm fetch 阶段校验 SRI（篡改 tarball 被 ERR_PNPM_TARBALL_INTEGRITY
  拒绝）；成功后 lockfile integrity == 目录 integrity。rc.6 与 rc.7 均验证。
  QUARANTINE/INSPECT 仍保留（用于 PRE_DISABLE entry ids 和 manifest 检查）。
  路径 A（本地 file: tarball）可行但 spec 写成绝对 file: 路径，仅隔离场景使用。
- **D3 激活模式**：v1 一律 **RESTART_REQUIRED**。证据：PRE_DISABLE 在 boot
  生效；`dsh plugin add` 不重写用户 patch；但运行态修改 patch 40s 未观察到
  HMR dispose。热生效作为 P1，需先查 HMR watcher 未触发原因。
- **D4 session token**：POST /session + Origin/Host + loopback +
  Sec-Fetch-Site 设计在 curl 矩阵与 Chromium 实测有效。Firefox/Safari
  矩阵为外置 CI 任务；反向代理信任边界已文档化。
- **D5 journal**：per-write intent（expectedHash/nextOwnedHash/phase）协议
  原型通过 4 个 crash/conflict 场景。生产 journal spec 以 S5 为输入，在
  M2a 实现；完整 kill 矩阵放 M2a。
- **D6 复用接口**：install-core 原型 + Web adapter + Desktop-shaped
  sidecar adapter 均通过同一 contract tests。正式接口需 TypeScript 化，
  并加入 inspectArtifact 与 PENDING_ACTIVATION 后才冻结。
- **D7 repair CLI**：决定随包发布独立 `cordis-mp repair`；三态
  RECOVERABLE/CONFLICTED/UNRECOVERABLE。恢复矩阵由 M2a 按 S5 协议补齐。

## M0 硬门状态

| # | 硬门 | 状态 |
|---|---|---|
| 1 | cordis.run 真实 v4 fixture | ⛔ 待后端（本环境用本地 fixture 替代验证） |
| 2 | rc.6/rc.7 CLI + 字节连续性 + PRE_DISABLE | ✅ 本环境关闭（激活时序结论=D3） |
| 3 | 三浏览器 Origin/Sec-Fetch | 🟡 Chromium + curl 关闭；Firefox/Safari 待 CI |
| 4 | IPv4/IPv6/0.0.0.0/反代矩阵 | 🟡 IPv4 关闭；IPv6/0.0.0.0 反代待 CI |
| 5 | journal crash-point | ✅ 协议原型关闭；生产完整矩阵放 M2a |
| 6 | desktop-shaped adapter | ✅ 本环境关闭 |
| 7 | 路径/激活/repair 决策 | ✅ D2/D3/D7 |

## 可以立即开工
- M1a：monorepo 骨架 + catalog-core（fixture 驱动）+ 只读设置页 UI。
- M2a 前置工作：把 S5 journal 协议写成正式 spec（状态 × 文件证据 × 操作矩阵）。

## 仍然阻塞
- M2b 在线安装依赖 cordis.run 真实 API fixture（D1 硬门）。
- Firefox/Safari 与 IPv6/LAN 矩阵需 CI 环境补齐，阻塞“M0 完全关闭”声明。

## 需要产品确认
- GitHub-only 插件 v1 只浏览 + 命令行提示 + .tgz 侧载，不做一键安装。
