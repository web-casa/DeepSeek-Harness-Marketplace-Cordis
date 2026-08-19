# codex review 修复自审

## codex 结论
M2b 不能宣称完成；4 个阻断项，已全部修复。

## 修复
1. 生产启动未恢复 journal/pending：apps/web host effect 中先
   journal.recover() 再 installService.recoverPending() 后挂路由；host 测试
   改为等待 async effect。
2. preDisable 位于事务外且 cancel 会删用户已有 disable：
   - preDisable 移入 journal.begin 之后的 try；
   - DshActivationPort 记录 owned disables，cancelDisable 使用 ownedOnly；
   - pending 持久化 ownedDisables；activate 使用 ownedSet 过滤，避免删用户
     原有禁用行。
3. adoptExternal 信任磁盘当前内容：新增 expectedBytes 参数，InstallService
   传入 PM 返回的 profileFiles 字节，hash 不符抛 CONFLICT。
4. catalog entryIds 空数组 truthy bug：空数组不再覆盖 fresh.entryIds。
5. inspector 流错误路径：reader.cancel/out.destroy/删除半成品/流错误捕获。
6. `[]` 恢复覆盖首行注释：改为在注释后插入 `[]`，保留注释。
7. E2E 脚本检查 build/dump spawn 状态。

## 验证
- 全 workspace 146 tests / 146 pass。
- 真实 E2E install/activate/restart PASS；重启后 dsh-market 路由 200；
  patch 注释保留、禁用行正确移除。
