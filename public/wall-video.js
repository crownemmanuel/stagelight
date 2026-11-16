// Wall video link, window side (docs/WALL-VIDEO.md). LiveStage's preview picture arrives as stamped JPEG frames on
// /api/wall and replaces the LED wall picture; the window shows each frame as soon as it is decoded and draws the lights
// as they were when that frame was rendered (its stamp, mapped to this clock), so a light cue lands with its frame.
// Nothing of this exists until the engine reports a connected sender (runtime.wall): syncWall() is then the only extra
// work in a paint, and Stage.update/animate each check one property. No sender, no socket, no history, no uploads.
const clock=()=>performance.timeOrigin+performance.now();
const HISTORY_MS=1000,STALE_MS=1000,HALF_TICK=1000/60,LINGER_MS=10000;
// Called from each paint with the merged runtime. Returns the receiver to keep (or null).
export function syncWall(cur,stage,r,host,command){
 if(!cur&&!r?.wall)return null;
 if(!stage?.renderer)return null;
 cur??=new WallView(stage,host,command);cur.runtime(r);return cur.closed?null:cur;
}
const median=v=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),q=p=>{const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo)};return {median:q(.5),jitter:q(.9)-q(.1)}};
const best=list=>list.reduce((b,x)=>!b||x.rtt<b.rtt?x:b,null);
export function parseHeader(buf){
 if(buf.byteLength<32)return null;const d=new DataView(buf);if(d.getUint32(0,true)!==0x5657534c)return null;
 return {version:d.getUint8(4),codec:d.getUint8(5),width:d.getUint16(6,true),height:d.getUint16(8,true),flags:d.getUint16(10,true),seq:d.getUint32(12,true),stamp:d.getFloat64(16,true),sentAt:d.getFloat64(24,true)};
}
// The light history: engine frames stamped with the StageLight clock time of the tick that computed them. A message only
// comes when something changed, so an entry holds until the next one; the change it carries happened during the tick
// before it, so a time within half a tick of an entry already counts as that entry. The same frames again (a message
// that changed something else) add nothing.
export class LightHistory{
 constructor(){this.list=[]}
 push(frames,at){const l=this.list;if(l.length&&l[l.length-1].frames===frames)return;if(l.length&&at<l[l.length-1].at-5)l.length=0;l.push({at,frames});const cut=at-HISTORY_MS;while(l.length>2&&l[1].at<=cut)l.shift()}
 at(t){const l=this.list;for(let i=l.length-1;i>=0;i--)if(l[i].at<=t+HALF_TICK)return l[i].frames;return l[0]?.frames??null}
 latest(){return this.list[this.list.length-1]?.frames??null}
 clear(){this.list=[]}
}
class WallView{
 constructor(stage,host,command){
  Object.assign(this,{stage,command,history:new LightHistory(),closed:false,ws:null,on:null,armed:false,source:false,hello:null,offset:0,manual:0,probe:{enabled:false,threshold:.5},
   live:false,decoding:false,pending:null,ready:null,last:null,lastFrameAt:0,shown:[],samples:[],batch:[],sync:[],pingId:0,viewOffset:0,lastOpen:0,gone:0,errors:0,skipped:0,ticks:0});
  const el=this.el=document.createElement('div');el.className='wall-readout';
  el.innerHTML='<span class="wall-text">Wall video · connecting</span><label title="Manual light offset in ms (−200…+200), added to the measured latency. Positive = lights later. Saved on this computer."><span>Lights</span><input type="number" min="-200" max="200" step="5" value="0" aria-label="Wall video light offset in ms"><span>ms</span></label>';
  this.text=el.querySelector('.wall-text');this.input=el.querySelector('input');host.append(el);
  this.input.onchange=()=>{const v=Math.max(-200,Math.min(200,Math.round(+this.input.value||0)));this.input.value=v;this.command?.('wall.video.offset',{ms:v}).catch(()=>{this.input.value=this.manual})};
  this.onVisible=()=>this.report();document.addEventListener('visibilitychange',this.onVisible);
  this.timer=setInterval(()=>{try{this.housekeep()}catch(e){console.error('Wall video',e)}},250);this.open();
 }
 open(){
  this.lastOpen=performance.now();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/wall`);ws.binaryType='arraybuffer';this.ws=ws;
  ws.onopen=()=>{this.on=null;this.report()};
  ws.onmessage=e=>{try{if(typeof e.data==='string')this.control(JSON.parse(e.data));else this.frame(e.data)}catch(err){console.error('Wall video',err)}};
  ws.onclose=()=>{if(this.ws!==ws)return;this.ws=null;this.on=null;this.stop()};
 }
 send(m){if(this.ws?.readyState===1)this.ws.send(JSON.stringify(m))}
 runtime(r){this.armed=!!r.output?.armed;this.hello=r.wall??this.hello;if(r.wall){this.source=true;this.gone=0}else{this.source=false;this.gone||=performance.now()}this.report()}
 // Showing = this window draws the stream: a sender, output not armed, the stage visible. The server counts these as viewers.
 showing(){return this.source&&!this.armed&&!this.stage.paused&&!document.hidden&&this.ws?.readyState===1}
 report(){const on=this.showing();if(on===this.on)return;this.on=on;this.send({t:'view',on});if(!on)this.stop()}
 control(m){
  if(m.t==='hello'){this.manual=m.manual??0;this.probe=m.probe??this.probe;this.paintInput()}
  else if(m.t==='source'){if(m.hello)this.hello={connected:true,...m.hello}}
  else if(m.t==='sync')this.offset=m.offset??0;
  else if(m.t==='manual'){this.manual=m.ms;this.paintInput()}
  else if(m.t==='probe'){this.probe={enabled:m.enabled,threshold:m.threshold};this.lastLuma=null;this.lit=null}
  else if(m.t==='pong'&&typeof m.v==='number'){const at=clock(),rtt=at-m.v;this.sync.push({at,rtt,off:m.s-(m.v+rtt/2)});while(this.sync.length>1&&at-this.sync[0].at>10000)this.sync.shift();this.viewOffset=best(this.sync)?.off??0}
 }
 paintInput(){if(document.activeElement!==this.input)this.input.value=this.manual}
 // Binary: a frame. Decoded one at a time; frames that arrive meanwhile replace each other, so only the newest waits.
 frame(buf){
  if(!this.on)return;const h=parseHeader(buf);if(!h||h.version!==1)return;this.lastFrameAt=performance.now();
  if(this.decoding){if(this.pending)this.skipped++;this.pending={h,buf};return}this.decode(h,buf);
 }
 decode(h,buf){
  this.decoding=true;
  createImageBitmap(new Blob([new Uint8Array(buf,32)],{type:h.codec===2?'image/webp':'image/jpeg'})).then(bmp=>{
   if(!this.on){bmp.close();return}
   if(this.ready){this.ready.bmp.close();this.skipped++}this.ready={h,bmp};
   // First frame of a feed: lights start following the history from now on (Stage.update hands frames to lights()).
   if(!this.live){this.live=true;this.history.clear();if(this.stage.frames)this.history.push(this.stage.frames,-Infinity);this.stage.wall=this;this.stage.snap=true}
   this.stage.dirty=true;
  },()=>{this.errors++}).finally(()=>{this.decoding=false;const p=this.pending;this.pending=null;if(p&&this.on)this.decode(p.h,p.buf)});
 }
 // Engine frames while the feed is live (from Stage.update).
 lights(frames,at){this.history.push(frames,typeof at==='number'?at:clock()+this.viewOffset)}
 // Called by Stage.animate at the start of a frame while the feed is live: the newest decoded picture goes on the wall
 // and the lights are set to the state at that picture's stamp, so both are drawn by the same render.
 present(){
  const rd=this.ready;if(!rd)return;this.ready=null;const {h,bmp}=rd,shownAt=clock()+this.viewOffset;
  if(this.probe.enabled)this.probeVideo(bmp,shownAt);
  this.stage.wallFrame(bmp,h.width,h.height);this.last=h;
  const latency=shownAt-(h.stamp-this.offset),frames=this.history.at(h.stamp-this.offset-this.manual);
  if(frames&&frames!==this.stage.frames){this.stage.frames=frames;this.stage.dirty=true}
  if(this.probe.enabled&&frames)this.probeLights(frames,shownAt);
  const now=performance.now();this.shown.push(now);this.samples.push({at:now,v:latency});this.batch.push(Math.round(latency*10)/10);
 }
 probeVideo(bmp,at){
  const c=this.probeCanvas??=Object.assign(document.createElement('canvas'),{width:8,height:4}),ctx=this.probeCtx??=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(bmp,0,0,8,4);const d=ctx.getImageData(0,0,8,4).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
  const luma=sum/(d.length/4)/255,th=this.probe.threshold,prev=this.lastLuma;this.lastLuma=luma;
  if(prev!=null&&(prev<th)!==(luma<th))this.send({t:'step',kind:'video',up:luma>=th,at});
 }
 probeLights(frames,at){
  if(frames===this.probeFrames)return;this.probeFrames=frames;const th=this.probe.threshold,lit=new Set();for(const f of frames)if((f.intensity??0)>=th)lit.add(f.id);
  const prev=this.lit;this.lit=lit;if(!prev)return;let up=false,down=false;for(const id of lit)if(!prev.has(id)){up=true;break}for(const id of prev)if(!lit.has(id)){down=true;break}
  if(up)this.send({t:'step',kind:'light',up:true,at});if(down)this.send({t:'step',kind:'light',up:false,at});
 }
 // The feed stopped, output was armed or the window stopped showing it: lights go live again, the wall back to its media.
 stop(){
  this.ready?.bmp.close();this.ready=null;this.pending=null;if(!this.live)return;this.live=false;
  const latest=this.history.latest();this.history.clear();this.stage.wall=null;this.stage.snap=false;if(latest){this.stage.frames=latest;this.stage.dirty=true}
  this.stage.wallEnd();this.lastLuma=null;this.lit=null;this.probeFrames=null;
 }
 housekeep(){
  const now=performance.now();this.ticks++;
  if(this.live&&now-this.lastFrameAt>STALE_MS)this.stop();
  this.report();
  if(!this.ws&&this.source&&now-this.lastOpen>2000)this.open();
  if(!this.source&&this.gone&&now-this.gone>LINGER_MS)return this.close();
  if(this.ticks%4)return;
  if(this.ws?.readyState===1&&this.source){this.send({t:'ping',id:++this.pingId,v:clock()});if(this.batch.length){this.send({t:'lat',s:this.batch});this.batch=[]}}
  while(this.samples.length&&now-this.samples[0].at>2000)this.samples.shift();while(this.shown.length&&now-this.shown[0]>2000)this.shown.shift();
  this.paintReadout();
 }
 paintReadout(){
  let t;
  if(!this.source)t='Wall video · sender gone';
  else if(this.armed)t='Wall video · paused while output is armed';
  else if(!this.live)t='Wall video: no feed';
  else{const s=median(this.samples.map(x=>x.v)),n=this.shown.length,fps=n>1?(n-1)/((this.shown[n-1]-this.shown[0])/1000):0,h=this.last;
   t=`Wall video · ${Math.round(fps)} fps${h?` · ${h.width}×${h.height}`:''}${s?` · latency ${Math.round(s.median)} ms ±${Math.round(s.jitter)} · lights +${Math.round(s.median+this.manual)} ms`:''}`}
  if(this.text.textContent!==t)this.text.textContent=t;this.el.classList.toggle('live',this.live);if(this.el.hidden!==!!this.stage.paused)this.el.hidden=!!this.stage.paused;
 }
 close(){this.closed=true;clearInterval(this.timer);document.removeEventListener('visibilitychange',this.onVisible);this.stop();const ws=this.ws;this.ws=null;try{ws?.close()}catch{}this.el.remove()}
}
