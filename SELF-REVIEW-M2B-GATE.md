# M2b 安装门禁自审

## 完成
- install-core：ActivationPort（prepareDisable/preDisable/cancelDisable/activate），
  install 流程 PRE_DISABLE → journal install → commit → pending activation；
  失败时 cancelDisable；activate() 消费 pending。
- web-harness：POST /cordis-mp/activate 接入 guard。
- apps/web client：api.activate / controller.activate / MarketSection 安装确认
  与「安装→启用」两段式按钮。
- 测试：workspace 129 pass。

## 自审发现
- installService 现在无 activation port 时也会记录 pending，但 activate 会报
  NO_ACTIVATION_PORT；调用方必须在 apps/web 提供 activation adapter。
- pending activation 仍在内存 Map，进程重启丢失；后续需持久化为
  PENDING_ACTIVATION journal（G5 之外的下一个持久化状态）。
- MarketSection 使用 globalThis.confirm 做确认，DSH webview 若禁用原生 confirm
  需替换为 UI 弹窗。

## 边界
- activation port 在 apps/web host 尚未接真实 cordis.patch.yml 读写实现；
  当前 apps/web host 构造 InstallService 未传 activation。下一步实现
  DshActivationPort。
