# catalog-core 自审

## 完成
- packages/catalog-core：CatalogClient / CatalogError / schema 归一化。
- 功能：list/detail/fetchFresh、ETag/304、stale-cache、snapshot fallback、
  installability 决策、错误 body 解析、legacy 平铺与 page:u32 兼容。
- 集成测试启动真实 fixtures/S1 server，验证 list/detail/404。
- 测试：6/6 pass。

## 自审发现并修复
1. installability 的 integrity regex 只接受 sha256，未接受契约的 sha512 → 修复。
2. 304 cache 返回时 spread 顺序把 source 覆盖成 network → 修复。
3. detail 响应被当作 catalog 校验 schemaVersion → #request 增加 catalog 开关。
4. catalog 响应归一化结果未写回 entry.data，page 对象丢失 → 修复。
5. fixture 集成测试路径层级错误与 child 泄漏导致 hang → 修复路径并在 finally kill。

## 后续
- Web harness 层接入：CatalogClient + snapshot 文件 + 本地 /cordis-mp/catalog 路由。
