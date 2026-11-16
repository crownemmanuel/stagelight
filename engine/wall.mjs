// Wall video link, StageLight side (docs/WALL-VIDEO.md). LiveStage streams its PREVIEW picture as stamped JPEG frames
// to ws://<host>:LIGHTS_WALL_PORT/wall/in; this relays them unchanged to StageLight's own windows on
// ws://127.0.0.1:<LIGHTS_PORT>/api/wall, keeps the clocks of the two apps related (ping/pong, min-rtt offset) and
// gathers what the windows measure (latency of each drawn frame, the sync probe). The windows delay their light
// rendering by each frame's latency; nothing here touches lighting, output or the show.
// Rehearsal only and free when idle: with no sender connected there is no timer, and with no window watching
// LiveStage is told viewers n:0 and stops capturing.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {upgrade,refuse} from './ws.mjs';
export const PROTOCOL=1,HEADER=32,MAX_FRAME=2*1024*1024,MANUAL_LIMIT=200;
export const clockNow=()=>performance.timeOrigin+performance.now();
// Frame header (little-endian): "LSWV" u8 version, u8 codec (1 JPEG, 2 WebP), u16 width, u16 height, u16 flags
// (bit0 preview frozen, bit1 no scene), u32 seq, f64 stamp, f64 sentAt, then the image bytes.
export function parseFrame(b){
 if(b.length<HEADER||b[0]!==0x4c||b[1]!==0x53||b[2]!==0x57||b[3]!==0x56)return null;
 return {version:b[4],codec:b[5],width:b.readUInt16LE(6),height:b.readUInt16LE(8),flags:b.readUInt16LE(10),seq:b.readUInt32LE(12),stamp:b.readDoubleLE(16),sentAt:b.readDoubleLE(24),bytes:b.length-HEADER};
}
export function encodeFrame({codec=1,width,height,flags=0,seq,stamp,sentAt=stamp},image){
 const b=Buffer.alloc(HEADER+image.length);b.write('LSWV',0,'latin1');b[4]=PROTOCOL;b[5]=codec;b.writeUInt16LE(width,6);b.writeUInt16LE(height,8);b.writeUInt16LE(flags,10);b.writeUInt32LE(seq>>>0,12);b.writeDoubleLE(stamp,16);b.writeDoubleLE(sentAt,24);image.copy?image.copy(b,HEADER):b.set(image,HEADER);return b;
}
// Clock offset between two apps from ping/pong: rtt = now − s, offset = l − (s + rtt/2) (their clock minus ours).
// The sample with the smallest round trip in the window is the least distorted, so that one is used.
export class ClockSync{
 constructor(windowMs=10000){this.windowMs=windowMs;this.samples=[]}
 add(s,l,at){const rtt=at-s;if(!(rtt>=0)||rtt>5000||!Number.isFinite(l))return null;const x={at,rtt,offset:l-(s+rtt/2)};this.samples.push(x);this.prune(at);return x}
 prune(at){while(this.samples.length>1&&at-this.samples[0].at>this.windowMs)this.samples.shift()}
 best(){let b=null;for(const x of this.samples)if(!b||x.rtt<b.rtt)b=x;return b}
}
// Median and spread (p90 − p10) of a list of numbers.
export function spread(values){
 if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),q=p=>{const i=(v.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return v[lo]+(v[hi]-v[lo])*(i-lo)};
 return {median:q(.5),jitter:q(.9)-q(.1),n:v.length};
}
const r1=v=>v==null||!Number.isFinite(v)?null:Math.round(v*10)/10;
const loopback=a=>a==='127.0.0.1'||a==='::1'||a==='::ffff:127.0.0.1';
const clean=(v,n=100)=>typeof v==='string'?v.slice(0,n):undefined,num=v=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
function cleanHello(h){const wall=Array.isArray(h.wall)&&h.wall.length===2&&h.wall.every(x=>Number.isFinite(x))?h.wall.map(Number):undefined;
 const o={app:clean(h.app,40),version:clean(h.version,40),protocol:num(h.protocol),width:num(h.width),height:num(h.height),fps:num(h.fps),scene:clean(h.scene,120),wall};
 return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined))}
