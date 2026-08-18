# cordis-mp 插件市场（Web Harness）方案 v4（恢复版）

> 环境重置导致 /tmp 丢失后重建；保留 v4 全部决策要点。完整评审历史见 REVIEWS.md。
> 目标项目目录：/home/ivmm/seo-website-v3/cordis-mp（当前只读，暂存本目录）。

## 核心决策
- 形态：DSH Web 插件，设置页市场 section；后端 cordis.run；安装走官方 `dsh plugin`。
- v1 在线一键安装只支持 **npm source**（精确 version + SRI integrity）；
  GitHub-only 条目只浏览 + 显示命令行 + 允许 `.tgz` 侧载。
- 平台声明：目录 `platforms`（web/desktop/unknown）为安装决策唯一来源；
  `unknown` 只浏览；包装机声明与目录冲突 → 回滚。
- 安全：目录白名单 + anti-CSRF mutation token（POST /session，loopback + Origin/Host 校验）
  + 构建脚本默认拒绝（绑定 name@version+integrity 一次性授权）。
- 安装链路：QUARANTINE 下载验证 → INSPECT（与侧载共用 hardened tar 检查）→
  PRE_DISABLE（把 entry ids 写入用户补丁层 disabled）→ INSTALL（--ignore-scripts）→
  VERIFY（fetchFresh + lockfile/manifest 复核）→ FILE_COMMITTED → 用户显式启用。
- 事务：durable journal（PREPARING/PREPARED/MUTATING/FILE_COMMITTED/CLEANED/
  ROLLING_BACK/ROLLED_BACK/DIRTY）；beforeHash/lastOwnedHash/optimistic check；
  取消独立通道；repair CLI 三态（RECOVERABLE/CONFLICTED/UNRECOVERABLE）。
- 复用：packages/catalog-core + packages/install-core（EffectPorts）；apps/web；
  未来 apps/desktop 只替换 adapter。
- 里程碑：M0 spike 与决策 → M1a 只读 UI / M1b 契约 → M2a journal → M2b 在线安装 →
  M3 更新卸载启停 → M4 侧载 → M5 发布。
- 工期：单人 9–13 周（乐观下限），cordis.run 后端等待另计。

## M0 go/no-go 硬门
1. cordis.run v4 schema fixture（tarball/integrity/entryRevision）可达。
2. DSH rc.6/rc.7：`dsh plugin add --ignore-scripts`、字节连续性路径 A/B、
   PRE_DISABLE 与 loader/HMR 竞争结论。
3. Chrome/Firefox/Safari：POST /session Origin/Sec-Fetch 行为。
4. IPv4/IPv6/0.0.0.0/反向代理请求矩阵。
5. journal crash-point：COMMITTED 不误回滚、外部编辑可识别。
6. desktop-shaped adapter 编译并跑 contract tests。
7. 决策：安装路径 A/B、激活方式、repair CLI 是否随包发布。
