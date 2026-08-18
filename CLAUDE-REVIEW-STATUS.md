# Claude Code review 状态

- 尝试使用 Claude Code 进行 review：`claude auth status` 显示未登录。
- 从历史环境提取到的 ANTHROPIC_API_KEY 已失效（HTTP 401 invalid API key）。
- 因此 Claude Code review 未能执行。已按原定 review 标准做人工复审并修复，
  记录见 SELF-REVIEW-CLAUDE-FALLBACK.md。

## 人工复审发现并修复
1. `deleteTarget` 对 absent→absent 会先写 INTENDED 再在 unlink 时 ENOENT，
   留下 pending op；现在删除前直接 `BAD_TARGET_STATE` 拒绝。
2. lock heartbeat 只写 heartbeat.json，owner.json 的 heartbeatAt 不更新；
   现在两者同时更新，保持 owner 记录语义。
3. `begin()` 的 active tx 检查忽略 manifest 损坏的 tx；现在任何未提交且未
   ROLLED_BACK 的 tx（含 manifest invalid）都会阻止新事务。

## 测试
- 72 tests / 72 pass。
