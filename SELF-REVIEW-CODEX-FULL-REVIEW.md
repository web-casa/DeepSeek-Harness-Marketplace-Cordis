# Codex 全项目复审与修复

日期：2026-08-20
范围：`cordis-mp` 的受版本控制 packages、`apps/web`、脚本、CI 与发布边界。未修改
`journal-core` 的 POSIX FULL 语义或实现。

> Publication update: this review's `@webcasa/web@0.1.1` candidate output is historical evidence
> from before the owner changed the intended public identity. The replacement
> `@webcasa/deepseek-harness-marketplace@0.1.1` is now public with `latest`, has passed exact
> registry preflight, and completed the guarded one-host production cutover under the retained
> `webcasa-web` slug. The production catalog has exactly one market-host source; the remaining
> acceptance work is an independent public plugin's positive lifecycle E2E.

## 已修复的结论

1. **目录不能用陈旧数据授权 mutation。** 安装与 Activate 都要求 fresh detail、非空且匹配的
   `entryRevision`；网络失败、snapshot/stale cache 和异常 fresh `304` 都会拒绝。旧平铺 DTO
   仍可用于浏览兼容，但不再构造可安装 source；嵌套 v4 source 缺少显式 approved registry、
   tarball、integrity、engine 或目标平台同样拒绝。
2. **工件检查与 pre-disable 绑定到实际 bundle。** registry 下载走受大小限制的流式 SHA-512
   校验；任意下载、integrity 或 tar 检查失败都会删除 staged artifact。检查器读取
   package manifest 实际声明的安全相对 `dsh.bundle.patch`，拒绝路径穿越、重复目标、异常 tar
   路径和超限 entry。只有该工件解析出的 entry ids 可影响用户 patch 层。
3. **pending 状态是同一安装事务的一部分。** `pending-activation.json` 在 install journal
   transaction 内写入；恢复时 schema 损坏或重复 slug 会 fail-closed，Web startup 不挂载路由。
   Activate 会再次 fresh recheck、校验 exact source、执行 lockfile proof 后才解除自有 disable。
4. **lockfile proof 与 CLI 参数均收紧。** `verifyInstalled` 只接受 exact package record 的
   `resolution.integrity`，不会采信其他 mapping 的同名字段。DSH 将 plugin args 原样交给 pnpm，
   因此 add/remove 在 package 参数前使用 `--`，避免以连字符开头的有效 npm 名称成为 pnpm option。
5. **并发、恢复与 HTTP/UI 路径复核。** runner 覆盖同步 spawn error、预取消和旧 child close
   不能清空新操作的竞态；E2E/smoke 子进程有退出清理。status 会恢复 durable pending，UI 与
   server 使用同一 installability 判定；JSON 请求体、错误映射与 pagination 都有回归测试。

## 验证

- `pnpm -r test`：206/206 通过；其中 journal-core POSIX FULL 96/96。
- `node apps/web/scripts/build.mjs`
- `pnpm run pack:check`
- `pnpm run release:public-check`：`@webcasa/deepseek-harness-marketplace@0.1.1` candidate
  `ready`。
- `node scripts/host-smoke.mjs`
- `node scripts/dsh-smoke.mjs && node scripts/dsh-e2e-install.mjs`：fixture 的
  install → pending → explicit activate → restart 通过。
- `CORDIS_RUN_API=https://cordis.run/api/v1 CORDIS_E2E_SLUG=webcasa-web
  CORDIS_E2E_EXPECT_SELF_REFUSAL=1 node scripts/dsh-e2e-install.mjs`：生产目录返回
  `409 SELF_INSTALL_FORBIDDEN`，并验证没有 pre-disable；拒绝发生在 package mutation 前的
  本地安装门禁也由 install-core 回归测试覆盖。
- `actionlint .github/workflows/ci.yml .github/workflows/publish.yml`、
  `pnpm audit --prod --audit-level=high` 与 `git diff --check` 通过。

## 未越界的结论

- fixture 生命周期 E2E 和生产 self-refusal 都不是独立公开插件的正向生产 DSH/Desktop E2E。
  该验收仍需要一个独立、严格合规且经 owner 确认的公开条目。
- The historical direct-bootstrap candidate was published with interactive 2FA, then passed guarded
  production cutover. No release tag was created, and Trusted Publishing still needs `npm trust github`
  configuration and verification for a later version.
- Windows 仍为 BEST_EFFORT；首个 GitHub Actions Windows green run 前不将其表述为已实证。
