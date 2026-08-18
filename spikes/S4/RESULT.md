# S4 session token 请求矩阵

原型：POST /cordis-mp/session；校验 Origin/Host 规范化、loopback peer、
Sec-Fetch-Site；token 128-bit TTL 15min；Cache-Control no-store。

curl 矩阵（127.0.0.1）：
- same-origin Origin + Sec-Fetch-Site: same-origin => 200 token
- 无 Origin => 403；Origin: null => 403
- Origin 端口/主机不匹配 => 403
- Host: evil.example => 403
- Sec-Fetch-Site: cross-site => 403
- 无 Sec-Fetch-Site（老客户端）但 Origin 匹配 => 200（策略允许）

Chromium headless 实测：
- same-origin 页面 fetch => 200 token；服务器看到 sf=same-origin。
- 跨端口页面 fetch => 浏览器 CORS 拦截 Failed to fetch；服务器看到
  sf=same-site + origin-host-mismatch（双保险）。

未验证：Firefox/Safari（本环境无）。M0 外置任务：CI 上跑三浏览器矩阵。
信任边界：反向代理本机重写 Host 属于本机进程，不在防御面。
