# S1 API fixture + catalog parser

- fixture-server.mjs 实现 v4 schema 列表/详情 + ETag + 404 错误结构。
- catalog-parser.mjs 原型校验 schemaVersion/catalogRevision/source/integrity/
  registry/tarball host/platforms/blocked/deprecated。
- 实测：dsh-market 条目 => installable true；desktop-only 条目 =>
  reason platform-desktop。
- 结论：v4 schema 可用于实现 catalog-core；需 cordis.run 后端提供真实 fixture。
