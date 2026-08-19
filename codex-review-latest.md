结论：M2b 目前不能宣称完成；现有改动只证明了单插件成功路径。

## 阻断项

1. 重启恢复未接入生产路径。安装提交与 pending 写入分属两个事务，存在崩溃窗口：[install-service.mjs:60](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/src/install-service.mjs:60)、[install-service.mjs:69](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/src/install-service.mjs:69)。生产启动仅创建服务并挂载路由，未调用 `journal.recover()` 或 `recoverPending()`：[index.js:4835](/home/ivmm/daohang/toolso-ai-open/cordis-mp/apps/web/dist/index.js:4835)。单测则手动恢复：[install-service.test.mjs:133](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/test/install-service.test.mjs:133)。因此安装后、激活前重启会得到 `NO_PENDING_ACTIVATION`。

2. `preDisable` 位于事务和 `try` 之外：[install-service.mjs:49](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/src/install-service.mjs:49)。若 `journal.begin()` 失败或进程崩溃，禁用状态不会撤销，且事务基线已经是禁用后的文件。另一方面，失败清理会对全部 entryId 调用 `activate`：[activation.mjs:85](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/dsh-runner/src/activation.mjs:85)，可能删除用户原本已有的 `disabled: true`，导致失败安装反而启用插件。

3. `adoptExternal` 破坏了 journal 的归属与崩溃语义。调用方丢弃 `profileFiles` 的内容，只传文件名：[install-service.mjs:55](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/src/install-service.mjs:55)；journal 随后把磁盘当前内容直接认领：[journal.mjs:114](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/journal-core/src/journal.mjs:114)。并发修改会被误认领；包管理器部分写入后失败或在 adopt 前崩溃，则没有操作日志可供可靠回滚。

4. catalog entryIds 兜底实际上失效：[install-service.mjs:40](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/install-core/src/install-service.mjs:40)。空数组 `[]` 为 truthy，inspection 返回空数组时不会使用 `fresh.entryIds`，插件可能绕过预禁用。

## 重要问题

- inspector 的流错误路径仍不安全：[http-inspector.mjs:26](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/inspect-core/src/http-inspector.mjs:26)。读取超限或异常时会跳过 `out.end()`；错误监听安装过晚，也未取消响应流或删除半成品，可能泄漏文件描述符、缓存文件，甚至触发未处理的 stream error。

- 恢复 `[]` 会覆盖首行注释：[activation.mjs:79](/home/ivmm/daohang/toolso-ai-open/cordis-mp/packages/dsh-runner/src/activation.mjs:79)。例如 `# comment\n[]` 经禁用再激活后，注释会丢失。

- E2E 证据不足：构建进程退出码未检查：[dsh-e2e-install.mjs:12](/home/ivmm/daohang/toolso-ai-open/cordis-mp/scripts/dsh-e2e-install.mjs:12)；第二次 `dump-config` 失败也可能误判通过：[dsh-e2e-install.mjs:64](/home/ivmm/daohang/toolso-ai-open/cordis-mp/scripts/dsh-e2e-install.mjs:64)。此外它只在激活完成后重启，没有覆盖最关键的 pending 恢复路径。

## 建议优化

- 将 pre-disable、安装文件和 pending 状态纳入同一可恢复状态机，并在挂载 mutation 路由前完成 journal/pending 恢复。
- 增加崩溃窗口、部分写入失败、已有禁用项、空 inspection entryIds、stream 写盘失败及带注释 `[]` 的测试。
- E2E 使用 `try/finally` 清理子进程，并检查所有 `spawnSync` 状态。

本次严格未运行测试或构建；仅静态审查，`git diff --check` 无异常。文档中的“146 pass”未独立验证。