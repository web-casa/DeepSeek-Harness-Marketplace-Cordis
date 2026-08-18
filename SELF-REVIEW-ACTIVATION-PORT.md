# DshActivationPort 自审

## 完成
- packages/dsh-runner/src/activation.mjs：cordis.patch.yml 行级读写。
  - preDisable：追加/翻转 `- id + disabled: true`
  - activate/cancelDisable：删除 owned disable 行
  - readState：disables/forced/inserts
- apps/web host 已把 DshActivationPort 传入 InstallService。
- 测试：workspace 133 pass。

## 自审发现
- prepareDisable 目前只返回 `artifact.entryIds`；真实 entryIds 必须由
  QUARANTINE/INSPECT（或 catalog 扩展字段）提供，否则 pre-disable 是空操作。
- patch 写入未走 journal-core 事务；后续将 activation 写入纳入
  PENDING_ACTIVATION journal。
- activate 删除 disable 行时保留其他配置行；不支持行内复杂覆盖。

## 边界
- 需在 catalog 契约中加入 `entryIds` 或在 install 前解析 tarball 的
  cordis.patch.yml。
