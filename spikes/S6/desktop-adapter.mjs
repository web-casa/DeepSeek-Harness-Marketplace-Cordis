import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const sidecar = fileURLToPath(new URL('./sidecar.mjs', import.meta.url))
export function makeDesktopAdapter(){
  const call = (op, payload) => new Promise((resolve,reject)=>{
    const child = spawn(process.execPath, [sidecar, op, JSON.stringify(payload)], {stdio:['ignore','pipe','pipe']})
    let out='', err=''
    child.stdout.on('data', c=>out+=c); child.stderr.on('data', c=>err+=c)
    child.on('error', reject)
    child.on('close', code => {
      try { resolve(JSON.parse(out)) } catch (e) { reject(new Error(`desktop sidecar failed code=${code} out=${out} err=${err}`)) }
    })
  })
  return {
    name:'desktop-adapter',
    ports: {
      journal: {
        begin: p => call('begin',{plan:p, txid:randomUUID()}),
        commit: t => call('commit',{id:t.id}),
        rollback: t => call('rollback',{id:t.id, plan:t.plan}),
      },
      packageManager: {
        installLocalVerifiedArtifact: (p, signal) => call('install',{plan:p, aborted: signal?.aborted ?? false}),
      },
      verify: { verifyInstalled: p => call('verify',{plan:p}) },
      activation: { requestActivation: ids => call('activate',{ids}) },
    }
  }
}
