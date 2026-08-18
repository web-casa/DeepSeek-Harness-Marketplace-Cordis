import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const data = JSON.parse(readFileSync(new URL('./fixture-data.json', import.meta.url)))
const server = createServer((req,res)=>{
  const p=req.url.split('?')[0]
  if(p==='/api/v1/plugins'){res.writeHead(200,{'content-type':'application/json','etag':'"m0-fixture-v1"'});res.end(JSON.stringify(data));return}
  if(p.startsWith('/api/v1/plugins/')){const slug=p.slice('/api/v1/plugins/'.length);const item=data.items.find(i=>i.slug===slug);if(!item){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'NOT_FOUND',message:'no such slug'}}));return}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(item));return}
  res.writeHead(404);res.end('nf')
})
server.listen(0,'127.0.0.1',()=>console.log(server.address().port))
