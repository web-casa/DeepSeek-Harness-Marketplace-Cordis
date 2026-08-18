// 客户端入口：注册 settings.section。UI 依赖宿主注入的 React / slots。
import React from 'react'
import { createMarketApi } from './api.js'
import { createMarketController } from './market-controller.js'
import { MarketSection } from './MarketSection.js'

export const inject = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings']

export function apply(ctx) {
  if (!ctx?.slots) {
    console.warn('[cordis-mp] settings slots unavailable; market UI is not mounted')
    return
  }
  const api = createMarketApi()
  const controller = createMarketController(api)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'cordis-mp-market',
    order: 25,
    label: () => '插件市场',
    inject: () => ({ controller }),
    children: {},
  }, (props) => React.createElement(MarketSection, { ...props, controller })))
}
