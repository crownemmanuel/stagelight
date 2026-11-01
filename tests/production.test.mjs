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
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'}});const io=e.mods.io,sent=[];const send=io.send.bind(io);await until(()=>io.devices&&e.mods.sound.opened);io.send=m=>{sent.push(m);send(m)};
 // mute: the fake helper's own audio replies are dropped, so the test plays the helper's answers itself.
 const receive=io.receive.bind(io);if(mute)io.receive=line=>{if(!/"ev":"audio"/.test(line))receive(line)};
 const say=m=>receive(JSON.stringify(m));return {...r,io,sent,say,restore:async()=>{Object.assign(TIMING,saved);if(e.mods){await e.mods.close();e.mods=null}}}};

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

// ── Getting the look back after a restart or a network fault (operator, 2026-11-01) ──
test('arming with keepLook sends the running look as it is; without it, arming over running cues is refused with the way out',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('c',['401'])});await e.command('cue.play',{id:'c'});await e.command('fixture.set',{ids:['402'],values:{intensity:.5}});
 await assert.rejects(e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'}),/keepLook:true/);assert.equal(e.output.armed,false);
 await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT',keepLook:true});at(.1);assert.equal(e.output.armed,true);assert.equal(frame('401').intensity,1,'the cue keeps running');assert.equal(frame('402').intensity,.5,'and the manual change');
 assert.ok(e.logs.some(l=>/Armed with the current look · c/.test(l.message)));
});

test('a restart while armed (look held) offers Resume, which brings back every running cue, levels, the programmer and kills, arming last and firing no sends',async()=>{
 const dir=tmp();try{
  const {e,at}=rig({dataDir:dir});await e.command('master.set',{value:1});
  await e.command('cue.save',{cue:look('base',['401','402','403'],{intensity:.6})});await e.command('cue.save',{cue:look('hit',['402'])});await e.command('cue.save',{cue:{id:'beat',name:'beat',duration:8,loop:true,tracks:[{fixtures:['301'],effect:'static',start:4,duration:4,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0}]}});
  await e.command('page.save',{page:{id:'song',name:'Song',cues:[{id:'e1',cue:'base',fade:0,follow:'manual',send:[{message:'midi',note:60}]}]}});
  await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});await e.command('cue.play',{id:'beat'});await e.command('page.go',{id:'song'});await e.command('masters.assign',{slot:'m4',cue:'hit',action:'toggle'});await e.command('masters.trigger',{slot:'m4',down:true});await e.command('masters.level',{slot:'m4',level:.4});
  await e.command('fixture.set',{ids:['404'],values:{intensity:.25}});await e.command('group.save',{id:'g403',name:'g403',fixtures:['403']});await e.command('kill.set',{group:'g403'});
  at(5);const before=e.frames.map(f=>[f.id,f.intensity]).filter(([,i])=>i>0);
  await e.close();
  const b=new Engine({dataDir:dir,output:output(),clock:()=>5});const r=b.runtime().resume;assert.ok(r,'offered after a deliberate restart while armed');assert.equal(r.reason,'restart');
  assert.deepEqual(r.running,['beat','base','hit']);assert.equal(r.overrides,1);assert.equal(r.kills,1);
  const notes=[];b.mods={midi:{note:n=>notes.push(n)},changed(){},live(){return {}},health(){return []}};
  await b.command('resume.apply',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});b.mods=null;
  assert.equal(b.output.armed,true);assert.deepEqual(notes,[],'no MIDI note to ProPresenter on resume');assert.equal(b.runtime().stack.entry,'e1');
  assert.deepEqual(b.running().map(x=>[x.cue.id,x.master??null]),[['beat',null],['base',null],['hit','m4']]);assert.ok(Math.abs(b.sourceTime(b.running()[0],true)-5)<.01,'the beat cue carries on from where it was');
  assert.deepEqual(b.runtime().masters.levels,{m4:.4});b.tick();assert.deepEqual(b.frames.map(f=>[f.id,f.intensity]).filter(([,i])=>i>0),before,'the same look as before the restart');
  await b.close();assert.ok(new Engine({dataDir:dir,output:output()}).runtime().resume,'stopped while armed again: offered again');
  const st=JSON.parse(fs.readFileSync(path.join(dir,'live-state.json'),'utf8'));st.at=new Date(Date.now()-31*60e3).toISOString();fs.writeFileSync(path.join(dir,'live-state.json'),JSON.stringify(st));
  assert.equal(new Engine({dataDir:dir,output:output()}).runtime().resume,null,'a held restart more than 30 minutes old is not offered');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

