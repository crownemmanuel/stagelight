import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {Output} from '../engine/output.mjs';
// Production readiness (docs/PRODUCTION-READINESS.md): failures seen in the first live run on 2026-10-31/11-01 and the
// failure modes found reviewing for them. No test sends to a network: sockets and helpers are fakes.
process.env.LIGHTS_IO_BIN=path.resolve('tests/fixtures/fake-io.mjs');
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false},async check(){return {ok:true,steps:[]}}});
const rig=opts=>{let time=0;const e=new Engine({output:output(),clock:()=>time,...opts});return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id),time:()=>time}};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lights-prod-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=3000)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('timed out');await wait(10)}};
const look=(id,ids,v={intensity:1})=>({id,name:id,duration:30,loop:true,tracks:[],look:ids.map(f=>({id:f,values:{...v}}))});
// A UDP socket stand-in: bind always works unless told otherwise; send fails while `failing` is set.
const fakeSockets=()=>{const made=[];const state={failing:null,bindError:null};
 const create=()=>{const s={sent:0,closed:false,handlers:{},once(ev,f){this.handlers[ev]=f},removeListener(){},on(ev,f){this.handlers['on'+ev]=f},
  bind(port,addr,cb){if(state.bindError){const e=Error(state.bindError);setImmediate(()=>this.handlers.error?.(e))}else setImmediate(cb)},
  send(p,port,host,cb){if(state.failing){const e=Object.assign(Error('send '+state.failing+' '+host+':'+port),{code:state.failing});setImmediate(()=>cb(e))}else{this.sent++;setImmediate(()=>cb(null))}},close(){this.closed=true}};made.push(s);return s};
 return {made,state,create}};
const config={source:'10.0.0.50',target:'10.0.0.1',mappings:{}};

test('a network blip never disarms output: sends keep going, failures are logged sparingly, and the socket is rebound',async()=>{
 const logs=[],socks=fakeSockets();let now=0;const out=new Output(m=>logs.push(m),{createSocket:socks.create,list:()=>[{address:'10.0.0.50'}],now:()=>now});
 await out.arm(config);assert.equal(out.armed,true);const one=new Map([[0,Buffer.alloc(512)]]),seven=new Map(Array.from({length:7},(_,i)=>[i,Buffer.alloc(512)]));
 out.send(one);await wait(5);assert.equal(out.status().packets,1);assert.equal(out.status().sending,true);
 // 2026-11-01 02:14:57: seven universes failed at once with EADDRNOTAVAIL and output closed itself.
 socks.state.failing='EADDRNOTAVAIL';for(let i=0;i<30;i++){now+=1/30;out.send(seven)}await wait(5);
 assert.equal(out.armed,true,'still armed');assert.equal(out.status().sending,false);assert.ok(out.status().failing.errors>=210);assert.match(out.status().lastError,/EADDRNOTAVAIL/);
 assert.equal(logs.filter(l=>/failing/.test(l)).length,1,'one line for the whole burst, not one per packet');
 for(let i=0;i<30*11;i++){now+=1/30;out.send(seven);await new Promise(r=>setImmediate(r))}await wait(5);
 assert.ok(out.status().rebinds>=1,'rebound after 5 s of failures');assert.ok(socks.made.length>=2);assert.ok(socks.made[0].closed,'the old socket is closed');
 assert.ok(logs.some(l=>/still failing after \d+ s/.test(l)),'a reminder every 10 s at most');assert.ok(logs.filter(l=>/still failing/.test(l)).length<=1);
 socks.state.failing=null;now+=1;out.send(one);await wait(5);assert.equal(out.status().sending,true,'back');assert.equal(out.status().failing,null);assert.ok(logs.some(l=>/sending again after \d+ s/.test(l)));
 out.close();assert.equal(out.armed,false);assert.equal(out.status().sending,false);
});

