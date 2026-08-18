# M2b 剩余三项方案

## R1 INSPECT：安装前解析 entryIds
- 新增 `packages/inspect-core`：
  - `inspectTarball(file)`：流式读 npm tarball，提取唯一 `package/package.json`
    与 `package/cordis.patch.yml`；解析 insert 行的 `id`。
  - `inspectDir(dir)`：已解包目录同样解析。
  - 输出 `{packageName, version, entryIds, dshPlatforms, hasBundlePatch, hasClient}`。
- install-core 接口变更：
  - PackageManagerPort 增加 `stageArtifact(artifact) -> {stagedPath, entryIds, manifest}`；
    或 InstallService 接受 `inspect` 端口，在 `prepareDisable` 前调用。
- 采用方案：InstallService 接受可选 `inspect` 端口；
  `install()` 在 fresh 复核后执行 `inspect.artifact(artifact)`，
  结果传入 `activation.prepareDisable`。
- 测试：构造 tarball fixture（含 cordis.patch.yml）验证 entryIds 提取与坏包拒绝。

## R2 PENDING_ACTIVATION 持久化
- 复用 journal-core 的普通事务，不新造状态机：
  - `InstallService` 在 install commit 后创建 `activation` 事务：
    `journal.begin(['.cordis-mp/pending-activation.json'])（需先扩展 journal-core target allowlist）`；
    写 pending 记录；commit。
  - `activate()` 用新事务：pending 文件内容删除/清空 + activation.activate；
    成功后 commit。
  - 崩溃恢复：pending 文件存在时，`InstallService.recoverPending()` 读取并
    重新建立内存 Map；只允许对已 VERIFY 成功的 artifact 重建 pending。
  - pending 内容：`{v:1, slug, packageName, version, integrity, entryIds,
    entryRevision, txid, createdAt}`。
- 测试：写 pending 后新建 InstallService 实例恢复；activate 后 pending 清空。

## R3 真实 DSH smoke
- 脚本 `scripts/dsh-smoke.mjs`：
  1. 临时 DSH_HOME；
  2. `dsh plugin --profile web add file:<apps/web tarball>`（npm pack）；
  3. 启动 `dsh web --port 0`；
  4. 轮询端口；
  5. `POST /cordis-mp/session`（带 Origin）拿 token；
  6. `GET /cordis-mp/catalog`（fixture 模式 `CORDIS_RUN_API` 指向本地 fixture）；
  7. `GET /cordis-mp/health`、`/cordis-mp/status`；
  8. 输出 PASS/FAIL。
- 不执行 install mutation（避免真实 profile 污染）。
- 验收：所有 GET 路由 200，session 返回 token，日志无异常。

## 顺序
R1 → R2 → R3（R3 依赖 R1/R2 集成）。
## 风险
- R1 引入 `tar` 包；安装阶段只解析 package/package.json 与 cordis.patch.yml。
- R3 只验收 host 路由；client bundle 构建不在 smoke 范围。
- DSH smoke 依赖本机 dsh/rc.6/rc.7 与网络；失败时保留日志。
