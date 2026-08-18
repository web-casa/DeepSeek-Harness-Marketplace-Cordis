# 外部 review 修复自审

## 修复清单
- P1 preDisable 正则未转义：改为逐行字面捕获比对；新增 `a.b` vs `aXb` 回归测试。
- P2 catalog integrity：HttpArtifactInspector 流式/缓冲下载后计算 sha512 与
  artifact.integrity 严格比对，不一致抛 INTEGRITY_MISMATCH；新增 mismatch 测试。
- P2 activation 原子写：DshActivationPort.#save 改为 tmp+fsync+rename+dirfsync。
- P2 TRACKED_FILES 不对称：DshPackageManagerPort 回读 4 个 profile 文件；
  Journal.commitFiles 允许 tracked-but-unchanged no-op target；新增 no-op 提交测试。
- P3 inspect entry data throw 打挂进程：改为 fail 变量延迟抛出。
- P3 HttpArtifactInspector 全量 buffer：支持 ReadableStream 分块写入 + 边下边限流。
- P3 403 无限重试：client api mutation 最多重试一次。
- P3 token TTL 虚假：MutationGuard 真实 15min TTL，session 返回 expiresAt。
- P3 pending 单槽位：持久化为 `{v:1,items:[...]}`，多 pending 可恢复。
- 新增 createRuntime 导出，host wiring 集成断言（journal/activation/inspect/pendingPath 真实参数）。

## 测试
- 全 workspace 145 tests / 145 pass。
- 真实 DSH smoke 6 项全 PASS。

## 未修/记录
- verifyInstalled 仍只比 name/version；lockfile integrity 复核待下一步。
- 市场 UI 分页/installability 提示仍缺（MVP 记录）。