// ── Intensity limits: the face lights never above 12% (operator rule, enforced in the engine since 2026-11-01) ──
test('a group limit caps output after the master over cues, Highlight, programmer and preview; blackout and kills still win',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('group.save',{id:'face',name:'Face',fixtures:['301','302','303']});await e.command('group.save',{id:'wide',name:'Wide',fixtures:['303','401']});
 await e.command('limit.set',{group:'face',max:.12});await e.command('limit.set',{group:'wide',max:.5});
 await e.command('cue.save',{cue:look('bright',['301','302','303','401'],{intensity:.9})});await e.command('cue.play',{id:'bright'});at(.1);
 assert.deepEqual(['301','302','303','401'].map(id=>frame(id).intensity),[.12,.12,.12,.5],'each fixture takes its lowest limit');
 await e.command('fixture.set',{ids:['301'],values:{intensity:1}});await e.command('selection.set',{ids:['302']});await e.command('highlight.set',{enabled:true});at(.2);assert.equal(frame('301').intensity,.12);assert.equal(frame('302').intensity,.12,'Highlight is capped too');
 await e.command('highlight.set',{enabled:false});await e.command('preview.cue',{id:'bright'});at(.3);assert.equal(e.previewFrames.find(f=>f.id==='301').intensity,.12,'the preview shows what will go out');await e.command('preview.stop');
 await e.command('master.set',{value:.5});at(.4);assert.equal(frame('303').intensity,.12,'under the limit after the master: unchanged (.9 × .5 = .45 → .12)');assert.equal(frame('401').intensity,.45);
 await e.command('blackout.set',{enabled:true});at(.5);assert.equal(frame('301').intensity,0);await e.command('blackout.set',{enabled:false});
 await e.command('limit.set',{group:'wide'});assert.deepEqual(e.show.limits,[{group:'face',max:.12}],'no max removes it');at(.6);assert.equal(frame('401').intensity,.45);
 assert.match((await e.command('show.check',{network:false})).rows.find(r=>r.id==='limits').detail,/Face at most 12% \(3 fixtures\)/);
 await e.command('group.delete',{id:'face'});assert.deepEqual(e.show.limits,[],'deleting a group drops its limit');
 await assert.rejects(e.command('limit.set',{group:'nope',max:.1}),/Unknown group/);
 await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('limit.set',{group:'wide',max:.2}),/performance lock/);
});

test('the face lights are capped at 12% in any show that has the group and never had limits, including the live show\'s Special · light up at 18%',async()=>{
 const {migrate}=await import('../engine/model.mjs');const show=JSON.parse(fs.readFileSync('data/show.json','utf8'));delete show.limits;
 const m=migrate(show);if(!m.groups.some(g=>g.id==='face-lights'))return;assert.deepEqual(m.limits,[{group:'face-lights',max:.12}]);
 const kept=migrate({...structuredClone(show),limits:[]});assert.deepEqual(kept.limits,[],'an operator who removed every limit keeps it that way');
 const {e,at,frame}=rig();e.show=m;e.revision++;const face=e.show.groups.find(g=>g.id==='face-lights').fixtures;await e.command('master.set',{value:1});
 await e.command('cue.save',{cue:look('special',face.slice(0,10),{intensity:.18})});await e.command('cue.play',{id:'special'});at(.1);assert.ok(face.slice(0,10).every(id=>frame(id).intensity===.12));
});

// ── Audit log growth (docs/PRODUCTION-READINESS.md) ──
test('master presses, fader moves, knob turns and sound hits are tallied once a minute; show events still log one by one',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:look('back',['401'])});await e.command('masters.assign',{slot:'m2',cue:'back'});const n=e.logs.length;
 for(let i=0;i<50;i++){await e.command('masters.trigger',{slot:'m2',down:true});await e.command('masters.trigger',{slot:'m2',down:false})}
 for(let i=0;i<30;i++)await e.command('fixture.set',{ids:['402'],values:{intensity:i/30}});for(let i=0;i<20;i++)e.soundHit('m2');
 assert.equal(e.logs.length,n,'nothing logged per press, per knob step or per hit');
 await e.command('page.go',{id:'scene-1'});assert.equal(e.logs.length,n+1,'a GO is still logged');
 e.flushTally();const line=e.logs.at(-1).message;assert.match(line,/^Live controls in the last minute: /);assert.match(line,/masters\.trigger ×100 \(m2 ×100\)/);assert.match(line,/fixture\.set ×30 \(402 ×30\)/);assert.match(line,/flash let go ×50 \(back ×50\)/);assert.match(line,/sound hit ×20/);
 e.flushTally();assert.equal(e.logs.at(-1).message,line,'nothing new: no line');
});

