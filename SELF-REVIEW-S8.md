# S8 自审报告

## 本轮完成
1. **G5 收口**：`ResolutionJournal` 持有 `baselineValidator`，新增
   `validateAndRecord(rid)` 内部调用 validator、内部生成 ValidationEvidence。
   外部不再能传入自构造的 evidence；无 validator / 校验失败返回
   `NO_VALIDATOR` / `BAD_VALIDATION`。
2. **G7 收口**：schema.mjs 新增 `makeRecoveryReport` / `validateRecoveryReport`
   / `makeResolutionOutcome` / `validateResolutionOutcome`；Journal 与
   ResolutionJournal 增加 `recoverReport()`，resolution outcome 写入全部走
   版本化构造函数。
3. **G6/G10 矩阵扩展到 17 个真实子进程崩溃场景**：新增
   unlink-after-dirfsync、manifest-after-publish、validation-after-publish、
   resolution confirmed marker after-publish。
4. 全量测试：**77 tests / 77 pass**。

## 自审发现并修复
- 无新增回归；更新 accept-current 测试注入 fake validator，删除外部
  evidence 构造路径。

## 仍开放
- durable primitive 的所有 failpoint 点仍未逐一穷举（但关键崩溃窗口已覆盖）。
- Windows BEST_EFFORT 未在 Windows CI 实证。
- lock `ownerAlive` 在非 Linux 平台仍退回 pid 判断（已文档化）。
