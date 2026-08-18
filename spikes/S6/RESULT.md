# S6 Desktop-shaped adapter contract

实现：install-core 原型只依赖 EffectPorts（journal/packageManager/verify/
activation），不 import DSH/Tauri/CLI。
- Web adapter：进程内内存实现，contract 通过。
- Desktop-shaped adapter：每个操作 spawn 独立 sidecar 进程 + JSON DTO + 持久化
  state 文件，contract 通过；取消路径通过 AbortSignal 返回 ROLLED_BACK。
- 结论：EffectPorts 形状可被非 Web 运行时实现；接口需要正式 TypeScript 化并
  加上 inspectArtifact、PENDING_ACTIVATION 与 journal 恢复矩阵后再冻结。