test('the audit log rotates at 2 MB into .previous and new lines land in the fresh file',async()=>{
 const dir=tmp();try{const {e}=rig({dataDir:dir});const f=path.join(dir,'audit.jsonl');
  e.log('first');await wait(30);e.auditBytes=2e6+1;e.log('after rotation');await new Promise(r=>e.audit.write('',r));await wait(30);
  assert.match(fs.readFileSync(f+'.previous','utf8'),/first/);const now=fs.readFileSync(f,'utf8');assert.match(now,/after rotation/);assert.doesNotMatch(now,/first/);
  assert.doesNotMatch(fs.readFileSync(f+'.previous','utf8'),/after rotation/,'the new line did not follow the renamed file');await e.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

// ── Runtime stream deltas (/api/events?delta=1) ──
test('the delta stream rebuilds exactly the runtime a full message would, sends nothing for packet counters, and keeps unchanged frame objects',async()=>{
 const {RuntimeStream}=await import('../engine/stream.mjs');const {mergeRuntime}=await import('../public/stream.js');
 const {e,at}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:{id:'chase',name:'chase',duration:4,loop:true,tracks:[{group:'backlights',effect:'chase',start:0,duration:4,params:{color:'#ff8800',speed:1,brightness:1},fadeIn:0,fadeOut:0}]}});
 const s=new RuntimeStream(),r6=x=>JSON.parse(JSON.stringify(x,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v));let desk=null,late=null,bytes=0,fullBytes=0;
 const step=t=>{at(t);const rt=e.runtime(),m=s.next(rt);if(m){bytes+=JSON.stringify(m).length;desk=mergeRuntime(desk,m);if(late)late=mergeRuntime(late,m)}fullBytes+=JSON.stringify(rt).length;return {rt,m}};
 step(0);await e.command('cue.play',{id:'chase'});for(let i=1;i<=20;i++){const {rt}=step(i/10);assert.deepEqual(desk.frames,r6(rt.frames),'frames match at '+i/10)}
 late=mergeRuntime(null,s.full(e.runtime()));assert.deepEqual(late.frames,desk.frames,'a desk that connects late starts from the same state');
 await e.command('cue.stop',{fade:0});step(3);step(3.1);const {m}=step(3.1);assert.equal(m,null,'settled: nothing sent');
 e.runtime=(orig=>()=>({...orig(),tickCount:999,output:{...orig().output,packets:12345,lastSent:new Date().toISOString()}}))(e.runtime.bind(e));assert.equal(step(3.15).m,null,'packet counters alone send nothing');
 await e.command('preview.cue',{id:'chase'});const p=step(3.3);assert.deepEqual(desk.previewFrames,r6(p.rt.previewFrames));step(3.4);assert.deepEqual(desk.previewFrames,r6(e.runtime().previewFrames));
 await e.command('preview.stop');step(3.5);assert.equal(desk.previewFrames,null);
 const before=desk.frames;await e.command('fixture.set',{ids:['401'],values:{intensity:.5}});const one=step(3.6).m;assert.deepEqual(Object.keys(one.fd),['401'],'one fixture changed: one delta');assert.deepEqual(desk.frames.filter((f,i)=>f!==before[i]).map(f=>f.id),['401'],'every other frame object is kept');
 assert.ok(bytes<fullBytes/5,`deltas are a fraction of full messages (${bytes} vs ${fullBytes})`);
});
test('delta messages carry only changed runtime fields and drop the ones that disappear',async()=>{
 const {RuntimeStream}=await import('../engine/stream.mjs');const {mergeRuntime}=await import('../public/stream.js');const s=new RuntimeStream();
 const base={tickCount:1,master:1,sound:{input:-20},output:{armed:true,packets:1,lastSent:'a',interfaces:[]},frames:[{id:'1',intensity:0}],previewFrames:null};
 let desk=mergeRuntime(null,s.next(base));const m=s.next({...base,tickCount:2,master:.5,output:{...base.output,packets:2,lastSent:'b'}});
 assert.deepEqual(Object.keys(m).sort(),['fd','k','master','tickCount']);desk=mergeRuntime(desk,m);assert.equal(desk.master,.5);assert.deepEqual(desk.sound,{input:-20});
 const {sound,...nosound}=base;desk=mergeRuntime(desk,s.next({...nosound,master:.5}));assert.equal('sound' in desk,false,'removed field is removed');
});

// ── Earlier live-run fixes, re-verified (2026-11-01) ──
test('an edited cue that is running shows the edit at once, without a jump or a re-GO; a Note step chase keeps its place',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});const c={id:'warm',name:'warm',duration:10,loop:true,tracks:[{fixtures:['301'],effect:'static',start:0,duration:10,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0}],look:[{id:'401',values:{intensity:.4}}]};
 await e.command('cue.save',{cue:c});await e.command('cue.play',{id:'warm'});at(3);const before=e.sourceTime(e.playback,true);
 await e.command('cue.save',{cue:{...c,look:[{id:'401',values:{intensity:.9}},{id:'402',values:{intensity:.5}}]}});at(3);
 assert.equal(frame('401').intensity,.9,'the new level is live');assert.equal(frame('402').intensity,.5,'and the new fixture');assert.ok(Math.abs(e.sourceTime(e.playback,true)-before)<1e-9,'no jump');assert.ok(e.playback.controls.has('402'));
 const step={id:'keys',name:'keys',duration:30,loop:true,tracks:[{group:'backlights',effect:'step',start:0,duration:30,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0}]};
 await e.command('cue.save',{cue:step});await e.command('masters.assign',{slot:'m4',cue:'keys',action:'toggle'});await e.command('masters.trigger',{slot:'m4',down:true});
 for(let i=0;i<3;i++)await e.command('masters.step',{slot:'m4'});const n=e.running().find(r=>r.cue.id==='keys').cue.tracks[0].params.step;
 await e.command('cue.save',{cue:{...step,tracks:[{...step.tracks[0],params:{...step.tracks[0].params,color:'#ff0000'}}]}});const r=e.running().find(r=>r.cue.id==='keys').cue.tracks[0].params;
 assert.equal(r.step,n,'the chase stays on its light');assert.equal(r.color,'#ff0000');
});

