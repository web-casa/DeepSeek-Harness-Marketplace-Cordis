// Deterministic failpoint 注入：测试可注册在 durable boundary 抛出/暂停。
const registry = new Map()
export function setFailpoint(name, fn){ registry.set(name, fn) }
export function clearFailpoints(){ registry.clear() }
export function failpoint(name, ctx = {}){
  const fn = registry.get(name)
  if (fn) return fn(ctx)
}
