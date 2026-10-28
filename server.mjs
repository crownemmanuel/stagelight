import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import {fileURLToPath} from 'node:url';
import {Engine,MEDIA_TYPES} from './engine/engine.mjs';
import {decodePacket,encodeOSC} from './engine/osc.mjs';
import {routeOSC} from './engine/osc-routes.mjs';
import {performance} from 'node:perf_hooks';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.LIGHTS_PORT??1460);
const dataDir=process.env.LIGHTS_DATA_DIR??path.join(root,'data');
const token=crypto.randomBytes(24).toString('hex'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const engine=new Engine({dataDir});
const clients=new Set();let queue=Promise.resolve();
const execute=(command,args,opts)=>{const run=queue.then(()=>engine.command(command,args,opts));queue=run.catch(()=>{});return run};
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const server=http.createServer(async(req,res)=>{
 try{
  if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return json(res,403,{error:'Local host only'});
  if(req.headers.origin&&!origins.has(req.headers.origin))return json(res,403,{error:'Cross-origin request refused'});
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{token,version});
  // Exact values for the Connect an agent dialog: this Mac's Node, this folder's MCP server, this engine's URL.
  if(req.method==='GET'&&url.pathname==='/api/connect')return json(res,200,{node:['/opt/homebrew/bin/node','/usr/local/bin/node'].find(p=>fs.existsSync(p))??process.execPath,server:path.join(root,'mcp','server.mjs'),url:`http://127.0.0.1:${port}`,name:'stagelight'});
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,engine.snapshot());
  if(req.method==='GET'&&url.pathname==='/api/schema')return json(res,200,await engine.command('schema'));
  if(req.method==='GET'&&url.pathname==='/api/show'){res.setHeader('content-disposition','attachment; filename="stagelight-show.json"');return json(res,200,engine.show)}
  if(req.method==='GET'&&url.pathname==='/api/events'){
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write('data: '+JSON.stringify(engine.runtime())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='POST'&&url.pathname==='/api/command'){
   if(req.headers['x-lights-token']!==token)return json(res,403,{error:'Missing session token'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>300000)throw Error('Request too large')}
   const {command,args={}}=JSON.parse(body);return json(res,200,await execute(command,args));
  }
  if(req.method==='POST'&&url.pathname==='/api/media'){
   // Raw upload body; the engine validates type and size, then moves it into data/media.
   if(req.headers['x-lights-token']!==token)return json(res,403,{error:'Missing session token'});
   const name=(url.searchParams.get('name')??'').trim().slice(0,100),ext=path.extname(url.searchParams.get('file')??'').toLowerCase();
   if(!name||!MEDIA_TYPES[ext])return json(res,400,{error:'Choose a png, jpg, webp, gif, mp4, webm, mov or m4v file'});
   if(Number(req.headers['content-length'])>500e6)return json(res,413,{error:'Media file exceeds 500 MB'});
   const dir=path.join(dataDir,'media');fs.mkdirSync(dir,{recursive:true});const tmp=path.join(dir,'.incoming-'+crypto.randomBytes(6).toString('hex')+ext);
   try{let size=0;const file=fs.createWriteStream(tmp);for await(const chunk of req){size+=chunk.length;if(size>500e6)throw Error('Media file exceeds 500 MB');if(!file.write(chunk))await new Promise(r=>file.once('drain',r))}await new Promise((r,j)=>file.end(e=>e?j(e):r()));
    const run=queue.then(()=>{const id=engine.addMedia(tmp,name,{move:true});engine.log('media.upload · '+name);return {ok:true,created:{media:id},runtime:engine.runtime()}});queue=run.catch(()=>{});return json(res,200,await run)}
   finally{fs.rmSync(tmp,{force:true})}
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(url.pathname.startsWith('/media/')){
   const file=path.basename(decodeURIComponent(url.pathname)),p=path.join(dataDir,'media',file);
   if(file.startsWith('.')||!MEDIA_TYPES[path.extname(file).toLowerCase()]||!fs.existsSync(p))return json(res,404,{error:'Not found'});
   // Byte ranges: WebKit will not play video without them.
   const size=fs.statSync(p).size,range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range??''),headers={'content-type':types[path.extname(p).toLowerCase()],'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff'};
   if(range){let start=range[1]?+range[1]:size-+range[2],end=range[1]&&range[2]?Math.min(+range[2],size-1):size-1;if(!range[1])start=Math.max(0,start);if(start>end||start>=size){res.writeHead(416,{'content-range':`bytes */${size}`});return res.end()}res.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${size}`,'content-length':end-start+1});return fs.createReadStream(p,{start,end}).pipe(res)}
   res.writeHead(200,{...headers,'content-length':size});return fs.createReadStream(p).pipe(res);
  }
  const p=path.resolve(root,'public','.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!p.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Invalid path'});
  if(!fs.existsSync(p)||!fs.statSync(p).isFile())return json(res,404,{error:'Not found'});
  res.writeHead(200,{'cache-control':'no-store','content-type':types[path.extname(p)]??'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});fs.createReadStream(p).pipe(res);
 }catch(e){json(res,400,{error:e.message})}
});
// Show-control network: one UDP socket receives triggers and sends to targets, so replies come from our listen port.
// Loopback by default; LAN mode only accepts allowlisted IPs. Everything runs through the same engine commands.
let osc=null;const loopback=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
const reply=(address,args,rinfo,port)=>{try{osc?.send(encodeOSC(address,args),port??rinfo.port,rinfo.address)}catch{}};
function legacy(address,args){switch(address){
 case '/lights/cue/play':if(args.length!==2)throw Error('cue/play requires cue ID and unique execution ID');return {command:'cue.play',args:{id:args[0],requestId:args[1]}};
 case '/lights/stop':return {command:'cue.stop',args:{fade:typeof args[0]==='number'?args[0]:1.5}};
 case '/lights/blackout':if(args[0]!==0&&args[0]!==1)throw Error('Expected 0 or 1');return {command:'blackout.set',args:{enabled:args[0]===1}};
 case '/lights/master':return {command:'master.set',args:{value:args[0]}};
 default:throw Error('Unknown OSC address '+address)}}
async function onOSC(msg,rinfo){
 const cfg=engine.show.settings.osc??{bind:'loopback',allow:[]};
 if(!loopback(rinfo.address)&&!(cfg.bind==='lan'&&(cfg.allow.includes('*')||cfg.allow.includes(rinfo.address)))){engine.netIn({at:new Date().toISOString(),from:rinfo.address,address:'(blocked)',ok:false,result:'Sender not in allowlist'});return}
 let messages;try{messages=decodePacket(msg)}catch(e){engine.netIn({at:new Date().toISOString(),from:rinfo.address,address:'(invalid)',ok:false,result:e.message});return}
 for(const {address,args} of messages){
  const t0=performance.now(),row={at:new Date().toISOString(),from:`${rinfo.address}:${rinfo.port}`,address,args:args.slice(0,6).map(a=>typeof a==='string'?a.slice(0,60):a)};
  try{
   if(address==='/lights/ping'){reply('/lights/hello',['0.1.0',engine.output.armed?1:0],rinfo);row.ok=true;row.result='hello';continue}
   const route=address.startsWith('/stagelight/')||address==='/stagelight'?routeOSC(address,args,engine.show,{stack:engine.stack,output:{armed:engine.output.armed},revision:engine.revision}):legacy(address,args);
   if(route.reply){reply(...route.reply,rinfo,route.replyPort);row.ok=true;row.result='hello';continue}
   if(route.replies){for(const r of route.replies)reply(...r,rinfo,route.replyPort);row.ok=true;row.result=`${address.split('/')[2]} · ${route.replies.length} messages`;continue}
   // Look Link: an untargeted look request is answered to the sender; feedback and preset lists are recorded, never executed.
   if(route.lookReply){const burst=engine.lookReply(route.requestId);for(const r of burst)reply(...r,rinfo,route.replyPort);row.ok=true;row.result=`look · ${burst.length} messages`;continue}
   if(route.feedback){row.result=engine.feedback(route.feedback,rinfo.address);row.ok=true;continue}
   if(route.presets){row.result=engine.receivePresets(route.presets,rinfo);row.ok=true;continue}
   const result=await execute(route.command,route.args,{lean:true});row.ok=true;row.result=result.duplicate?'duplicate':route.command;
   if(address.startsWith('/lights/'))reply('/lights/ack',[String(args[1]??''),route.command,result.duplicate?'duplicate':'accepted'],rinfo);
  }catch(e){row.ok=false;row.result=e.message;engine.log('OSC rejected: '+e.message);reply(address.startsWith('/lights/')?'/lights/error':'/stagelight/error',[address,e.message.slice(0,200)],rinfo)}
  finally{row.ms=+(performance.now()-t0).toFixed(2);engine.netIn(row)}
 }
}
function listenOSC(cfg){
 const portToUse=Number(process.env.LIGHTS_OSC_PORT??cfg?.port??1461),host=cfg?.bind==='lan'?'0.0.0.0':'127.0.0.1';
 try{osc?.close()}catch{}const socket=dgram.createSocket('udp4');osc=socket;engine.net.listener={listening:false,address:host,port:portToUse};
 socket.on('message',(m,r)=>{onOSC(m,r)});socket.on('error',e=>{engine.net.listener={listening:false,address:host,port:portToUse,error:e.message};engine.log('OSC unavailable: '+e.message)});
 socket.bind(portToUse,host,()=>{engine.net.listener={listening:true,address:host,port:portToUse}});
}
engine.onNetworkChange=cfg=>listenOSC(cfg);
// Outbound: OSC over the same socket (fire and forget) or HTTP JSON with a short timeout. Never awaited by playback.
// A packet's osc is one message or a burst ([address,args] pairs) sent in order. HTTP resolves with the reply's JSON body, if any.
engine.sendHook=async(target,packet)=>{
 if(packet.osc){if(!osc)throw Error('OSC socket not ready');for(const [address,args] of Array.isArray(packet.osc)?packet.osc:[[packet.osc.address,packet.osc.args]]){const buf=encodeOSC(address,args);await new Promise((res,rej)=>osc.send(buf,target.port,target.host,e=>e?rej(e):res()))}return null}
 const r=await fetch(target.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app:'StageLight',at:new Date().toISOString(),...packet.http}),signal:AbortSignal.timeout(1000)});
 let body=null;try{const t=await r.text();body=t&&t.length<200000?JSON.parse(t):null}catch{}
 if(!r.ok)throw Error('HTTP '+r.status+(typeof body?.summary==='string'?' · '+body.summary.slice(0,200):''));return body;
};
server.on('error',e=>{console.error(e.message);process.exitCode=1;osc?.close();clearInterval(streamTimer);engine.close()});
server.listen(port,'127.0.0.1',()=>{engine.start();console.log(`LIGHTS_READY http://127.0.0.1:${port} · preview only · data ${dataDir}`)});
listenOSC(engine.show.settings.osc);
// 10 Hz runtime stream. A settled look repeats the same payload, so unchanged frames are not re-sent: idle desks then parse and paint nothing.
// The tick counter alone does not count as a change; it is read from the diagnostics dialog when something else moves.
let lastStream='';const streamTimer=setInterval(()=>{if(!clients.size)return;const runtime=engine.runtime(),key=JSON.stringify(runtime,(k,v)=>k==='tickCount'?undefined:v);if(key===lastStream)return;lastStream=key;const data='data: '+JSON.stringify(runtime)+'\n\n';for(const client of clients){if(client.writableLength>500000){client.end();clients.delete(client)}else client.write(data)}},100);
let quitting=false;
async function shutdown(){if(quitting)return;quitting=true;clearInterval(streamTimer);await engine.close();for(const c of clients)c.end();osc?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref()}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