// Pairs each video luma step with the light step of the same direction drawn nearest to it by the same window.
export function pairSteps(steps,limit=8){
 const video=steps.filter(s=>s.kind==='video'),light=steps.filter(s=>s.kind==='light'),out=[];
 for(const v of video.slice(-limit)){let best=null;for(const l of light)if(l.view===v.view&&l.up===v.up&&Math.abs(l.at-v.at)<=1000&&(!best||Math.abs(l.at-v.at)<Math.abs(best.at-v.at)))best=l;
  out.push({up:v.up,view:v.view,videoStepAt:r1(v.at),lightStepAt:best?r1(best.at):null,diff:best?r1(best.at-v.at):null})}
 return out;
}
export class WallLink{
 constructor({port=1455,host='0.0.0.0',version='0.0.0',dataDir=null,armed=()=>false,allowed=()=>false,log=()=>{},onLive=()=>{},onSource=()=>{},now=clockNow}={}){
  Object.assign(this,{port,host,version,armed,allowed,log,onLive,onSource,now});
  this.file=dataDir?path.join(dataDir,'wall-video.json'):null;this.manual=0;
  try{if(this.file&&fs.existsSync(this.file)){const m=Number(JSON.parse(fs.readFileSync(this.file,'utf8')).manual);if(Number.isFinite(m))this.manual=Math.max(-MANUAL_LIMIT,Math.min(MANUAL_LIMIT,m))}}catch{}
  this.listening=false;this.error=null;this.server=null;this.source=null;this.views=new Set();this.viewSeq=0;this.reported=null;this.live=false;
  this.counts={received:0,relayed:0,invalid:0,senderGaps:0,viewDrops:0,refused:0,senders:0};this.arrivals=[];this.latency=[];this.last=null;this.lastFrameAt=0;
  this.sync=new ClockSync();this.offset=null;this.probe={enabled:false,threshold:.5,steps:[]};
 }
 // The ingest server on LIGHTS_WALL_PORT. A port that is taken is reported, never fatal.
 listen(){
  const server=http.createServer((req,res)=>{res.writeHead(426,{'content-type':'text/plain','connection':'close'});res.end('StageLight wall video: connect a WebSocket to /wall/in')});
  server.on('upgrade',(req,socket,head)=>this.ingest(req,socket,head));server.on('clientError',(e,socket)=>{try{socket.destroy()}catch{}});
  server.on('error',e=>{this.listening=false;this.error=e.message;this.log(`Wall video: cannot listen on port ${this.port}: ${e.message}`)});
  return new Promise(resolve=>{server.listen(this.port,this.host,()=>{this.listening=true;this.error=null;this.port=server.address().port;resolve(this)});server.once('error',()=>resolve(this));this.server=server});
 }
 ingest(req,socket,head){
  const from=req.socket.remoteAddress??'';let url;try{url=new URL(req.url,'http://x')}catch{return refuse(socket,'400 Bad Request','Bad URL')}
  if(url.pathname!=='/wall/in')return refuse(socket,'404 Not Found','The wall video ingest is /wall/in');
  if(!loopback(from)&&!this.allowed(from)){this.counts.refused++;this.log(`Wall video: refused a sender from ${from} (not this Mac and not in the OSC allowlist)`);return refuse(socket,'403 Forbidden','This address is not allowed: add it to StageLight\'s OSC allowlist (show network)')}
  const ws=upgrade(req,socket,head,{maxMessage:MAX_FRAME});if(!ws)return;
  if(this.source){const old=this.source;old.replaced=true;old.ws.close(1000,'Replaced by a new sender');this.dropSource(old)}
  const src={ws,address:from,hello:null,connectedAt:new Date().toISOString(),pings:new Map(),nextPing:1,timer:null,quick:null,ticks:0,armed:null};this.source=src;this.counts.senders++;
  this.sync=new ClockSync();this.offset=null;this.last=null;this.arrivals=[];this.latency=[];
  ws.on('message',(data,binary)=>{try{binary?this.frame(src,data):this.control(src,data)}catch(e){this.log('Wall video: '+e.message)}});
  ws.on('close',()=>{if(this.source===src)this.dropSource(src)});ws.on('error',()=>{});
  this.log(`Wall video: sender connected from ${from}`);
  this.sendHello(src);this.reportViewers(true);
  // Clock sync: five quick pings, then the 250 ms housekeeping tick pings once a second.
  let n=0;const quick=()=>{if(this.source!==src)return;this.ping(src);if(++n<5){src.quick=setTimeout(quick,100);src.quick.unref?.()}};quick();
  src.timer=setInterval(()=>{try{this.housekeep(src)}catch(e){this.log('Wall video: '+e.message)}},250);src.timer.unref?.();
  this.onSource(this.sourceInfo());this.toViews({t:'source',connected:true,hello:null});
 }
 dropSource(src){
  clearInterval(src.timer);clearTimeout(src.quick);if(this.source!==src)return;this.source=null;this.setLive(false);
  if(!src.replaced)this.log('Wall video: sender disconnected');this.onSource(null);this.toViews({t:'source',connected:false});
 }
 sendHello(src){src.armed=this.armed();src.ws.json({t:'hello',app:'StageLight',version:this.version,protocol:PROTOCOL,armed:src.armed})}
 ping(src){const id=src.nextPing++,s=this.now();src.pings.set(id,s);if(src.pings.size>20)src.pings.delete(src.pings.keys().next().value);src.ws.json({t:'ping',id,s})}
 control(src,text){
  let m;try{m=JSON.parse(text)}catch{return}if(!m||typeof m!=='object')return;
  if(m.t==='hello'){src.hello=cleanHello(m);this.onSource(this.sourceInfo());this.toViews({t:'source',connected:true,hello:src.hello});if(m.protocol!==undefined&&m.protocol!==PROTOCOL)this.log(`Wall video: the sender speaks protocol ${m.protocol}; this StageLight speaks ${PROTOCOL}`);return}
  if(m.t==='pong'&&typeof m.id==='number'){const s=src.pings.get(m.id);if(s===undefined||m.s!==s)return;src.pings.delete(m.id);const at=this.now();this.sync.add(s,Number(m.l),at);const best=this.sync.best();
   if(best&&(!this.offset||best!==this.offset.sample)){this.offset={sample:best,offset:best.offset,rtt:best.rtt};this.toViews({t:'sync',offset:r1(best.offset*100)/100,rtt:r1(best.rtt*100)/100})}}
 }
 frame(src,buf){
  const h=parseFrame(buf);if(!h||h.version!==PROTOCOL||!h.width||!h.height||!Number.isFinite(h.stamp)){this.counts.invalid++;return}
  const at=this.now();this.counts.received++;if(this.last&&h.seq>this.last.seq+1)this.counts.senderGaps+=h.seq-this.last.seq-1;
  this.last={...h,at};this.lastFrameAt=at;this.arrivals.push({at,bytes:buf.length});while(this.arrivals.length&&at-this.arrivals[0].at>2000)this.arrivals.shift();
  if(this.armed())return;
  let sent=0;for(const v of this.views){if(!v.on)continue;if(v.ws.bufferedAmount>512*1024){this.counts.viewDrops++;continue}if(v.ws.send(buf))sent++}
  if(sent){this.counts.relayed+=sent;this.setLive(true)}
 }
 setLive(on){if(this.live===on)return;this.live=on;try{this.onLive(on)}catch{}}
 // Every 250 ms while a sender is connected: armed changes, viewer count, a stopped feed, the clock ping and stats.
 housekeep(src){
  const at=this.now();src.ticks++;
  if(this.armed()!==src.armed){this.sendHello(src);this.reportViewers()}
  if(this.live&&at-this.lastFrameAt>1000)this.setLive(false);
  if(src.ticks%4)return;
  this.ping(src);this.reportViewers();
  if(at-this.lastFrameAt<2000)src.ws.json({t:'stats',...this.stats(at)});
 }
 stats(at=this.now()){
  while(this.latency.length&&at-this.latency[0].at>2000)this.latency.shift();while(this.arrivals.length&&at-this.arrivals[0].at>2000)this.arrivals.shift();
  const l=spread(this.latency.map(x=>x.v)),n=this.arrivals.length,span=n>1?(this.arrivals[n-1].at-this.arrivals[0].at)/1000:0;
  return {fps:r1(n>1&&span>0?(n-1)/span:0),latency:r1(l?.median),jitter:r1(l?.jitter),delay:l?r1(l.median+this.manual):null,offset:this.offset?r1(this.offset.offset):null};
 }
 viewerCount(){if(this.armed())return 0;let n=0;for(const v of this.views)if(v.on)n++;return n}
 reportViewers(force=false){const n=this.viewerCount();if(!this.source||(!force&&n===this.reported))return;this.reported=n;this.source.ws.json({t:'viewers',n})}
 // A StageLight window's socket (server.mjs checks host and origin before handing it here).
 view(req,socket,head){
  const ws=upgrade(req,socket,head,{maxMessage:64*1024});if(!ws)return;const v={ws,id:++this.viewSeq,on:false};this.views.add(v);
  ws.on('message',(data,binary)=>{if(!binary)try{this.fromView(v,data)}catch{}});
  ws.on('close',()=>{this.views.delete(v);if(v.on)this.reportViewers()});ws.on('error',()=>{});
  ws.json({t:'hello',protocol:PROTOCOL,view:v.id,manual:this.manual,probe:{enabled:this.probe.enabled,threshold:this.probe.threshold}});
  if(this.source){ws.json({t:'source',connected:true,hello:this.source.hello});if(this.offset)ws.json({t:'sync',offset:r1(this.offset.offset*100)/100,rtt:r1(this.offset.rtt*100)/100})}
 }
 fromView(v,text){
  const m=JSON.parse(text);if(!m||typeof m!=='object')return;
  if(m.t==='view'){v.on=!!m.on;this.reportViewers();if(!this.viewerCount()&&this.live)this.setLive(false)}
  else if(m.t==='ping'&&typeof m.v==='number')v.ws.json({t:'pong',id:m.id,v:m.v,s:this.now()});
  else if(m.t==='lat'&&Array.isArray(m.s)){const at=this.now();for(const x of m.s.slice(0,200))if(typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000)this.latency.push({at,v:x});if(this.latency.length>2000)this.latency.splice(0,this.latency.length-2000)}
  else if(m.t==='step'&&this.probe.enabled&&['video','light'].includes(m.kind)&&typeof m.at==='number'){this.probe.steps.push({kind:m.kind,up:!!m.up,at:m.at,view:v.id});if(this.probe.steps.length>64)this.probe.steps.splice(0,this.probe.steps.length-64)}
 }
 toViews(m){const s=JSON.stringify(m);for(const v of this.views)v.ws.send(s)}
 sourceInfo(){return this.source?{connected:true,...(this.source.hello??{})}:null}
 setManual(ms){
  this.manual=Math.max(-MANUAL_LIMIT,Math.min(MANUAL_LIMIT,Math.round(ms)));this.toViews({t:'manual',ms:this.manual});
  if(this.file)try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({manual:this.manual})+'\n')}catch(e){this.log('Wall video: could not save the light offset: '+e.message)}
  return this.manual;
 }
 setProbe({enabled,threshold}){if(enabled!==undefined){this.probe.enabled=enabled;if(enabled)this.probe.steps=[]}if(threshold!==undefined)this.probe.threshold=threshold;this.toViews({t:'probe',enabled:this.probe.enabled,threshold:this.probe.threshold})}
 status(){
  const at=this.now(),s=this.stats(at),last=this.last,src=this.source,showing=[...this.views].filter(v=>v.on).length,bytes=this.arrivals.reduce((a,x)=>a+x.bytes,0),n=this.arrivals.length,span=n>1?(this.arrivals[n-1].at-this.arrivals[0].at)/1000:0;
  return {
   listening:this.listening,port:this.port,ingest:`ws://<this Mac>:${this.port}/wall/in`,relay:'/api/wall',...(this.error?{error:this.error}:{}),
   connected:!!src,feed:this.live?'live':src?(last&&at-this.lastFrameAt<1000?'arriving, no window showing it':'no feed'):'no sender',
   sender:src?{address:src.address,connectedAt:src.connectedAt,hello:src.hello}:null,armed:this.armed(),
   viewers:{windows:this.views.size,showing,reported:this.reported??0},
   fps:s.fps,latency:s.latency,jitter:s.jitter,delay:s.delay,manual:this.manual,offset:s.offset,rtt:this.offset?r1(this.offset.rtt*100)/100:null,
   frames:{...this.counts},bytesPerSecond:Math.round(n>1&&span>0?bytes/span:0),
   last:last?{seq:last.seq,width:last.width,height:last.height,codec:last.codec===2?'webp':'jpeg',frozen:!!(last.flags&1),noScene:!!(last.flags&2),bytes:last.bytes,ageMs:Math.round(at-last.at),senderMs:r1(last.sentAt-last.stamp)}:null,
   probe:{enabled:this.probe.enabled,threshold:this.probe.threshold,steps:pairSteps(this.probe.steps)},
   note:'latency = median over 2 s of shownAt − (stamp − offset) as drawn by the windows; delay = latency + manual (positive manual = lights later). Rehearsal only: frames are not drawn and viewers read 0 while output is armed.'
  };
 }
 close(){for(const v of this.views)v.ws.terminate();this.views.clear();if(this.source){const s=this.source;s.ws.terminate();this.dropSource(s)}try{this.server?.close()}catch{}}
}
