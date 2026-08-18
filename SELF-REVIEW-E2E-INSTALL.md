# 真实 E2E 安装自审

## 完成
1. fixture dsh-market 更新为真实 npm 元数据（integrity/tarball/entryIds）。
2. 修复 HttpArtifactInspector 流式落盘未等待 finish。
3. 新增 Journal.adoptExternal：包管理器直接修改 profile 文件后，事务可采纳
   外部变更并提交。
4. 修复 DshActivationPort 对默认 `[]` 模板的处理（去掉模板行/恢复模板行）。
5. scripts/dsh-e2e-install.mjs 完整流程通过：
   - install mutation 200 + pendingActivation
   - patch pre-disable 行存在
   - dump-config 显示 disabled
   - activate 200
   - patch disable 行移除
   - dump-config 不再 disabled
   - **重启 DSH 后 dsh-market 宿主路由 `/dsh-market/registry` 返回 200**
6. 测试：146 pass。

## 修复
- install-core 从 writePresent 切换到 adoptExternal（真实包管理器会先改文件）。
- patch 模板 `[]` 在 preDisable/activate 正确处理。