test('a rebind that resolves after disarm or re-arm is dropped, never doubling the socket',async()=>{
 const socks=fakeSockets();let now=0;const out=new Output(()=>{},{createSocket:socks.create,list:()=>[{address:'10.0.0.50'}],now:()=>now});await out.arm(config);
 socks.state.failing='ENETUNREACH';out.send(new Map([[0,Buffer.alloc(512)]]));await wait(2);now=6;out.send(new Map([[0,Buffer.alloc(512)]]));assert.equal(out.binding,true,'rebinding');
 out.close();await wait(5);assert.equal(out.socket,null,'the late socket is not kept');assert.ok(socks.made.at(-1).closed);
});

test('engine: a failing send shows in output.status, runtime.health and the pre-show check; a tick that throws keeps output armed',async()=>{
 const {e}=rig();const o=e.output;o.status=function(){return {armed:this.armed,packets:0,interfaces:[],sending:!this.fail,failing:this.fail?{since:'2026-11-01T02:14:57.304Z',errors:7}:null,lastError:this.fail?'send EADDRNOTAVAIL 10.0.0.1:6454':null}};
 await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});o.fail=true;
 assert.equal((await e.command('output.status')).sending,false);assert.match((await e.command('output.status')).note,/keeps retrying/);
 assert.equal(e.runtime().health[0].id,'output');assert.equal(e.runtime().health[0].level,'error');
 assert.equal((await e.command('show.check',{network:false})).rows.find(r=>r.id==='output').state,'fail');o.fail=false;assert.deepEqual(e.runtime().health,[]);
 // A tick that throws (here: a broken frame builder) used to close output and log 30 lines a second.
 const real=e.tick.bind(e);let broken=true;e.tick=()=>{if(broken)throw Error('boom');real()};e.timer=null;
 const logs=()=>e.logs.filter(l=>/Engine error/.test(l.message)).length;
 for(let i=0;i<90;i++){try{e.tick();if(e.tickError)e.tickRecovered()}catch(err){e.tickFailed(err)}}
 assert.equal(o.armed,true,'still armed');assert.equal(logs(),1,'logged once');assert.equal(e.tickError.count,90);assert.equal(e.runtime().health.find(h=>h.id==='engine').level,'error');
 broken=false;try{e.tick();if(e.tickError)e.tickRecovered()}catch(err){e.tickFailed(err)}assert.equal(e.tickError,null);assert.ok(e.logs.some(l=>/ticking again after 90 failed frames/.test(l.message)));
});

// ── Sound input and the native helper (docs/MIDI-AND-SOUND.md) ──
const soundRig=async(timing={},{mute=false}={})=>{const {TIMING}=await import('../engine/modules/sound.mjs');const saved={...TIMING};Object.assign(TIMING,timing);
 const r=rig();const {e}=r;await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('pad',['401'])});await e.command('cue.save',{cue:look('kick',['402'])});
 await e.command('masters.assign',{slot:'m2',cue:'pad',sound:{channel:2,band:'full',mode:'follow',sensitivity:.5,rangeDb:24}});await e.command('masters.assign',{slot:'m1',cue:'kick',sound:{channel:1}});
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'}});const io=e.mods.io,sent=[];const send=io.send.bind(io);await until(()=>io.devices&&e.mods.sound.opened);io.send=m=>{sent.push(m);if(!(mute&&m.op==='audio.open'))send(m)};
 // mute: the fake helper never answers audio.open, so the test plays the helper's replies itself.
 const say=m=>io.receive(JSON.stringify(m));return {...r,io,sent,say,restore:async()=>{Object.assign(TIMING,saved);if(e.mods){await e.mods.close();e.mods=null}}}};

