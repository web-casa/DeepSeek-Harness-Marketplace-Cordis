# cordis-mp 开发总览（交接文档）

## 项目目标
为 DeepSeek Harness Web 版构建 cordis.run 插件市场 harness，并让未来 Desktop
复用同一契约与核心。

## 仓库位置与结构
- 当前仓库：`/home/ivmm/daohang/toolso-ai-open/cordis-mp`
- monorepo：pnpm workspaces（packages/*, apps/*）
- packages:
  - journal-core：持久化事务 / 恢复 / 锁 / resolution（10/10 gate，POSIX FULL 冻结）
  - catalog-core：cordis.run API 客户端、schema 归一化、snapshot
  - install-core：安装事务 + pending activation
  - web-harness：本地 HTTP 路由 + mutation guard
  - dsh-runner：真实 dsh CLI 适配 + patch 激活端口
  - inspect-core：tarball/entryIds/integrity 检查
- apps/web：DSH 插件壳 + settings 内市场落地页（目录状态、受控安装路径、搜索、详情、分页、安装/显式启用）

## 时间线
1. 调研 dsh-market / dsh-plugin-hub / DSH 机制。
2. M0 spikes S1-S6：fixture、dsh CLI、激活时序、session token、journal
   crash、desktop-shaped adapter。
3. JOURNAL-SPEC v1-v7，codex 多轮评审。
4. M2a journal-core 实现，S5a/S5b/S6-S9 关闭 10/10 gate（POSIX FULL）。
5. 上层开发：catalog-core → web-harness → dsh-runner → install-core →
   apps/web host/client。
6. M2b 安装门禁：inspect → pre-disable → install → verify → pending →
   activate，真实 E2E install/activate/restart 通过。
7. codex review（mulerun）发现的阻断项已修复。
8. 父仓库 cordis.run 后端补齐 v4 API：严格 registry 工件快照、列表/详情 ETag +
   cursor + JSON error、以及校验后同域 preset ZIP 直出；已完成生产 schema、部署和无重定向
   preset 验证，目录数据仍受严格 registry 工件元数据门禁约束。

## 关键决策
- 在线安装只支持 npm source；GitHub-only 只浏览/侧载。
- 目录契约嵌套 `source`，description `{zh,en}`，分页 `count + page` 对象。
- 安全：loopback + Origin/Host + mutation token（anti-CSRF），默认禁止构建脚本。
- profile 文本变更另有 `FileLock`：Web runtime 的 startup recovery、install、uninstall、
  activate 以及 repair CLI 都必须持有同一把 lock；`InstallService` 拒绝缺失或与 Journal
  不同的 lock，`LOCK_BUSY` / fencing 丢失 fail-closed。它与 HTTP mutation guard 职责不同、
  共同防止未授权请求或并发/失租写入。
- 安装后默认 disabled，用户显式 activate。
- journal 文件事务只保证 profile 文本文件一致性。
- Windows 为 BEST_EFFORT，POSIX FULL。

## 当前状态
- **市场宿主公开产品面（待父仓库常规应用部署）**：父仓库已实现 Cordis 专属
  `/marketplace` 落地页、首页介绍区、导航/robots/sitemap、以及自包含的品牌 SVG；公开页只链接
  目录、指南和 npm，不创建 `/cordis-mp/install`、activate 或 uninstall mutation 通道。对应组件测试、
  父仓库 TypeScript、ESLint、unit tests、production build 与 Knip 已通过。Knip 对同步 CLI 的动态导入
  有文件级、已说明的 exports 豁免：它保留 `.env.local` 先于数据库模块初始化的 fail-closed 加载顺序。尚未以生产 HTTP `200` 验收，故不得称
  `https://cordis.run/marketplace` 已上线；部署后应先做一次只读页面/metadata 验收。npm `0.1.1`
  README 的历史“未发布”措辞也只能由下一次经授权的不可变版本发布纠正。
- **2026-08-20 生产收尾（覆盖下方同日但较早的历史 `count=1`、未发布和 E2E 待做记录）**：
  `https://cordis.run/api/v1/plugins?platform=desktop&limit=100` 现直接返回带 ETag 的 JSON，
  `count=2`。其中 `webcasa-web` 仍是唯一市场宿主
  `@webcasa/deepseek-harness-marketplace@0.1.1`；独立条目
  `dsh-plugin-pkgseek@0.1.1` 已公开、经 strict registry-only preflight 与受控
  `dev-assistant` 同步进入生产目录。其生产 detail 的 exact registry artifact 为
  `sha512-CdpaMsTQBGgpRfgDLT1+FV0JWlOTJUGed3JEzYYz5IVMwjjncWQ3qj/lgd6NIvoV9YMBHF9p+7ZAyt09f8Q5uA==`，
  `https://registry.npmjs.org` `.tgz`、双平台和
  `>=0.1.0-rc.7 <0.2.0` engine 均被只读复核。
- **正向生产 DSH E2E 已完成**：用独立 PkgSeek 条目、真实生产 API 和临时 profile
  复验 `inspect integrity → pre-disable → install (--ignore-scripts) → verify → pending →
  pending restart recovery → explicit activate → active restart`。它没有虚构插件 HTTP 路由；
  市场宿主的 self-refusal 仍是独立安全验收，不能替代这项正向证据。
- **正向生产 Desktop E2E 已完成**：Desktop 分支
  [`6279a96`](https://github.com/web-casa/DeepSeek-Harness-Desktop/commit/6279a96)
  新增显式 opt-in 的 `verify:cordis-desktop-e2e`。它通过真实 Tauri bootstrap IPC 驱动刚构建的
  web-distribution 二进制，并在独立临时 `DSH_HOME` 中证明 stale revision 安装/激活精确拒绝、
  lockfile integrity/pending receipt、显式 Activate 及 Harness 重启后 active；这不是 Store UI
  或 Microsoft Store allowlist 验收，后者未被改变。
- PkgSeek 的未来 npm 发布已配置并只读复核 GitHub OIDC Trusted Publisher；已发布的 `0.1.1`
  仍是 direct interactive/2FA 版本，不能追溯声称 provenance。市场宿主的后续 OIDC 发布仍须按其
  自己的 owner/repository 关系单独决定。
- 最新 marketplace CI
  [run 32347079076](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32347079076)
  已通过 Linux test/build/host smoke、真实 fixture DSH lifecycle E2E 与 Windows 原生
  BEST_EFFORT journal/Web build；Windows 仍只声明 BEST_EFFORT。
- 206 tests / 206 pass（2026-08-20 `0.1.1` 候选的最新完整本地门禁；其中
  journal-core 97/97，原 POSIX FULL 96-test gate 保持不变）。
- 真实 DSH E2E PASS：inspect → patch pre-disable → pending 状态跨重启恢复 →
  显式 activate → 再次重启 → dsh-market 路由 200。无本地 HTTP 路由的独立插件也可
  用同一脚本验证配置/DSH 就绪证据；fixture 的路由断言仍保留。
- `verifyInstalled` 已复核 `node_modules` manifest 的 name/version，及
  `pnpm-lock.yaml` 中该精确 artifact 的 `resolution.integrity`；任何缺失、
  不匹配、非普通文件或超限 lockfile 均 fail-closed 并触发既有回滚路径。
- lockfile 证明只读取精确 package record 的 `resolution` mapping；不会把同一 record 内
  `dependencies` 等其他 mapping 中偶然出现的 `integrity` 字段误当成 artifact 证明。
- Desktop 的同一 integrity 复核现也识别 pnpm 9 对带 peer dependency 的
  `name@version(peer@version)` key，但仍要求精确 `name@version` 前缀和受限的
  peer context；不会把相邻版本或任意前缀误判为已审阅 artifact。
- 父仓库 `/home/ivmm/daohang/toolso-ai-open` 已实现并部署 cordis.run v4 后端：只有完整、精确
  npm registry 工件快照才会进入安装目录；列表/详情支持 ETag/304、cursor、JSON 404，
  `quarantined` 条目以 `blocked:true` 保留 kill switch；preset 下载在 SHA-256/大小复核后
  同域 `200 application/zip` 直出，不再 302。后续安全 review 已补上 R2 流式上限、审批状态
  的计数事务复核、异常 JSON/503 回退和分类成员变更 revision；父仓库 357/357 单测、生产构建
  、Docker `next start` 健康探针和临时 PostgreSQL 的真实 Next 契约探针均已通过。
- 生产验收（2026-08-20，source cutover 前的历史记录）：`https://cordis.run/api/presets/code/download` 仍直接返回
  `200 application/zip`（无 `Location`）。`@webcasa/web@0.1.0` 已以 direct interactive/2FA
  bootstrap 公开发布为 `latest`，随后通过父仓库的 strict registry-only preflight，并以
  `dev-assistant` 分类同步到生产目录。对 `https://cordis.run/api/v1` 的只读契约 probe 已验证
  web/desktop 筛选、ETag/304、详情与 JSON 404，严格目录 `count=1`。
- 发布 identity 已更正：DSH patch 和 host 自安装身份现在是
  `@webcasa/deepseek-harness-marketplace@0.1.1`。它已通过 owner-approved direct interactive/2FA
  bootstrap 公开发布为 `latest`；公开 packument 与实际 tarball 的 package name/version、MIT、repository、
  DSH metadata、patch、10-file layout 和 SHA-512 integrity 均已只读复核。父仓库现已实现 guarded
  one-host cutover：新/旧 source 均被保留，普通同步和通用 metadata 写入均会 fail-closed；精确
  replacement pair（含 operator-attested `0.1.1` version/SHA-512/tarball）才会在同一 PostgreSQL
  事务中锁定 old/new source、保留 `webcasa-web` slug 和既有 tool id，并拒绝双宿主。隔离 PostgreSQL
  18 E2E 已验证切换后 `count=1`、旧 source 数量为 0、新 `0.1.1` artifact 写入且旧扫描证据清空。
  该实现已随父仓库 `dd9f42b` 部署至 cordis.run，并于 2026-08-20 完成一次受保护的生产切换。切换前
  线上 `/api/cron/backup-db` 已生成并 `pg_restore --list` 校验私有 custom-format 归档；切换后只读
  数据库核验保持原 `tool_id`/`webcasa-web` slug，`@webcasa/web` 数量为 0，新 identity 数量为 1，
  精确 `0.1.1` registry artifact、双平台、`dev-assistant` 分类与 `clean` 状态均匹配。新 tarball
  的受控扫描已完成（7 files、0 high、3 warn）；三个 warn 分别是预期的 DSH 子进程环境继承、市场默认
  `cordis.run` 端点与仅用于相对 URL 解析的 `http://x`，均已逐行审计，未做伪造的 security transition。
  生产 v4 contract probe 再次通过且严格目录保持 `count=1`；preset `code/download` 直接返回
  `200 application/zip`，没有跟随重定向。
- 生产 DSH 验收的结论必须区分：`0.1.0` 的真实目标试运行完成 inspect → pre-disable → install →
  verify → pending，但因目标正是市场宿主自身，pre-disable 禁用了其 `/cordis-mp/activate` 路由，
  activate 收到 405；这不是可接受的正向 E2E。修复后的 `0.1.1` 本地候选会在任何 inspect/journal/
  pre-disable/package mutation 前拒绝同 npm 包名，并在 inspect 后拒绝任何宣称宿主 `cordis-mp`
  entry id 的外部 bundle；source cutover 后使用真实生产目录复验 self-refusal E2E，仍返回 409 且
  profile 未被禁用。
  新 identity 的 `0.1.1` 已是生产目录中唯一 market-host；完整正向生产 DSH E2E 仍需要一个独立、严格
  合规的公开插件条目，不能以该宿主自身自安装代替。
- 独立候选已完成最小的 strict v4 修复，但尚未公开：owner 的
  `web-casa/dsh-plugin-pkgseek` 本地 commit `19b5bf7` 计划发布
  `dsh-plugin-pkgseek@0.1.1`，只新增 `dsh.platforms: [web, desktop]` 与
  `dsh.engines.dsh: >=0.1.0-rc.7 <0.2.0`。其 26/26 单测、无脚本 pack、父仓库
  strict preflight 模拟，以及隔离 DSH `plugin add → dump-config → web` 启动均已通过；
  未 push、未 npm publish、未写生产目录，因此不能称为公开条目或生产 E2E。
- fixture 已对齐 cursor + `count/page`、`page/per_page` 兼容、ETag/304、JSON
  error、canonical screenshot；`scripts/cordis-run-contract-probe.mjs` 可在
  部署后做无 mutation 的目标验收。DSH E2E 可显式通过 `CORDIS_RUN_API` 切换，
  外部独立插件不需要伪造 HTTP route；可选 `CORDIS_E2E_PLUGIN_ROUTE` 只用于确有
  本地路由的插件。
- Desktop 的 `feat/cordis-v4-desktop` 已在独立源码树复验：嵌套 DTO、`platform=desktop`、cursor、
  ETag/304、JSON 404、严格 pending/explicit activate 与 preset 200 直出适配仍在。新增
  `pnpm verify:cordis-market` 只读生产 smoke 已再次通过直接 JSON、ETag/304、JSON 404，
  并对 `webcasa-web` 的 nested source/integrity/engine wire 完成只读复核；
  `pnpm verify:cordis-preset` 也通过同域 `200 application/zip`；Rust nextest 为 sidecar 35/35、
  Tauri 97/97，覆盖率门槛也已复核。生产目录现在有已同步条目，但尚未执行并记录 Desktop 的
  install → pending → explicit Activate → restart E2E；不得以结构 smoke 代替该 E2E，Microsoft
  Store allowlist 也保持不变。
- Web 市场已提供详情弹窗、仅渲染 `https://cdn.cordis.run` 截图、cursor 历史分页、
  Web/Desktop 平台徽章及可展开的错误诊断（code/HTTP/request ID/retry）。安装和启用
  仍只经既有 guard-backed controller/API；页面不新增 mutation 通道。
- Web 的 `settings.section` 现以“落地页 → 目录”组织：目录卡只显示实际查询到的加载/重试/
  已载入状态与动态 count，六阶段受控安装路径准确对应 inspect → pre-disable → install →
  verify → pending → explicit activate；“浏览目录”只滚动并聚焦搜索框。它没有创建新的 API
  或绕过确认/guard。
- 已接入 `.github/workflows/ci.yml`：两个无凭据 Ubuntu job 分别执行 test/build/host
  smoke 与真实 DSH smoke/E2E；Node 24.18.0、pnpm 11.10.0、DSH 0.1.0-rc.7 和
  Actions 提交均固定。CI 的 DSH integration 只使用临时 profile 与本地 fixture，
  不把生产 API 当作可用依赖。
- Trusted Publishing 的 validate job 现在也会先安装并记录同一固定 DSH CLI，才运行 DSH
  smoke/E2E；静态工作流回归测试锁定该顺序，避免干净 GitHub runner 因缺少 `dsh` 命令而失败。
- `actions/checkout` 与 `actions/setup-node` 已升级并以提交固定至 Node 24-compatible 的 v5，消除
  GitHub Actions 对其 Node 20 runtime 的弃用告警；同一静态回归测试锁住 publish workflow 的两处
  `setup-node` 和 checkout pin。该升级已在
  [CI run 32326135751](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32326135751)
  完成 Ubuntu、DSH lifecycle 和 Windows BEST_EFFORT 三个 job 的复验。
- 父仓库的 PostgreSQL live-server smoke 现 seed 两个严格 registry fixture，以和 Docker 一致的
  `next start` 生产构建启动；v4 列表 cursor、ETag/304、web/desktop 筛选、
  `quarantined` kill switch、详情、JSON 404 与静态 chunk 都是硬门禁。启动未就绪立即失败；既有
  站点 UX smoke 也在显式 IPv4 loopback 上成为 Host/locale/canonical/security 的硬门禁。它同样
  不访问生产 API/R2。
- `windows-best-effort` CI job 已在 Windows 原生 runner 完成首个 green：
  [run 32325664197](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32325664197)
  通过常规文件/目录 fsync 的 BEST_EFFORT 降级、锁 fencing、journal rollback 和 Web build smoke；
  Windows 仍保持 BEST_EFFORT，绝不因此宣称 FULL。
- pnpm 仅显式批准 `esbuild` 的构建脚本（`allowBuilds.esbuild: true`）；这是 Web
  打包所需的已声明 devDependency，其余依赖仍不获隐式构建脚本授权。
- 独立候选打包已实现并完成本地验证：`@webcasa/deepseek-harness-marketplace` 的私有源码 manifest 明确声明
  `dsh.platforms: [web, desktop]` 与 `dsh.engines.dsh: >=0.1.0-rc.7 <0.2.0`；
  `pack-smoke` 生成无 workspace 依赖、可公开打包的独立候选，且保留 `dist/`，从而修复 host
  的 `../data/registry-snapshot.json` 离线 fallback 路径。新增测试会实际解包、强制网络失败并
  验证该 snapshot fallback；真实 DSH E2E 仍通过。`pnpm run pack:check` 现同时对各 workspace
  和该临时候选执行无脚本 `npm pack --dry-run`。源码 workspace 依旧 `private: true`，不会直接 npm
  发布、tag 或变更可见性，也不会把本地 pack integrity 当作 registry integrity。旧
  `@webcasa/web@0.1.0` 的 direct bootstrap 是历史事实；新 identity 的 `0.1.1` 已公开，且其
  registry tarball 已独立复核。
  owner 已确认 MIT `Copyright (c) 2026 www.Web.Casa`；私有源码 manifest 现声明 `MIT`，且公开候选
  显式包含 `LICENSE`。
  `pnpm run release:public-check` 是 opt-in 本地门禁：完成 build 后会生成候选并复核 archive 与 npm
  无脚本、离线 dry-run 文件清单，不触发 npm/GitHub/数据库/部署 mutation。`0.1.0` 已完成 direct
  interactive/2FA bootstrap（不是 OIDC provenance）。实际本地 `origin` 已指向 owner 确认的 GitHub
  remote；`publish.yml` 只允许 `main`，先在无 OIDC token 的 job 重跑 workspace/pack/host/DSH E2E，再由唯一
  `id-token: write` job 下载 SHA-512 复核后的 tarball 发布。GitHub `npm` environment 已设为 custom
  branch policy `main`，并要求 `yeagoo` 人工批准；为避免未提供第二审批者时的死锁，当前允许自审，且 GitHub
  仍报告 admin 可 bypass，因此这不是独立双人审批。npm 11.17.0 已确认精确 trust 参数，但创建/列出
  `npm trust github` 与 `npm trust list` 均要求 owner 完成互动式 2FA。更名后的新 npm 包现已存在，
  `0.1.1` direct interactive/2FA bootstrap 已完成；但其 OIDC trust 尚未建立或验证，只能用于随后明确
  版本的发布。workflow 不再预填 `0.1.1`，并会在 staging 前拒绝已存在的 npm version。
- 166/166 是本轮全项目复审前的历史本地门禁记录。复审后的最新门禁为 206/206 workspace tests
  （其中 journal-core 97/97，原 POSIX FULL 96-test gate 保持不变）、`pack:check`、
  `release:public-check`、host/DSH smoke、
  fixture 正向 install → pending → explicit activate → restart E2E、生产目录 self-refusal、
  actionlint、production dependency audit 与 `git diff --check`。其生成 tarball 的 script-free
  `npm publish --dry-run --access public --tag latest` 也通过；这不是发布。
- 本次 Codex 全项目复审已将以下边界补为 fail-closed：fresh install/activate 不接受 snapshot、
  stale cache 或 fresh `304`；旧平铺 DTO 仅可浏览，完整嵌套 v4 `source` 才可安装；下载采用
  streaming SHA-512/大小门禁并清理失败 staged artifact；只解析工件实际声明且安全的
  `dsh.bundle.patch`，只信任其 entry ids；pending 在原安装事务内持久化并在损坏时阻止启动；
  DSH CLI 的 package argument 使用 `--` 分隔，runner 也覆盖同步 spawn/abort/旧 child close
  竞态。详情见 `SELF-REVIEW-CODEX-FULL-REVIEW.md`；journal-core 未修改。
- 父仓库的单包 npm 同步现有独立只读预检：
  `pnpm plugins:sync -- --pkg=<package> --dry-run --no-assets` 只读取 npm
  packument，并要求包名、latest `dsh.bundle`、精确 version/SHA-512/tarball/
  platform/engine 全部满足 strict v4；不会进入数据库/R2 写入路径。实际单包同步必须提供
  owner 确认且已配置的 `--category`，并正确传递 `--no-assets`；未知分类在同步器初始化前
  fail-closed。同步与提交验证新增 latest bundle 防陈旧 root 字段测试；父仓库为
  363/363 单测与生产构建通过。
- 生产只读复核（2026-08-20，source cutover 前的历史记录）：`/api/v1/plugins?platform=desktop&limit=1` 为
  `200 application/json`、含 ETag、`count=1`；`@webcasa/web@0.1.0` 的 registry version、SHA-512
  integrity 与 tarball 已由 strict preflight 复核。生产 API 的结构契约 probe 已通过，但未把它或
  self-refusal 测试误报为独立插件的正向 DSH/Desktop 安装 E2E。
- 复审修复：父仓库的 `scripts/plugins/scan-plugins.ts` 现在先加载 `.env.local`，再动态导入会初始化
  数据库单例的扫描器；回归测试锁定该导入顺序，避免常规本地扫描意外以空 `DATABASE_URL` 启动。

## 未完成事项
1. `@webcasa/deepseek-harness-marketplace@0.1.1` 的 direct interactive/2FA bootstrap 与受保护生产
   source cutover 已完成；它本身仍没有 OIDC provenance。若要发布该市场宿主的新版本，需由 owner 为该
   package/repository 单独建立并复核 npm GitHub OIDC trust；不得把 PkgSeek 的 publisher relationship、旧
   `@webcasa/web` identity 或 direct bootstrap 误报为它的 provenance。父仓库的 Apache-2.0 文件没有被复制或套用。
2. Microsoft Store 发布仍需独立人工审查并有意更新 `store-curated-plugins.json`；生产目录可见性、生产
   Desktop bootstrap IPC E2E 与 web distribution 验收都不授予 Store allowlist 权限。持续发布时维持 fixture
   CI，按部署/发版手动重跑生产 contract、DSH 和 Desktop 生命周期验收；不要把生产网络 mutation 纳入普通 CI。

## 关键命令
- 全部测试：`pnpm -r test`（以当前 CI 输出为准）
- 冒烟：`node scripts/dsh-smoke.mjs`
- 真实 fixture E2E：`node scripts/dsh-e2e-install.mjs`
- 外部独立条目 E2E（无路由亦可）：`CORDIS_RUN_API=https://<target>/api/v1 CORDIS_E2E_SLUG=<slug> node scripts/dsh-e2e-install.mjs`
- 目标 API 无 mutation 验收：`CORDIS_RUN_API=https://<target>/api/v1 node scripts/cordis-run-contract-probe.mjs`
- 生产目录宿主拒绝验收：`CORDIS_RUN_API=https://cordis.run/api/v1 CORDIS_E2E_SLUG=webcasa-web CORDIS_E2E_EXPECT_SELF_REFUSAL=1 node scripts/dsh-e2e-install.mjs`
- 父仓库 v4 上线 runbook：`../docs/CORDIS-API-V4.md`
- 构建：`node apps/web/scripts/build.mjs`
- 打包 smoke tarball：`node apps/web/scripts/pack-smoke.mjs`
- npm pack 预检：`pnpm run pack:check`
- 公开发布候选本地门禁（MIT source/`LICENSE` 就绪后应为 `ready`）：
  `pnpm run release:public-check`
- 发布后单包只读 registry 预检（在父仓库）：
  `pnpm plugins:sync -- --pkg=@webcasa/deepseek-harness-marketplace --dry-run --no-assets`
- 已完成的生产 guarded 单宿主切换（历史记录；不得重跑）：
  `pnpm plugins:sync -- --pkg=@webcasa/deepseek-harness-marketplace --replace-package=@webcasa/web --expected-replacement-slug=webcasa-web --expected-version=0.1.1 --expected-integrity=sha512-nlgpAdjkDdMe21zbFa9XSI1Nq68uwl4c4ulldOhhhygoEP1zBfdWSMl8P9qAO71K2w7DFXtyeAFC1WTTySp9yA== --expected-tarball=https://registry.npmjs.org/@webcasa/deepseek-harness-marketplace/-/deepseek-harness-marketplace-0.1.1.tgz --category=dev-assistant --no-assets`
- Desktop 生产只读 smoke（在 Desktop 仓库）：`pnpm verify:cordis-preset && pnpm verify:cordis-market`
- CI 工作流静态校验：`actionlint .github/workflows/ci.yml .github/workflows/publish.yml`

## 关键文档
- PLAN-*.md / M2A-*.md / JOURNAL-SPEC.md / REVIEWS.md / SELF-REVIEW-*.md
- docs/cordis-run-api-contract.md
- RELEASE.md
- FAILPOINT-COVERAGE.md
- codex-review-latest.md
