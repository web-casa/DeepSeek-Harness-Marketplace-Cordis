# S2 dsh CLI 行为（真实实验）

- 环境：dsh 0.1.0-rc.6 / node v24.18.0 / pnpm 11.10.0；DSH_HOME 指向临时目录。
- T2A `dsh plugin --profile web add file:<tarball>`：成功；profile deps spec 被写成
  绝对 file: 路径；lockfile 记录本地 tarball 的 SRI integrity；bundles 正确加入 spike-safe。
- T2B 带 preinstall 脚本的包不加 --ignore-scripts：pnpm 11 **默认拦截构建脚本**并返回
  ERR_PNPM_IGNORED_BUILDS；package.json 残留 dep + node_modules 已写入，但未 reconcile
  进 bundles。→ 失败残留必须清理。
- T2C 加 --ignore-scripts：成功，无脚本执行标记。
- T2D 篡改 registry tarball（metadata integrity 指向好包）：pnpm 报
  ERR_PNPM_TARBALL_INTEGRITY 并拒绝安装，node_modules 不存在。→ 证明 pnpm fetch 阶段
  执行 SRI 校验。
- T2E 正常 registry 安装：成功，lockfile resolution integrity 与目录 SRI 完全一致。
- 决策：**在线 npm 安装选路径 B**（packageName@exactVersion + --ignore-scripts），
  前置 QUARANTINE/INSPECT 用于 PRE_DISABLE 与 manifest 检查；post-install 复核
  lockfile integrity == catalog integrity。路径 A（本地 file: tarball）只在需要
  隔离安装时用，并接受 file: spec 或后续规范化。
