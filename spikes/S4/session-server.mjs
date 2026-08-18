import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

const TOKEN = randomBytes(16).toString('hex')
const ALLOWED_HOSTS = new Set(['127.0.0.1','localhost','[::1]'])

function normHost(h){
  h = (h||'').trim().toLowerCase()
  try {
    const url = new URL('http://' + h)
    let host = url.hostname.toLowerCase()
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1,-1)
    return { host, port: url.port || '80' }
  } catch { return { host: h, port: '' } }
}
function sameOrigin(req){
  const origin = req.headers.origin
  if (!origin || origin === 'null') return {ok:false, reason:'origin-missing-or-null'}
  let o
  try { o = new URL(origin) } catch { return {ok:false, reason:'origin-invalid'} }
  const h = normHost(req.headers.host)
  const oh = normHost(o.host)
  const schemeOk = o.protocol === 'http:'
  if (!schemeOk) return {ok:false, reason:'origin-scheme'}
  if (oh.host !== h.host || oh.port !== h.port) return {ok:false, reason:'origin-host-mismatch', origin:origin, host:req.headers.host}
  return {ok:true}
}
function check(req){
  const peer = req.socket.remoteAddress || ''
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
  const h = normHost(req.headers.host)
  const hostOk = ALLOWED_HOSTS.has(h.host)
  const sf = req.headers['sec-fetch-site']
  const so = sameOrigin(req)
  const reasons=[]
  if(!loopback) reasons.push('peer-not-loopback')
  if(!hostOk) reasons.push('host-not-allowed')
  if(!so.ok) reasons.push(so.reason)
  if(sf && sf !== 'same-origin' && sf !== 'none') reasons.push('sec-fetch-site='+sf)
  return { loopback, peer, host:req.headers.host, sf:sf??null, so, ok: loopback && hostOk && so.ok && (!sf || sf==='same-origin' || sf==='none'), reasons }
}
const server = createServer((req,res)=>{
  const p = req.url.split('?')[0]
  if (p==='/'){
    res.writeHead(200,{'content-type':'text/html'})
    res.end(`<!doctype html><script>
      fetch('/cordis-mp/session',{method:'POST'}).then(async r=>{
        const body = await r.text(); document.title = 'STATUS '+r.status+' '+body.slice(0,60);
        document.body.textContent = 'STATUS '+r.status+' '+body;
      }).catch(e=>{document.title='FETCH-ERR '+e.message; document.body.textContent='FETCH-ERR '+e.message;});
    </script>`)
    return
  }
  if (p==='/cordis-mp/session'){
    const c = check(req)
    console.error(JSON.stringify(c))
    if (!c.ok){ res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify({error:c.reasons[0],reasons:c.reasons})); return }
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
    res.end(JSON.stringify({token:TOKEN,ttl:900})); return
  }
  res.writeHead(404); res.end('nf')
})
server.listen(0,'127.0.0.1',()=>console.log(server.address().port))
