# 给下一模型 / 开发者的交接提示词

请继续开发 cordis-mp 项目。仓库：/home/ivmm/daohang/toolso-ai-open/cordis-mp。
先读 DEV-OVERVIEW.md、docs/cordis-run-api-contract.md、JOURNAL-SPEC.md 与
M2A-FREEZE-REPORT.md，再读 packages/ 与 apps/web 源码。项目已实现 DSH Web
插件市场核心：catalog-core、journal-core、install-core、web-harness、
dsh-runner、inspect-core，以及 apps/web 的设置页市场基础 UI；当前 146 个
测试通过，真实 DSH E2E（从 fixture catalog 安装 npm 插件 → pre-disable →
activate → 重启后插件生效）已通过。请先运行 pnpm -r test 和
node scripts/dsh-e2e-install.mjs 确认基线。接着按优先级完成：
1) 推动 cordis.run 生产 API 按契约上线，并将 E2E 切换到真实 API；
2) 指导桌面端迁移到嵌套 source、{zh,en} description、count+page 分页；
3) 完善 Web UI：详情弹窗、截图、分页、错误详情、平台徽章；
4) 补齐 verifyInstalled 的 lockfile integrity 复核；
5) 接入 CI：测试、build、smoke、e2e；
6) 准备发布：版本、npm pack、release 文档。约束：不要破坏 POSIX FULL 的
journal 10/10 gate 和现有安全模型；所有 mutation 必须经过 guard；安装必须
inspect integrity → pre-disable → install → verify → pending → 用户显式
activate；不要声称完成未验证的生产功能。每完成一项请补充测试、更新
DEV-OVERVIEW.md，并自审后提交。
