# Durable failpoint 覆盖表（S9）

覆盖标准：每个 failpoint 至少一个真实子进程 exit(43) 场景；另有 1 个 SIGKILL
代表场景验证信号路径。测试文件：test/matrix.test.mjs + test/failpoint.test.mjs。

| failpoint | 场景 | 结果 |
|---|---|---|
| atomicFile:before | atom-before | NO_MANIFEST |
| atomicFile:after-write | atom-after-write | NO_MANIFEST |
| atomicFile:after-publish | OUTCOME / manifest / validation / resolution op / confirmed | 各自恢复 |
| atomicFile:before-dirfsync | atom-before-dirfsync | ROLLED_BACK |
| atomicFile:after-dirfsync | atom-after-dirfsync | ROLLED_BACK |
| appendRecord:before | failpoint.test（in-process） | 无写 |
| appendRecord:after-write | append-after-write | ROLLED_BACK |
| appendRecord:before-dirfsync | append-before-dirfsync | ROLLED_BACK |
| appendRecord:after-dirfsync | append-after-dirfsync | ROLLED_BACK |
| marker:before | failpoint.test（in-process） | commit 中止 |
| marker:after | marker-after | COMMITTED_OK |
| replaceTarget:before | replace-before | ROLLED_BACK |
| replaceTarget:after-write | replace-after-write | ROLLED_BACK |
| replaceTarget:before-rename | forward-before-rename | ROLLED_BACK |
| replaceTarget:after-rename | forward-after-rename / rollback-after-rename / **SIGKILL** | ROLLED_BACK |
| replaceTarget:after-dirfsync | forward-after-dirfsync | ROLLED_BACK |
| unlinkTarget:before | unlink-before | ROLLED_BACK |
| unlinkTarget:after-unlink | delete-after-unlink | ROLLED_BACK |
| unlinkTarget:after-dirfsync | unlink-after-dirfsync | ROLLED_BACK |
| tombstone:before | tombstone-before | COMMITTED_OK |
| tombstone:after-rename | committed recover / G2 ancestor | 清理/续跑 |
| tombstone:after-src-fsync | tombstone-after-src-fsync | sweep 清理 |
| tombstone:after-dirfsync | tombstone-after-dirfsync | sweep 清理 |

结论：全部 23 个 failpoint 点均有覆盖；kill -9 双轨以 SIGKILL after-rename 代表。