test('tap tempo: a stray tap changes nothing until the next tap confirms a new count; a tempo far from the cue\'s shows as far with its ratio',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:{id:'b',name:'b',duration:4,loop:true,bpm:120,tracks:[{fixtures:['301'],effect:'static',start:0,duration:4,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0}]}});await e.command('cue.play',{id:'b'});
 for(const t of [0,.5,1,1.5])(at(t),await e.command('tempo.tap'));assert.equal(e.runtime().tempo.bpm,120);assert.equal(e.runtime().tempo.far,false);
 at(2.53);await e.command('tempo.tap');assert.equal(e.runtime().tempo.bpm,120,'one late tap changes nothing');
 at(3.56);await e.command('tempo.tap');assert.ok(Math.abs(e.runtime().tempo.bpm-58.25)<.1,'the next tap confirms the new count');assert.equal(e.runtime().tempo.far,true,'58 BPM against a 120 BPM cue is far');assert.equal(e.runtime().tempo.ratio,.485);
 const anchor=e.runtime().tempo.anchorAt;at(3.9);assert.equal(e.runtime().tempo.anchorAt,anchor,'steady status: no stream churn');
 await e.command('tempo.set',{});assert.equal(e.runtime().tempo.bpm,null);assert.equal(e.runtime().tempo.far,false);
});

test('a strobe faster than two 30 Hz frames per flash is flagged in the pre-show check and, at the live tempo, in runtime.health',async()=>{
 const {e,at}=rig();const strobe=(id,frequency,duty,bpm)=>({id,name:id,duration:8,loop:true,...(bpm?{bpm}:{}),tracks:[{group:'backlights',effect:'strobe',start:0,duration:8,params:{color:'#ffffff',frequency,duty,brightness:1},fadeIn:0,fadeOut:0}]});
 await e.command('cue.save',{cue:strobe('ok',5,.5)});assert.equal((await e.command('show.check',{network:false})).rows.find(r=>r.id==='strobe').state,'pass','5 Hz at 50% is the limit');
 await e.command('cue.save',{cue:strobe('fast',6,.3)});const row=(await e.command('show.check',{network:false})).rows.find(r=>r.id==='strobe');assert.equal(row.state,'warn');assert.match(row.detail,/fast: strobe at 6 Hz and 30% duty flashes for 50 ms/);
 await e.command('cue.save',{cue:strobe('beat',4,.35,120)});await e.command('cue.play',{id:'beat'});at(.1);assert.equal(e.runtime().health.filter(h=>h.id==='strobe').length,0);
 await e.command('tempo.set',{bpm:180});at(.2);assert.match(e.runtime().health.find(h=>h.id==='strobe').message,/beat: strobe at 6 Hz/,'the live tempo makes it too fast');
});