test('a lost sound input is closed and reopened until it works, instead of the helper reusing the dead stream',async()=>{
 const {e,say,sent,restore}=await soundRig({reopen:60},{mute:true});try{
  say({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64});say({ev:'meter',input:-20,levels:{}});assert.deepEqual(e.runtime().health,[]);
  // 2026-11-01 02:15:06, nine seconds after the network blip: Dante's device went away under the open stream.
  sent.length=0;say({ev:'error',message:'Audio input: The requested device is no longer available. For example, it has been unplugged.'});
  assert.equal(sent[0]?.op,'audio.close','the dead stream is dropped, so the next open is a fresh one');assert.equal(e.runtime().health[0].id,'sound-input');assert.equal(e.runtime().sound,undefined,'no stale meter');
  assert.ok(e.logs.some(l=>/Sound input lost · Dante Virtual Soundcard/.test(l.message)));
  await until(()=>sent.some(m=>m.op==='audio.open'));say({ev:'audio',ok:false,device:'Dante Virtual Soundcard',error:'“Dante Virtual Soundcard” is not connected'});
  sent.length=0;await until(()=>sent.some(m=>m.op==='audio.open'));say({ev:'audio',ok:false,device:'Dante Virtual Soundcard',error:'“Dante Virtual Soundcard” is not connected'});
  assert.equal(e.logs.filter(l=>/did not open/.test(l.message)).length,1,'the same failure is logged once');
  sent.length=0;await until(()=>sent.some(m=>m.op==='audio.open'));say({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64});
  assert.deepEqual(e.runtime().health,[]);assert.ok(e.logs.some(l=>/Sound input open again/.test(l.message)));const n=sent.length;await wait(150);assert.equal(sent.length,n,'no more retries once open');
 }finally{await restore()}
});

test('a stream whose meter stops is treated as lost; digital silence on the whole input warns; the default input warns',async()=>{
 const {e,say,sent,restore}=await soundRig({stale:80,reopen:40,deadAfter:60},{mute:true});try{
  say({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64});say({ev:'meter',input:-90,levels:{}});await wait(70);say({ev:'meter',input:-90,levels:{}});
  assert.equal(e.runtime().health[0]?.id,'sound-silent','no audio at all for a while: the feed is dead, not quiet');assert.ok((await e.command('show.check',{network:false})).rows.some(r=>r.id==='sound-silent'&&r.state==='warn'));
  say({ev:'meter',input:-35,levels:{}});assert.deepEqual(e.runtime().health,[],'signal clears it');
  sent.length=0;await wait(150);assert.ok(sent.some(m=>m.op==='audio.close'),'meter stopped: closed');assert.ok(e.logs.some(l=>/no audio callbacks/.test(l.message)));
  await until(()=>sent.some(m=>m.op==='audio.open'));
  await e.command('modules.set',{sound:{enabled:true,device:'System default input'}});assert.ok(e.logs.some(l=>l.message==='Sound input device · Dante Virtual Soundcard → System default input'),'a device change is logged with both names');
  assert.ok(e.runtime().health.some(h=>h.id==='sound-default'&&h.level==='warn'));
 }finally{await restore()}
});

test('a follow cue is let go when levels stop arriving and when the module goes off, never left up for good',async()=>{
 const {e,at,frame,say,restore}=await soundRig({silence:120});try{
  say({ev:'level',levels:{m2:-9}});at(.1);assert.equal(frame('401').intensity,1);
  await wait(450);at(.2);assert.ok(!e.running().some(r=>r.cue.id==='pad'),'no level for the silence time: released');assert.ok(e.logs.some(l=>/no level for/.test(l.message)));
  say({ev:'level',levels:{m2:-9}});at(.3);assert.ok(e.running().some(r=>r.cue.id==='pad'));
  await e.command('modules.set',{sound:{enabled:false}});at(.4);assert.ok(!e.running().some(r=>r.cue.id==='pad'),'module off releases it');assert.equal(frame('401').intensity,0);
 }finally{await restore()}
});

test('a native helper that stops on its own is started again and the input reopens; one closed on purpose is not',async()=>{
 const {e,io,restore}=await soundRig();const {BACKOFF}=await import('../engine/modules/io.mjs');const saved=[...BACKOFF];BACKOFF.splice(0,4,.05,.05,.05,.05);try{
  const first=io.child,opens=[];const send=io.send;io.send=m=>{if(m.op==='audio.open')opens.push(m);send(m)};
  first.kill('SIGKILL');await until(()=>io.child&&io.child!==first);assert.ok(e.logs.some(l=>/Restarting the native helper/.test(l.message)));
  await until(()=>opens.length>0);assert.equal(opens[0].device,'Dante Virtual Soundcard','the sound module reopens its input on the new helper');
  assert.equal((await e.command('modules.status')).helper.running,true);
  const c=io.child;await e.command('modules.set',{sound:{enabled:false}});await until(()=>c.exitCode!==null||c.signalCode!==null);await wait(120);assert.equal(e.mods,null);assert.equal(io.child,null,'not restarted after a deliberate stop');
 }finally{BACKOFF.splice(0,4,...saved);await restore()}
});

