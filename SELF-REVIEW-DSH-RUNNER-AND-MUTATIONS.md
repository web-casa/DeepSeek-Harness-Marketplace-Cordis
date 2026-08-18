# dsh-runner + Web mutation 路由自审

## 完成
- packages/dsh-runner：DshRunner（spawn 参数数组、超时、取消）+
  DshPackageManagerPort（install/remove/verify/profileFiles）。
- web-harness：mutation routes（install/uninstall/status + JSON body 限制）。
- apps/web host：CatalogClient + DshRunner + Journal + InstallService 全部接上，
  挂载 6 条路由。
- 测试：workspace 全量 116 pass（journal 92 / catalog 6 / install 5 /
  web-harness 9 / dsh-runner 3 / apps-web 1）。

## 自审发现
- apps/web 测试初版未覆盖 mutation 路由；已更新断言 6 条路由。
- web-harness 需依赖 install-core；已加 workspace 依赖。
- pnpm -r test 不要透传 --store-dir，否则测试脚本会把 store 当 test target。

## 边界
- mutation 路由尚未接入同源/mutation token 安全门。
- PackageManagerPort.verifyInstalled 只比较 name/version，不校验 integrity；
  安装前完整性由 catalog + pnpm 验证，安装后 lockfile 复核待接。
