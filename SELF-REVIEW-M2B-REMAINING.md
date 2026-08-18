# M2b 剩余三项自审

## R1 INSPECT ✅
- packages/inspect-core：inspectDir / inspectTarball / parsePatchIds；
  tar 流式解析 package/package.json 与 cordis.patch.yml，entry 数量/大小/路径校验。
- install-core 支持 inspect 端口，entryIds 在 prepareDisable 前注入 artifact。

## R2 PENDING_ACTIVATION 持久化 ✅
- journal-core allowlist 扩展 `.cordis-mp/pending-activation.json`。
- InstallService 安装成功后通过 journal 事务持久化 pending；activate 后写 `{}`
  并清空；recoverPending() 可跨进程恢复。
- 修复 `#pendingFile` 误用 async 导致 existsSync 收到 Promise 的 bug。

## R3 DSH smoke ⚠️ 部分
- R3a host HTTP smoke 通过：health/status/catalog/detail/session/403 全 PASS。
- 真实 `dsh plugin add` smoke 受 workspace 依赖打包阻断（pack 后依赖为
  0.1.0 registry spec）；下一步需要 esbuild/tsup 打包或 pnpm deploy+inject。
