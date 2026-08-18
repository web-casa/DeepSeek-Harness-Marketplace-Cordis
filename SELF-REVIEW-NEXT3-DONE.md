# 下一步三步完成自审

## S1 catalog entryIds ✅
- schema 归一化新增 entryIds；fixture 更新；install-core 用 fresh.entryIds 兜底。

## S2 HttpArtifactInspector ✅
- inspect-core 新增 http-inspector：下载 tarball → 大小限制 → 落盘 stagedPath →
  inspectTarball；apps/web host 已接 inspect 端口。

## S3 真实 DSH smoke ✅
- apps/web scripts/build.mjs：esbuild 分别打包 host 与 client（react 外置），
  拷贝 snapshot 到 dist/data。
- scripts/pack-smoke.mjs：生成去 workspace 依赖的独立 tarball。
- scripts/dsh-smoke.mjs：真实执行 dsh plugin add + dsh web + 6 项 HTTP 验收。
  结果全 PASS：
  health / catalog / detail / session-no-origin 403 / session-token /
  install-no-token 403。

## 测试
- 全 workspace 141 tests / 141 pass。
- 真实 DSH smoke PASS。

## 修复
- apps/web loadSnapshot 路径错误 → build 时拷贝 snapshot。
- HttpArtifactInspector fake fetch ArrayBuffer 测试错误 → Uint8Array.from().buffer。
- inspect-core tar 版本声明与 registry 不一致 → 改 ^7.5.15 并重新安装。
- host 测试需要 CORDIS_MP_PROFILE_DIR 临时目录，避免写真实 ~/.dsh。