// ── Masters sharing a cue (live show 2026-11-01: Back Light up on m2 kick, m3 lead follow, m5 tom) ──
test('a flash over the same cue held by another master bumps it to full and on top, and lets go back to that master',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('back',['401','402'])});await e.command('cue.save',{cue:look('red',['401'],{intensity:.5,color:'#ff0000'})});
 for(const slot of ['m2','m3','m5'])await e.command('masters.assign',{slot,cue:'back'});
 await e.command('masters.level',{slot:'m3',level:.3});at(.1);assert.equal(frame('401').intensity,.3,'the lead rides it at 30%');
 await e.command('masters.trigger',{slot:'m2',down:true});at(.2);assert.equal(frame('401').intensity,1,'the kick punches it to full (it used to show nothing)');assert.deepEqual(e.runtime().masters.held,['m2']);
 await e.command('masters.trigger',{slot:'m2',down:false});at(.3);assert.equal(frame('401').intensity,.3,'let go: back to the lead\'s level');assert.ok(e.running().some(r=>r.cue.id==='back'),'and the lead keeps its cue');
 // Over a cue from the cue list, a flash bumps it on top of a newer cue, and never releases it.
 await e.command('masters.level',{slot:'m3',level:0});await e.command('cue.play',{id:'back'});await e.command('masters.trigger',{slot:'m9',down:false}).catch(()=>{});
 await e.command('masters.assign',{slot:'m9',cue:'red'});await e.command('masters.trigger',{slot:'m9',down:true});at(.4);assert.deepEqual(frame('401').color,[1,0,0]);
 await e.command('masters.trigger',{slot:'m5',down:true});at(.5);assert.equal(frame('401').intensity,1);assert.deepEqual(frame('401').color,[1,1,1],'the bumped cue is on top');
 await e.command('masters.trigger',{slot:'m5',down:false});at(.6);assert.ok(e.running().some(r=>r.cue.id==='back'),'a bump never releases a cue it did not start');
 // A second press without a let go (a doubled MIDI note) never leaves a stale bump behind.
 await e.command('masters.trigger',{slot:'m9',down:false});await e.command('masters.trigger',{slot:'m9',down:true});await e.command('masters.trigger',{slot:'m9',down:true});await e.command('masters.trigger',{slot:'m9',down:false});assert.equal(e.bumps.size,0);
});

test('masters.status lists shared cues with a warning, the pre-show check warns, and masters.own gives a master its own copy',async()=>{
 const {e}=rig();await e.command('cue.save',{cue:look('back',['401'])});for(const slot of ['m2','m3','m5'])await e.command('masters.assign',{slot,cue:'back'});
 const st=await e.command('masters.status');assert.deepEqual(st.shared.map(x=>[x.cue,x.numbers]),[['back',[2,3,5]]]);assert.match(st.shared[0].warning,/masters 2, 3, 5/);
 assert.deepEqual(st.slots[1].sharedWith,['m3','m5']);assert.equal(st.slots[1].key,'s');assert.equal(st.slots[1].cueName,'back');
 assert.equal((await e.command('show.check',{network:false})).rows.find(r=>r.id==='masters').state,'warn');
 const r=await e.command('masters.own',{slot:'m3'});assert.equal(r.created.cue,'back-m3');assert.equal(e.show.masters.slots[2].cue,'back-m3');assert.equal(e.show.cues.find(c=>c.id==='back-m3').name,'back · M3');
 assert.deepEqual((await e.command('masters.status')).shared[0].numbers,[2,5]);await assert.rejects(e.command('masters.own',{slot:'m5',id:'back-m3'}),/already exists/);
 await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('masters.own',{slot:'m5'}),/performance lock/);
});
