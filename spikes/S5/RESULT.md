# S5 journal crash-point 原型

实现：beforeHash + per-write intent{phase, expectedHash, nextHash} 先落盘 fsync，
再原子替换目标文件，再 confirm intent；COMMITTED marker 独立；恢复按
intent phase + 当前文件 hash 判定。

矩阵：
- crash after-write（intent=intended, value=V1）：恢复=确认 own write 后回滚，value=V0。
- crash after-confirm（intent=confirmed, value=V1）：恢复=回滚 own write，value=V0。
- crash after-committed（marker 存在）：恢复=不滚，value=V1（COMMITTED_OK）。
- intended 状态下外部把 value 改成 X1：恢复=CONFLICT，不覆盖，value=X1。

结论：per-write intent 协议能区分“未写/已写未确认/已确认/外部冲突”，
可作为 M2a 实现契约。生产版还需 fsync 目录、多文件事务、absent 文件语义与
journal schema 版本。
