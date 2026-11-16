import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {connect,acceptKey,upgrade} from '../engine/ws.mjs';
import {WallLink,parseFrame,encodeFrame,ClockSync,spread,pairSteps,clockNow,MAX_FRAME} from '../engine/wall.mjs';
import {startSender,jpegSize} from '../scripts/wall-test-sender.mjs';
import {LightHistory,parseHeader} from '../public/wall-video.js';
import {Engine} from '../engine/engine.mjs';
import {RuntimeStream} from '../engine/stream.mjs';
// Wall video link (docs/WALL-VIDEO.md): the WebSocket, the frame header, the clock offset, the relay and the light history.
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=3000){const end=Date.now()+ms;for(;;){const v=fn();if(v)return v;if(Date.now()>end)throw Error('Timed out waiting');await wait(10)}}
const messages=ws=>{const list=[];ws.on('message',(d,binary)=>list.push(binary?d:JSON.parse(d)));return list};
// An echo server on an ephemeral port: what it receives as text it sends back as text, binary as binary.
async function echoServer(opts){const s=http.createServer();s.on('upgrade',(req,socket,head)=>{const ws=upgrade(req,socket,head,opts);ws?.on('message',(d,b)=>ws.send(b?d:String(d)))});await new Promise(r=>s.listen(0,'127.0.0.1',r));return s}
test('WebSocket handshake accept key matches RFC 6455',()=>{assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='),'s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')});
test('WebSocket carries text and binary messages of every length class, and answers pings',async()=>{
 const s=await echoServer();try{
  const ws=await connect(`ws://127.0.0.1:${s.address().port}/`),got=[];ws.on('message',(d,binary)=>got.push({d,binary}));
  ws.send('hello · ünïcode');const sent=[crypto.randomBytes(100),crypto.randomBytes(1000),crypto.randomBytes(70000)];for(const b of sent)ws.send(b);
  await until(()=>got.length===4);assert.deepEqual(got[0],{d:'hello · ünïcode',binary:false});
  sent.forEach((b,i)=>{assert.equal(got[i+1].binary,true);assert.equal(Buffer.compare(got[i+1].d,b),0,`binary message of ${b.length} bytes`)});
  const pong=new Promise(r=>ws.once('pong',r));ws.ping(Buffer.from('x'));assert.equal(String(await pong),'x');
  const closed=new Promise(r=>ws.once('close',(code)=>r(code)));ws.close(1000,'done');assert.equal(await closed,1000);
 }finally{s.close()}
});
test('WebSocket reassembles fragmented messages, refuses unmasked client frames and oversized messages',async()=>{
 const s=await echoServer({maxMessage:1000});try{
  // Raw socket: handshake by hand, then a text message in two fragments (masked), then an unmasked frame.
  const sock=net.connect(s.address().port,'127.0.0.1');await new Promise(r=>sock.once('connect',r));
  sock.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  let buf=Buffer.alloc(0);sock.on('data',d=>buf=Buffer.concat([buf,d]));await until(()=>buf.includes('\r\n\r\n'));assert.match(buf.toString(),/101 Switching/);buf=buf.subarray(buf.indexOf('\r\n\r\n')+4);
  const frame=(fin,op,payload,mask=true)=>{const m=crypto.randomBytes(4),p=Buffer.from(payload);const head=Buffer.from([(fin?0x80:0)|op,(mask?0x80:0)|p.length]);return Buffer.concat([head,mask?m:Buffer.alloc(0),mask?p.map((x,i)=>x^m[i&3]):p])};
  sock.write(frame(false,1,'hel'));sock.write(frame(true,0,'lo'));
  await until(()=>buf.length>=7);assert.equal(buf[0],0x81);assert.equal(buf.subarray(2,7).toString(),'hello');buf=buf.subarray(7);
  sock.write(frame(true,1,'no mask',false));await until(()=>buf.length>=4);assert.equal(buf[0],0x88);assert.equal(buf.readUInt16BE(2),1002);sock.destroy();
  const ws=await connect(`ws://127.0.0.1:${s.address().port}/`),closed=new Promise(r=>ws.once('close',c=>r(c)));ws.send(Buffer.alloc(1001));assert.equal(await closed,1009);
 }finally{s.close()}
});
test('Frame header round-trips: magic, version, codec, size, flags, seq and the two stamps',()=>{
 const img=Buffer.from([0xff,0xd8,1,2,3,0xff,0xd9]),b=encodeFrame({codec:1,width:1024,height:256,flags:3,seq:41,stamp:1763317000123.4,sentAt:1763317000140.25},img);
 assert.equal(b.length,32+img.length);assert.equal(b.toString('latin1',0,4),'LSWV');
 assert.deepEqual(parseFrame(b),{version:1,codec:1,width:1024,height:256,flags:3,seq:41,stamp:1763317000123.4,sentAt:1763317000140.25,bytes:img.length});
 const view=parseHeader(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));assert.equal(view.stamp,1763317000123.4);assert.equal(view.width,1024);assert.equal(view.seq,41);
 assert.equal(parseFrame(Buffer.from('JUNK'.repeat(10))),null);assert.equal(parseFrame(Buffer.alloc(10)),null);
 assert.deepEqual(jpegSize(fs.readFileSync('tests/fixtures/wall/bars.jpg')),{width:256,height:64});
});
test('Clock offset: offset = l − (s + rtt/2), the smallest round trip of the last 10 s wins',()=>{
 const c=new ClockSync();c.add(1000,1105,1010);c.add(2000,2101,2002);c.add(3000,3110,3030);
 assert.deepEqual(c.best(),{at:2002,rtt:2,offset:100});c.prune(12500);assert.equal(c.best().at,3030,'samples older than 10 s are dropped');
 assert.equal(c.add(5000,1,4000),null,'a negative round trip is ignored');
 const s=spread([40,42,44,46,48,50,52,54,56,58,60]);assert.equal(s.median,50);assert.equal(s.jitter,16);
});
test('Sync probe pairs each video step with the nearest light step of the same direction from the same window',()=>{
 const p=pairSteps([{kind:'video',up:true,at:1000,view:1},{kind:'light',up:true,at:1012,view:1},{kind:'light',up:true,at:1013,view:2},{kind:'light',up:false,at:1001,view:1},{kind:'video',up:false,at:3000,view:1}]);
 assert.deepEqual(p,[{up:true,view:1,videoStepAt:1000,lightStepAt:1012,diff:12},{up:false,view:1,videoStepAt:3000,lightStepAt:null,diff:null}]);
});
test('Light history: holds each state until the next, counts a change from half a tick before its stamp, keeps 1 s',()=>{
 const h=new LightHistory(),a=[{id:'1',intensity:0}],b=[{id:'1',intensity:1}],c=[{id:'1',intensity:.5}];
 h.push(a,-Infinity);h.push(b,1000);h.push(c,1033.3);
 assert.equal(h.at(500),a);assert.equal(h.at(980),a);assert.equal(h.at(990),b,'within half a tick (16.7 ms) of the entry');assert.equal(h.at(1020),c);assert.equal(h.at(5000),c);
 h.push(c,1066);assert.equal(h.list.length,3,'the same frames again add nothing');
 for(let t=1100;t<3000;t+=100)h.push([...c],t);assert.ok(h.list.length<=12,'older than 1 s is dropped');assert.equal(h.at(0),h.list[0].frames);
 h.push(a,10);assert.equal(h.list.length,1,'a clock that jumps back (engine restart) starts over');
});
// A view server like server.mjs's /api/wall, for a WallLink on ephemeral ports.
async function rig(opts={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wall-'));let armed=false,live=[];const logs=[];
 const link=new WallLink({port:0,host:'127.0.0.1',version:'9.9.9',dataDir:dir,armed:()=>armed,log:m=>logs.push(m),onLive:on=>live.push(on),...opts});await link.listen();
 const views=http.createServer();views.on('upgrade',(req,socket,head)=>link.view(req,socket,head));await new Promise(r=>views.listen(0,'127.0.0.1',r));
 const view=async()=>{const ws=await connect(`ws://127.0.0.1:${views.address().port}/api/wall`);return {ws,got:messages(ws)}};
 return {link,view,dir,logs,live,arm:v=>armed=v,close(){link.close();views.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
test('Relay: the sender hears hello and viewers, frames reach showing windows byte for byte, the clock offset is measured',async()=>{
 const r=await rig();let s;try{
  const v=await r.view();await until(()=>v.got.some(m=>m.t==='hello'));assert.equal(v.got[0].manual,0);
  s=await startSender({port:r.link.port,fps:50,skew:120});
  await until(()=>s.state.hello);assert.equal(s.state.hello.app,'StageLight');assert.equal(s.state.hello.protocol,1);assert.equal(s.state.hello.armed,false);
  await until(()=>s.state.viewers===0&&r.link.source?.hello);assert.equal(s.state.sent,0,'nothing is captured while no window shows the stream');
  v.ws.json({t:'view',on:true});await until(()=>s.state.viewers===1);
  const frames=await until(()=>{const f=v.got.filter(Buffer.isBuffer);return f.length>=5&&f});
  const h=parseFrame(frames[0]);assert.equal(h.width,256);assert.equal(h.height,64);assert.equal(Buffer.compare(frames[0].subarray(32),fs.readFileSync('tests/fixtures/wall/bars.jpg')),0,'the image bytes are relayed unchanged');
  assert.ok(parseFrame(frames[4]).seq>h.seq);assert.deepEqual(r.live,[true],'the fast light stream starts with the feed');
  await until(()=>s.state.pings>=5);const sync=await until(()=>v.got.find(m=>m.t==='sync'));assert.ok(Math.abs(sync.offset-120)<5,`offset ${sync.offset} ≈ the sender's 120 ms skew`);
  assert.deepEqual(v.got.find(m=>m.t==='source'&&m.hello)?.hello.app,'LiveStage');
  // The window reports what it measured; the sender gets stats once a second.
  v.ws.json({t:'lat',s:[44,46,48,46,45]});await until(()=>s.state.stats?.latency!=null,2500);
  const st=r.link.status();assert.equal(st.connected,true);assert.equal(st.feed,'live');assert.equal(st.latency,46);assert.equal(st.delay,46);assert.ok(st.fps>20);assert.ok(st.frames.received>=5);assert.ok(st.frames.relayed>=5);assert.ok(st.bytesPerSecond>0);assert.equal(st.viewers.showing,1);assert.equal(st.sender.hello.app,'LiveStage');
  // Manual offset: applied to delay, told to the windows, saved per computer.
  r.link.setManual(30);await until(()=>v.got.some(m=>m.t==='manual'&&m.ms===30));assert.equal(r.link.status().delay,76);assert.equal(JSON.parse(fs.readFileSync(path.join(r.dir,'wall-video.json'))).manual,30);
  assert.equal(r.link.setManual(999),200,'the offset is limited to ±200 ms');
  // Window goes away: viewers 0 at once, frames stop.
  v.ws.json({t:'view',on:false});await until(()=>s.state.viewers===0);const sent=s.state.sent;await wait(120);assert.ok(s.state.sent-sent<=2);
 }finally{s?.stop();r.close()}
});
test('Relay: armed output means viewers 0, hello armed:true and no frames to the windows; a new sender replaces the old',async()=>{
 const r=await rig();let a,b;try{
  const v=await r.view();a=await startSender({port:r.link.port,fps:50});v.ws.json({t:'view',on:true});await until(()=>a.state.viewers===1);
  r.arm(true);await until(()=>a.state.hello?.armed===true&&a.state.viewers===0,2000);
  const n=v.got.filter(Buffer.isBuffer).length;a.state.viewers=1;await wait(150);assert.equal(v.got.filter(Buffer.isBuffer).length,n,'nothing is relayed while armed, even if the sender keeps sending');
  r.arm(false);await until(()=>a.state.hello?.armed===false&&a.state.viewers===1,2000);
  b=await startSender({port:r.link.port,fps:50,hello:{scene:'Second'}});await until(()=>a.state.closed);assert.equal(r.link.counts.senders,2);
  await until(()=>r.link.source?.hello?.scene==='Second');assert.equal(r.link.status().sender.hello.scene,'Second');
  b.stop();await until(()=>!r.link.source);assert.equal(r.link.status().feed,'no sender');await until(()=>v.got.some(m=>m.t==='source'&&m.connected===false));
 }finally{a?.stop();b?.stop();r.close()}
});
test('Ingest refuses other paths, oversized frames and senders outside loopback/allowlist',async()=>{
 const r=await rig({allowed:()=>false});try{
  await assert.rejects(connect(`ws://127.0.0.1:${r.link.port}/other`),/404/);
  const ws=await connect(`ws://127.0.0.1:${r.link.port}/wall/in`),closed=new Promise(res=>ws.once('close',c=>res(c)));ws.send(Buffer.alloc(MAX_FRAME+1));assert.equal(await closed,1009);
  // A non-loopback sender is checked against the allowlist (here: allowed() refuses everything).
  const fake={headers:{},url:'/wall/in',method:'GET',socket:{remoteAddress:'10.0.0.77'}};let answer='';r.link.ingest(fake,{end:t=>answer=t,destroy(){}},Buffer.alloc(0));
  assert.match(answer,/403/);assert.equal(r.link.counts.refused,1);assert.match(r.logs.at(-1),/10\.0\.0\.77/);
 }finally{r.close()}
});
test('Engine: wall.video.* commands read and set the link; runtime carries the tick time and the sender; at alone sends nothing',async()=>{
 const e=new Engine();
 assert.equal((await e.command('wall.video.status')).listening,false);await assert.rejects(e.command('wall.video.offset',{ms:10}),/not running/);
 await assert.rejects(e.command('wall.video.offset',{ms:500}),/./,'the schema limits the offset');
 const r=await rig();try{
  e.wall=r.link;assert.equal((await e.command('wall.video.offset',{ms:-25})).manual,-25);
  const p=await e.command('wall.video.probe',{enabled:true,threshold:.4});assert.equal(p.probe.enabled,true);assert.equal(p.probe.threshold,.4);
  e.tick();const rt=e.runtime();assert.equal(typeof rt.at,'number');assert.ok(Math.abs(rt.at-clockNow())<1000);assert.equal('wall' in rt,false,'no wall field without a sender');
  e.wallSource={connected:true,app:'LiveStage'};assert.deepEqual(e.runtime().wall,{connected:true,app:'LiveStage'});
  const st=new RuntimeStream();assert.equal(st.next(e.runtime()).k,'full');e.tick();assert.equal(st.next(e.runtime()),null,'a new tick time alone is not a change');
  e.command('master.set',{value:.5});e.tick();const d=st.next(e.runtime());assert.equal(d.k,'delta');assert.equal(typeof d.at,'number');
 }finally{r.close();await e.close?.()}
});
test('MCP exposes the wall video tools; status is read-only',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await wait(20);child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 assert.equal(by('lights_wall_video_status').annotations.readOnlyHint,true);assert.ok(by('lights_wall_video_offset').inputSchema.properties.ms);assert.ok(by('lights_wall_video_probe').inputSchema.properties.threshold);
});
