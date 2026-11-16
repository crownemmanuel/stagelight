import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import dgram from 'node:dgram';
import {fileURLToPath} from 'node:url';
import {Engine,MEDIA_TYPES} from './engine/engine.mjs';
import {decodePacket,encodeOSC} from './engine/osc.mjs';
import {routeOSC} from './engine/osc-routes.mjs';
import {openShow} from './engine/safety.mjs';
import {migrate} from './engine/model.mjs';
import {validateShow} from './engine/spec.mjs';
import {performance} from 'node:perf_hooks';
import {RuntimeStream} from './engine/stream.mjs';
import {watchDesk} from './engine/desk-build.mjs';
import {WallLink} from './engine/wall.mjs';
import {refuse} from './engine/ws.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.LIGHTS_PORT??1460);
const dataDir=process.env.LIGHTS_DATA_DIR??path.join(root,'data');
const token=crypto.randomBytes(24).toString('hex'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
// Fingerprint of the desk and engine code this server loaded: an open desk reloads when it reconnects to different code.
const build=(()=>{const h=crypto.createHash('sha1');for(const dir of ['public','engine'])for(const f of fs.readdirSync(path.join(root,dir)).filter(f=>/\.(m?js|html|css)$/.test(f)).sort())h.update(f).update(fs.readFileSync(path.join(root,dir,f)));return h.digest('hex').slice(0,12)})();
// Last-resort guards (docs/SHOW-SAFETY.md): a stray rejection or exception is written to the engine log and stderr and
// the engine keeps running, so the rig keeps its look. Rate-limited: the same error at most once per 10 s and at most 20
// reports a minute, with a count of what was held back, so a repeating error cannot flood the audit log or engine.log.
let engine=null;
const guard={seen:new Map(),window:0,count:0,held:0};
function report(kind,err){
 const now=Date.now(),msg=String(err?.stack??err?.message??err).split('\n').slice(0,4).join(' | ').slice(0,400),key=kind+msg;
 if(now-guard.window>60000){guard.window=now;guard.count=0}
 const last=guard.seen.get(key);if((last&&now-last<10000)||guard.count>=20){guard.held++;return}
 if(guard.seen.size>500)guard.seen.clear();guard.seen.set(key,now);guard.count++;
 const line=`${kind}: ${msg}${guard.held?` (${guard.held} similar reports held back)`:''}`;guard.held=0;
 try{console.error(new Date().toISOString()+' '+line)}catch{}try{engine?.log('Engine kept running after '+line)}catch{}
}
process.on('unhandledRejection',e=>report('Unhandled rejection',e));
process.on('uncaughtException',e=>report('Uncaught exception',e));
// Startup: an unreadable or invalid show.json is moved aside and the newest show version that loads takes its place
// (engine/safety.mjs openShow). If none loads, exit naming the bad file rather than start on an empty show.
try{
 const r=openShow({dataDir,make:()=>new Engine({dataDir}),check:raw=>validateShow(migrate(raw)),log:m=>console.error(m)});engine=r.engine;
 if(r.recovered){const m=`Startup: show.json could not be read (${r.recovered.why}). It was kept as ${path.basename(r.recovered.aside)} and the show was restored from version ${r.recovered.version}. Check the show before arming.`;console.error(m);engine.log(m)}
}catch(e){console.error(e.message);process.exit(1)}
// Commands run one at a time, in order. A command that has not settled after QUEUE_WAIT (a network check that never
// returns, say) stops holding up the rest: it is logged and the next command runs, so GO never freezes behind it.
const QUEUE_WAIT=Number(process.env.LIGHTS_QUEUE_WAIT_MS)||20000;
// Desk-only code changes are picked up without a restart: open desks see runtime.desk change and offer Reload.
const desk=watchDesk(path.join(root,'public'),d=>{engine.desk=d;engine.log('Desk code changed on disk: open desks can reload to take it')});
const clients=new Set(),deltaClients=new Set(),stream=new RuntimeStream();let queue=Promise.resolve();
const execute=(command,args,opts)=>{let release;const gate=new Promise(r=>release=r);
 const run=queue.then(()=>{const t=setTimeout(()=>{engine.log(`${command} is still running after ${QUEUE_WAIT/1000} s: the commands after it no longer wait for it`);release()},QUEUE_WAIT);t.unref?.();
  const p=Promise.resolve().then(()=>engine.command(command,args,opts));p.catch(()=>{}).finally(()=>{clearTimeout(t);release()});return p});
 queue=gate;return run};
// Command bodies (a whole show for show.import) up to 32 MB, counted in bytes; above that a clear 413.
const MAX_BODY=32*1024*1024;
const tooLarge=()=>Object.assign(Error(`Request too large: the limit is ${MAX_BODY/1024/1024} MB`),{status:413});
// An over-limit body is read to its end and dropped, so the sender always gets the answer instead of a reset
// connection; only past four times the limit is the connection cut.
async function readBody(req){
 const declared=Number(req.headers['content-length']);if(declared>MAX_BODY*4){req.destroy();throw tooLarge()}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY*4){req.destroy();throw tooLarge()}if(size<=MAX_BODY)chunks.push(chunk)}
 if(size>MAX_BODY)throw tooLarge();return Buffer.concat(chunks,size).toString('utf8');
}
// A file stream that fails part-way (file removed, disk error) ends that response, never the engine.
const pipeFile=(stream,res)=>{stream.on('error',()=>res.destroy());stream.pipe(res)};
// The built-in assistant runs its commands through the same queue as the desk, one at a time (docs/ASSISTANT.md).
engine.assistant.exec=(name,args)=>execute(name,args,{lean:true});
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const server=http.createServer(async(req,res)=>{
 try{
  if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return json(res,403,{error:'Local host only'});
  if(req.headers.origin&&!origins.has(req.headers.origin))return json(res,403,{error:'Cross-origin request refused'});
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{token,version,build,desk:desk.build()});
  // Exact values for the Connect an agent dialog: this Mac's Node, this folder's MCP server, this engine's URL.
  if(req.method==='GET'&&url.pathname==='/api/connect')return json(res,200,{node:['/opt/homebrew/bin/node','/usr/local/bin/node'].find(p=>fs.existsSync(p))??process.execPath,server:path.join(root,'mcp','server.mjs'),url:`http://127.0.0.1:${port}`,name:'stagelight'});
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,engine.snapshot());
  if(req.method==='GET'&&url.pathname==='/api/schema')return json(res,200,await engine.command('schema'));
  if(req.method==='GET'&&url.pathname==='/api/show'){res.setHeader('content-disposition','attachment; filename="stagelight-show.json"');return json(res,200,engine.show)}
  if(req.method==='GET'&&url.pathname==='/api/events'){
   // ?delta=1 (the desk): compact frame deltas (engine/stream.mjs). Without it: the whole runtime, as before.
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
   if(url.searchParams.get('delta')==='1'){if(!deltaClients.size)stream.last=null;res.write('data: '+JSON.stringify(stream.full(engine.runtime()))+'\n\n');res.on('error',()=>deltaClients.delete(res));deltaClients.add(res);req.on('close',()=>deltaClients.delete(res));return}
   res.on('error',()=>clients.delete(res));res.write('data: '+JSON.stringify(engine.runtime())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='POST'&&url.pathname==='/api/command'){
   if(req.headers['x-lights-token']!==token)return json(res,403,{error:'Missing session token'});
   const body=await readBody(req);let parsed;try{parsed=JSON.parse(body)}catch{return json(res,400,{error:'The request body is not valid JSON'})}
   const {command,args={}}=parsed??{};// assistant.* never waits in the command queue (a provider call can take seconds; the queue carries GOs).
   return json(res,200,typeof command==='string'&&command.startsWith('assistant.')?await engine.command(command,args):await execute(command,args));
  }
  if(req.method==='POST'&&url.pathname==='/api/choose-folder'){
   // The Finder's folder picker for Save / Open show. Outside the command queue: it waits on the operator, never on the engine.
   // The desk then sets the folder with show.folder.set, which agents call directly with a path.
   if(req.headers['x-lights-token']!==token)return json(res,403,{error:'Missing session token'});
   if(process.platform!=='darwin')return json(res,400,{error:'The folder picker works on macOS only: type a path with show.folder.set.'});
   const start=engine.files.folder&&fs.existsSync(engine.files.folder)?engine.files.folder:os.homedir(),esc=s=>s.replaceAll('\\','\\\\').replaceAll('"','\\"');
   const {execFile}=await import('node:child_process');
   const picked=await new Promise(r=>execFile('osascript',['-e',`POSIX path of (choose folder with prompt "Choose the folder for StageLight shows" default location (POSIX file "${esc(start)}"))`],{timeout:600000},(e,out)=>r(e?null:out.trim())));
   return json(res,200,{path:picked||null});
  }
  if(req.method==='POST'&&url.pathname==='/api/media'){
   // Raw upload body; the engine validates type and size, then moves it into data/media.
   if(req.headers['x-lights-token']!==token)return json(res,403,{error:'Missing session token'});
   if(engine.locked)return json(res,409,{error:'The performance lock is on: unlock it to change the show.'});
   const name=(url.searchParams.get('name')??'').trim().slice(0,100),ext=path.extname(url.searchParams.get('file')??'').toLowerCase();
   if(!name||!MEDIA_TYPES[ext])return json(res,400,{error:'Choose a png, jpg, webp, gif, mp4, webm, mov or m4v file'});
   if(Number(req.headers['content-length'])>500e6)return json(res,413,{error:'Media file exceeds 500 MB'});
   const dir=path.join(dataDir,'media');fs.mkdirSync(dir,{recursive:true});const tmp=path.join(dir,'.incoming-'+crypto.randomBytes(6).toString('hex')+ext);
   try{let size=0;const file=fs.createWriteStream(tmp);for await(const chunk of req){size+=chunk.length;if(size>500e6)throw Error('Media file exceeds 500 MB');if(!file.write(chunk))await new Promise(r=>file.once('drain',r))}await new Promise((r,j)=>file.end(e=>e?j(e):r()));
    let release;const gate=new Promise(r=>release=r);const run=queue.then(()=>{try{const id=engine.addMedia(tmp,name,{move:true});engine.log('media.upload · '+name);return {ok:true,created:{media:id},runtime:engine.runtime()}}finally{release()}});queue=gate;return json(res,200,await run)}
   finally{fs.rmSync(tmp,{force:true})}
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(url.pathname.startsWith('/media/')){
   const file=path.basename(decodeURIComponent(url.pathname)),p=path.join(dataDir,'media',file);
   if(file.startsWith('.')||!MEDIA_TYPES[path.extname(file).toLowerCase()]||!fs.existsSync(p))return json(res,404,{error:'Not found'});
   // Byte ranges: WebKit will not play video without them.
   const size=fs.statSync(p).size,range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range??''),headers={'content-type':types[path.extname(p).toLowerCase()],'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff'};
   if(range){let start=range[1]?+range[1]:size-+range[2],end=range[1]&&range[2]?Math.min(+range[2],size-1):size-1;if(!range[1])start=Math.max(0,start);if(start>end||start>=size){res.writeHead(416,{'content-range':`bytes */${size}`});return res.end()}res.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${size}`,'content-length':end-start+1});return pipeFile(fs.createReadStream(p,{start,end}),res)}
   res.writeHead(200,{...headers,'content-length':size});return pipeFile(fs.createReadStream(p),res);
  }
  const p=path.resolve(root,'public','.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!p.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Invalid path'});
  if(!fs.existsSync(p)||!fs.statSync(p).isFile())return json(res,404,{error:'Not found'});
  res.writeHead(200,{'cache-control':'no-store','content-type':types[path.extname(p)]??'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});pipeFile(fs.createReadStream(p),res);
 }catch(e){
  if(res.headersSent){res.destroy();return}
  if(e.status===413)return json(res,413,{error:e.message});
  json(res,400,{error:e.message});
 }
});
// Show-control network: one UDP socket receives triggers and sends to targets, so replies come from our listen port.
// Loopback by default; LAN mode only accepts allowlisted IPs. Everything runs through the same engine commands.
let osc=null;const loopback=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
// With a callback, a failed reply (host unreachable) is dropped instead of reaching the socket's error handler,
// which would wrongly report the listener as down.
const reply=(address,args,rinfo,port)=>{try{osc?.send(encodeOSC(address,args),port??rinfo.port,rinfo.address,()=>{})}catch{}};
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
   if(address==='/lights/ping'){reply('/lights/hello',[version,engine.output.armed?1:0],rinfo);row.ok=true;row.result='hello';continue}
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
 socket.on('message',(m,r)=>{onOSC(m,r).catch(e=>report('OSC',e))});socket.on('error',e=>{engine.net.listener={listening:false,address:host,port:portToUse,error:e.message};engine.log('OSC unavailable: '+e.message)});
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
// Wall video link (docs/WALL-VIDEO.md): LiveStage's preview picture arrives on LIGHTS_WALL_PORT (default 1455, `off` to
// disable) at /wall/in and is relayed to this desk's own windows on /api/wall (this server, 127.0.0.1 only). While a
// window draws the stream, the delta runtime stream follows every engine tick (30 Hz) instead of 10 Hz, so the
// windows can delay lights to each frame's stamp; the rest of the time nothing about the stream changes.
const wallPort=process.env.LIGHTS_WALL_PORT??'1455';let wall=null;
const pumpDelta=()=>{if(!deltaClients.size)return;const m=stream.next(engine.runtime());if(m)write(deltaClients,'data: '+JSON.stringify(m)+'\n\n')};
if(wallPort!=='off'&&Number.isInteger(Number(wallPort))){
 const lan=a=>{const cfg=engine.show.settings.osc??{},ip=a.replace(/^::ffff:/,'');return cfg.bind==='lan'&&!!(cfg.allow?.includes('*')||cfg.allow?.includes(ip))};
 wall=new WallLink({port:Number(wallPort),version,dataDir,armed:()=>engine.output.armed,allowed:lan,log:m=>engine.log(m),onLive:on=>{engine.afterTick=on?pumpDelta:null},onSource:info=>{engine.wallSource=info}});engine.wall=wall;
}
server.on('upgrade',(req,socket,head)=>{
 try{
  if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return refuse(socket,'403 Forbidden','Local host only');
  if(req.headers.origin&&!origins.has(req.headers.origin))return refuse(socket,'403 Forbidden','Cross-origin request refused');
  if(new URL(req.url,`http://127.0.0.1:${port}`).pathname!=='/api/wall'||!wall)return refuse(socket,'404 Not Found','Not found');
  wall.view(req,socket,head);
 }catch(e){report('Wall video view',e);try{socket.destroy()}catch{}}
});
server.on('error',e=>{console.error(e.message);process.exitCode=1;try{osc?.close()}catch{}try{wall?.close()}catch{}clearInterval(streamTimer);Promise.resolve().then(()=>engine.close()).catch(err=>console.error(err.message)).finally(()=>process.exit(1))});
server.listen(port,'127.0.0.1',()=>{engine.start();wall?.listen().then(w=>{if(w.listening)console.log(`Wall video ingest ws://0.0.0.0:${w.port}/wall/in`)});console.log(`LIGHTS_READY http://127.0.0.1:${port} · preview only · data ${dataDir}`)});
listenOSC(engine.show.settings.osc);
// 10 Hz runtime stream. A settled look repeats the same payload, so unchanged frames are not re-sent: idle desks then parse and paint nothing.
// The tick counter alone does not count as a change; it is read from the diagnostics dialog when something else moves.
const write=(set,data)=>{for(const client of set){if(client.destroyed||client.writableLength>500000){client.end();set.delete(client)}else client.write(data)}};
let lastStream='';const streamTimer=setInterval(()=>{try{if(!clients.size&&!deltaClients.size)return;const runtime=engine.runtime();
 if(deltaClients.size&&!engine.afterTick){const m=stream.next(runtime);if(m)write(deltaClients,'data: '+JSON.stringify(m)+'\n\n')}
 if(clients.size){const key=JSON.stringify(runtime,(k,v)=>k==='tickCount'||k==='at'?undefined:v);if(key!==lastStream){lastStream=key;write(clients,'data: '+JSON.stringify(runtime)+'\n\n')}}}catch(e){engine.log('Runtime stream: '+e.message)}},100);
let quitting=false;
async function shutdown(){if(quitting)return;quitting=true;clearInterval(streamTimer);desk.stop();engine.afterTick=null;try{wall?.close()}catch{}setTimeout(()=>process.exit(0),3000).unref();try{await engine.close()}catch(e){console.error('Shutdown: '+e.message)}for(const c of [...clients,...deltaClients])c.end();try{osc?.close()}catch{}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref()}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
