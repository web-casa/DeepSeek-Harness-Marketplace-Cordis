// Deterministic failpoint 注入。
const registry = new Map()
export function setFailpoint(name, fn, { times = Infinity } = {}) {
  registry.set(name, { fn, times, count: 0 })
}
export function clearFailpoints(){ registry.clear() }
export function failpoint(name, ctx = {}){
  const item = registry.get(name)
  if (!item) return
  item.count++
  if (item.count > item.times) return
  return item.fn(ctx)
}
