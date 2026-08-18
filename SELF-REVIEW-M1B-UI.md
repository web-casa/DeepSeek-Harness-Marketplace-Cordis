# M1b UI 自审

## 完成
- apps/web 客户端：
  - market-controller.js：search/detail/install/uninstall/status 收敛
  - MarketSection.js：React.createElement 版市场列表（搜索/计数/错误/安装按钮）
  - index.js：settings.section 注册（id cordis-mp-market / order 25 / 插件市场）
  - createMarketApi 已接 token 与 403 重试
- 测试：workspace 125 pass（apps/web 7）。

## 自审发现
- 初版 apply 测试是异步裸 import，无断言；改为动态 import + 注册断言。
- 初版 fake response 缺 json()，测试失败后已补。
- MarketSection 用 server renderToStaticMarkup 验证基础 chrome。

## 边界
- 安装按钮目前未做二次确认弹窗；M2b 接 PRE_DISABLE/ACTIVATE 时补。
- DSH 真实 client bundle 需要构建步骤（tsdown/esbuild）后才能上宿主验证。
- 截图/详情弹窗未实现。
