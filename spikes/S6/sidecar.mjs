import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const stateFile = fileURLToPath(new URL('./sidecar-state.json', import.meta.url))
function load(){ try { return JSON.parse(readFileSync(stateFile,'utf8')) } catch { return {installed:{},tx:{}} } }
function save(s){ writeFileSync(stateFile, JSON.stringify(s)) }
const [op, payload] = [process.argv[2], JSON.parse(process.argv[3] ?? '{}')]
const key = p => `${p.packageName}@${p.version}`
const state = load()
if (op==='begin') { state.tx[payload.txid]=payload.plan; save(state); console.log(JSON.stringify({id:payload.txid})) }
else if (op==='commit') { delete state.tx[payload.id]; save(state); console.log(JSON.stringify({ok:true})) }
else if (op==='rollback') { state.installed[key(payload.plan)]='absent'; delete state.tx[payload.id]; save(state); console.log(JSON.stringify({ok:true})) }
else if (op==='install') { state.installed[key(payload.plan)]='present'; save(state); console.log(JSON.stringify({exitCode: payload.aborted ? 130 : 0})) }
else if (op==='verify') { console.log(JSON.stringify({ok: state.installed[key(payload.plan)]==='present'})) }
else if (op==='activate') { console.log(JSON.stringify({status:'ACTIVE'})) }
