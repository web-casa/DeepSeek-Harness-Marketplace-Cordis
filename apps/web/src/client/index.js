// 客户端占位：M1b 将在此注册 settings.section「插件市场」并渲染只读目录 UI。
export const inject = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings']
export function apply(ctx) {
  // 预留 ctx.slots.inject('settings.section', ...)
  if (!ctx?.slots) {
    console.warn('[cordis-mp] settings slots unavailable; client UI is not mounted (M1b placeholder)')
    return
  }
}
