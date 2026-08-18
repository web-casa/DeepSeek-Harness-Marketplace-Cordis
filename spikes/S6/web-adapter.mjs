import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const log=[]
export function makeWebAdapter(){
  const state = { installed: new Set(), activated: new Set(), tx: [] }
  return {
    name:'web-adapter',
    log,
    ports: {
      journal: {
        async begin(plan){ const t={id:randomUUID(),plan}; state.tx.push(t); return t },
        async commit(t){ state.tx = state.tx.filter(x=>x.id!==t.id) },
        async rollback(t){ state.installed.delete(planKey(t.plan)); state.tx = state.tx.filter(x=>x.id!==t.id) }
      },
      packageManager: {
        async installLocalVerifiedArtifact(plan){ state.installed.add(planKey(plan)); return {exitCode:0} },
      },
      verify: {
        async verifyInstalled(plan){ return { ok: state.installed.has(planKey(plan)) } }
      },
      activation: {
        async requestActivation(ids){ state.activated = new Set([...state.activated, ...ids]); return {status:'ACTIVE'} }
      }
    }
  }
}
function planKey(plan){ return `${plan.packageName}@${plan.version}` }
