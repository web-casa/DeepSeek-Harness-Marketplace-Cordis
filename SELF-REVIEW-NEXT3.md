# 下一步三步自审（codex 不可用替代）

## 审查发现
1. apps/web host loadSnapshot 路径错误：src/index.js 指向 apps/web/data，
   但 snapshot 在 catalog-core/data。打包时必须 copy。
2. catalog 契约没有 entryIds 字段；inspect 是唯一来源，但 host 未接
   HttpArtifactInspector，导致 pre-disable 空转。
3. DSH 真实 smoke 打包方案：esbuild bundle host（内置 workspace 依赖），
   client 单独 bundle 且 React 外置；package deps 移除 workspace 依赖。
4. pending activation 已持久化，但 activate 后 pending 文件写 {} 通过 journal，
   仍需确认 journal allowlist 已含该文件（已含）。

## 执行顺序
S1 catalog entryIds + fixture 更新 → S2 HttpArtifactInspector + host 接线 →
S3 esbuild bundle + 真实 dsh plugin smoke。
