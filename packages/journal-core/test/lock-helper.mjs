import { FileLock } from '../src/lock.mjs'
const root=process.argv[2]
const l=new FileLock(root)
const winner={ok:false}
try{ const rec=l.acquire('repair-action'); winner.ok=true; winner.token=rec.ownerToken; }catch(e){ winner.reason=e.code }
console.log(JSON.stringify(winner))
