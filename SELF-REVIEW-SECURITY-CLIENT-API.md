# 安全门 + 客户端 API 自审

## 完成
- web-harness：MutationGuard（loopback + Origin/Host + Sec-Fetch-Site +
  mutation token）、/cordis-mp/session、mutation guard 接入。
- apps/web host：创建 guard，挂载 session + 受保护 mutation 路由。
- apps/web client/api.js：session/token 缓存/403 重试一次/catalog/detail/
  install/uninstall/status 封装。
- 测试：workspace 122 pass。

## 自审发现并修复
1. lock takeover 在 rename→mkdir 间隙存在正常 acquire 抢占窗口，导致 epoch
   未继承、双 owner 风险；新增 #stolenState 门 + gap 检查 + 新锁存在时快速
   BUSY，30 次竞态测试通过。
2. client api 测试 fake response 缺 json()，已补。
3. MutationGuard 的 same-origin 校验复用 S4 原型语义。

## 边界
- MutationGuard 是 anti-CSRF capability，不是用户身份认证；反向代理信任边界
  见 JOURNAL-SPEC。
- 客户端 UI 渲染仍未实现；api.js 已为 M1b UI 准备。
