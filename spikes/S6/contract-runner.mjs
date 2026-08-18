import { installVerifiedPlugin } from './core.mjs'
import { makeWebAdapter } from './web-adapter.mjs'
import { makeDesktopAdapter } from './desktop-adapter.mjs'
const plan = { packageName:'cordis-demo', version:'1.0.0', integrity:'sha512-test', entryIds:['cordis-demo'], activate:true }
for (const make of [makeWebAdapter, makeDesktopAdapter]) {
  const adapter = make()
  const result = await installVerifiedPlugin(adapter.ports, plan)
  console.log(adapter.name, '=>', JSON.stringify(result))
  if (result.status !== 'ACTIVE') throw new Error(adapter.name+' contract failed')
}
const adapter = makeDesktopAdapter()
const controller = new AbortController()
setImmediate(()=>controller.abort())
const cancelled = await installVerifiedPlugin(adapter.ports, plan, controller.signal)
console.log('desktop-adapter cancel =>', JSON.stringify(cancelled))
if (cancelled.status !== 'ROLLED_BACK' || cancelled.error !== 'ABORTED') throw new Error('cancel contract failed')
console.log('CONTRACT OK')