// ── Show file autosave, module reload and desk hot-load: what changes without an engine restart ──
test('the open show file autosaves once edits are quiet for 10 s, at most every 2 minutes, and when the lock goes on; it can be turned off',async()=>{
 const root=tmp();try{let time=0;const e=new Engine({dataDir:path.join(root,'data'),showsDir:path.join(root,'shows'),output:output(),clock:()=>time});
  e.autosaveTick();assert.equal(e.autosaveNow(),false,'no file open: nothing to autosave');
  await e.command('show.save',{name:'WCIMF'});const file=path.join(root,'shows','WCIMF.json');assert.equal(e.runtime().showFile.dirty,false);
  await e.command('cue.save',{cue:look('new',['401'])});e.autosaveTick();time=5;e.autosaveTick();assert.equal(e.runtime().showFile.dirty,true,'still being edited');
  time=11;e.autosaveTick();assert.equal(e.runtime().showFile.dirty,false,'quiet for 10 s: written');assert.ok(JSON.parse(fs.readFileSync(file,'utf8')).cues.some(c=>c.id==='new'));assert.ok(e.logs.some(l=>l.message==='Show autosaved · WCIMF'));
  await e.command('cue.save',{cue:look('second',['402'])});e.autosaveTick();time=30;e.autosaveTick();assert.equal(e.runtime().showFile.dirty,true,'at most every 2 minutes');time=132;e.autosaveTick();assert.equal(e.runtime().showFile.dirty,false);
  await e.command('cue.save',{cue:look('third',['403'])});await e.command('performance.lock',{enabled:true});assert.equal(e.runtime().showFile.dirty,false,'locking for the show saves the file');await e.command('performance.lock',{enabled:false});
  await e.command('show.autosave',{enabled:false});assert.equal(e.runtime().showFile.autosave,false);await e.command('cue.save',{cue:look('fourth',['404'])});time=1000;e.autosaveTick();time=1100;e.autosaveTick();assert.equal(e.runtime().showFile.dirty,true,'off: left for Save');
  assert.equal(new Engine({dataDir:path.join(root,'data'),showsDir:path.join(root,'shows'),output:output()}).runtime().showFile.autosave,false,'the setting is this Mac\'s and survives a restart');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('modules.reload re-imports the module code and restarts the helper, then sound and MIDI carry on',async()=>{
 const {e}=rig();await e.command('cue.save',{cue:look('k',['401'])});await e.command('masters.assign',{slot:'m1',cue:'k',sound:{channel:1}});
 await assert.rejects(e.command('modules.reload'),/No module is on/);
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'},midi:{enabled:true}});const old=e.mods,child=old.io.child;await until(()=>old.io.devices);
 const r=await e.command('modules.reload');assert.equal(r.created.version,1);assert.notEqual(e.mods,old);assert.equal(e.mods.v,'?v=1');assert.equal((await e.command('modules.status')).version,1);
 await until(()=>child.exitCode!==null||child.signalCode!==null);await until(()=>e.mods.io.devices&&e.mods.sound.opened?.ok&&e.mods.midi.apc);
 assert.deepEqual(e.mods.sound.triggers().map(t=>t.id),['m1']);await e.command('modules.set',{sound:{enabled:false},midi:{enabled:false}});
});

test('a desk code change on disk is noticed without a restart and offered to open desks as a reload',async()=>{
 const {watchDesk,deskBuild}=await import('../engine/desk-build.mjs');const dir=tmp();try{
  fs.writeFileSync(path.join(dir,'app.js'),'one');fs.writeFileSync(path.join(dir,'notes.txt'),'x');const seen=[];const w=watchDesk(dir,d=>seen.push(d),{settle:30});const first=w.build();assert.equal(first,deskBuild(dir));
  fs.writeFileSync(path.join(dir,'notes.txt'),'y');await wait(150);assert.equal(seen.length,0,'non-code files are ignored');
  fs.writeFileSync(path.join(dir,'app.js'),'two');await until(()=>seen.length===1);assert.notEqual(seen[0].build,first);assert.equal(w.build(),seen[0].build);w.stop();
  const app=fs.readFileSync('public/app.js','utf8');assert.match(app,/r\.desk\.build!==deskBuild/,'the desk compares and offers a reload');assert.doesNotMatch(app,/r\.desk[^;]*location\.reload\(\)\s*[;}]/,'never reloads by itself on a desk change');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('MCP lists the production-readiness tools with their schemas and read-only hints',async()=>{
 const {spawn}=await import('node:child_process');const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await wait(20);child.kill();
 const tools=Object.fromEntries(JSON.parse(out.split('\n')[0]).result.tools.map(t=>[t.name,t]));
 for(const n of ['masters_status','masters_own','limit_set','modules_reload','show_autosave','output_arm','resume_apply'])assert.ok(tools['lights_'+n],n);
 assert.ok(tools.lights_output_arm.inputSchema.properties.keepLook,'output.arm takes keepLook');assert.equal(tools.lights_masters_status.annotations.readOnlyHint,true);assert.equal(tools.lights_limit_set.annotations.readOnlyHint,false);
 assert.deepEqual(tools.lights_limit_set.inputSchema.required,['group']);
 const {SHOW_EDITS}=await import('../engine/spec.mjs');for(const n of ['masters.own','limit.set'])assert.ok(SHOW_EDITS.has(n),n+' is refused under the performance lock');for(const n of ['show.autosave','modules.reload','masters.status'])assert.ok(!SHOW_EDITS.has(n),n);
});

test('show versions keep the newest 50 and one a day for 90 days, then stop growing',async()=>{
 const {Versions}=await import('../engine/safety.mjs');const dir=tmp();try{const v=new Versions(dir,()=>0);fs.mkdirSync(path.join(dir,'versions'));
  const day=n=>new Date(Date.now()-n*864e5).toISOString().replace(/[:.]/g,'-');for(let n=1;n<=200;n++)fs.writeFileSync(path.join(dir,'versions',`${day(n)}-edits.json`),'{}');
  v.snapshot({version:1},'edits');const left=v.list();assert.ok(left.length<=50+91,`${left.length} kept`);assert.ok(left.every(x=>Date.now()-Date.parse(x.at)<91*864e5),'nothing older than 90 days');assert.ok(left.length>=50);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('an input that opens but never delivers audio is treated as lost once the helper has metered; recording under Highlight respects limits',async()=>{
 const {e,say,sent,restore}=await soundRig({stale:60,reopen:30},{mute:true});try{
  say({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64});await wait(120);assert.deepEqual(e.runtime().health,[],'a helper that never meters is never second-guessed');
  say({ev:'meter',input:-20,levels:{}});sent.length=0;say({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64});await wait(120);
  assert.ok(sent.some(m=>m.op==='audio.close'),'opened, no audio within the stale time: closed and reopened');assert.ok(e.logs.some(l=>/no audio callbacks/.test(l.message)));
 }finally{await restore()}
 const {e:r}=rig();await r.command('master.set',{value:1});await r.command('group.save',{id:'face',name:'Face',fixtures:['301']});await r.command('limit.set',{group:'face',max:.12});
 await r.command('fixture.set',{ids:['301'],values:{intensity:.8}});await r.command('selection.set',{ids:['301']});await r.command('highlight.set',{enabled:true});
 await r.command('cue.record',{id:'rec',name:'rec'});assert.equal(r.show.cues.find(c=>c.id==='rec').look.find(x=>x.id==='301').values.intensity,.12,'a recorded cue never holds a face light above its limit');
});

test('after a helper crash the APC40 and the virtual StageLight port come back on the new helper',async()=>{
 const {e}=rig();const {BACKOFF}=await import('../engine/modules/io.mjs');const saved=[...BACKOFF];BACKOFF.splice(0,4,.05,.05,.05,.05);try{
  await e.command('modules.set',{midi:{enabled:true}});await until(()=>e.mods.midi.apc);const io=e.mods.io,first=io.child,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
  first.kill('SIGKILL');await until(()=>e.mods.midi.apc===null);await until(()=>io.child&&io.child!==first&&e.mods.midi.apc);
  assert.ok(sent.some(m=>m.op==='midi.virtual'&&m.name==='StageLight'),'the virtual port is made again');assert.ok(sent.some(m=>m.op==='midi.open'&&m.id==='apc'),'the APC40 is opened again');
  assert.ok(sent.some(m=>m.op==='midi.send'&&m.port==='apc'),'and put back in Ableton Live mode with its LEDs');assert.ok(e.logs.filter(l=>l.message==='APC40 mkII connected').length>=2);
 }finally{BACKOFF.splice(0,4,...saved);await e.command('modules.set',{midi:{enabled:false}})}
});
