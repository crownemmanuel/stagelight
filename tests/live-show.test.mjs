import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {validateShow} from '../engine/spec.mjs';import * as APC from '../engine/controllers/apc40mk2.mjs';
// Tap tempo, master levels, show safety and the sound/MIDI modules (docs/MIDI-AND-SOUND.md, docs/SHOW-SAFETY.md).
process.env.LIGHTS_IO_BIN=path.resolve('tests/fixtures/fake-io.mjs');
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false},async check(){return {ok:true,steps:[]}}});
const rig=opts=>{let time=0;const e=new Engine({output:output(),clock:()=>time,...opts});return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id),time:()=>time}};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lights-live-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=2000)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('timed out');await wait(10)}};
// A 4-second cue authored at 120 BPM whose track turns 301 on from second 2.
const beatCue={id:'beat',name:'Beat',duration:4,loop:false,bpm:120,tracks:[{fixtures:['301'],effect:'static',start:2,duration:2,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0}]};
const look=(id,ids)=>({id,name:id,duration:30,loop:true,tracks:[],look:ids.map(f=>({id:f,values:{intensity:1}}))});

test('tap tempo sets the BPM, scales a cue authored at a BPM, and never makes it jump',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:beatCue});
 for(const t of [0,.25,.5,.75]){at(t);await e.command('tempo.tap')}assert.equal(e.runtime().tempo.bpm,240);assert.equal(e.runtime().tempo.source,'tap');
 at(1);await e.command('cue.play',{id:'beat'});at(1.9);assert.equal(frame('301').intensity,0);at(2.05);assert.equal(frame('301').intensity,1,'double tempo: the second-2 track starts after 1 s');
 const before=e.sourceTime(e.playback,true);await e.command('tempo.set',{bpm:60});assert.ok(Math.abs(e.sourceTime(e.playback,true)-before)<1e-9,'tempo change does not jump');
 at(3.05);assert.ok(Math.abs(e.sourceTime(e.playback,true)-(before+.5))<1e-6,'half tempo runs at half speed');
 await e.command('tempo.set',{});assert.equal(e.runtime().tempo.bpm,null);assert.equal(e.playback.rate,1);
 await e.command('tempo.scale',{factor:2});assert.equal(e.runtime().tempo.bpm,240,'doubles the running cue’s own tempo');await e.command('tempo.nudge',{delta:-20});assert.equal(e.runtime().tempo.bpm,220);
 at(10);await e.command('tempo.tap');at(10.5);await e.command('tempo.tap');assert.equal(e.runtime().tempo.bpm,120,'a gap of more than 2 s starts a new tap');
});

test('tap tempo scales auto-follow waits on a page',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:{...beatCue,id:'a'}});await e.command('cue.save',{cue:{...beatCue,id:'b'}});
 await e.command('page.save',{page:{id:'song',name:'Song',cues:[{id:'e1',cue:'a',fade:0,follow:'auto'},{id:'e2',cue:'b',fade:0,follow:'manual'}]}});
 await e.command('tempo.set',{bpm:240});await e.command('page.go',{id:'song'});at(1.9);assert.equal(e.runtime().stack.entry,'e1');at(2.05);assert.equal(e.runtime().stack.entry,'e2','4 s of cue at double tempo is 2 s');
});

test('a master level scales its own cue; raising its fader from zero starts it and zero releases only what the fader started',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('c301',['301'])});await e.command('cue.save',{cue:look('c401',['401'])});
 await e.command('masters.assign',{slot:'m1',cue:'c301',action:'toggle'});await e.command('cue.play',{id:'c401'});
 await e.command('masters.level',{slot:'m1',level:.5});at(.1);assert.equal(frame('301').intensity,.5,'fader up from zero starts the cue at its level');assert.equal(frame('401').intensity,1,'other cues are untouched');
 await e.command('masters.level',{slot:'m1',level:.25});at(.2);assert.equal(frame('301').intensity,.25);assert.deepEqual(e.runtime().masters.levels,{m1:.25});
 await e.command('masters.level',{slot:'m1',level:0});at(.3);assert.equal(frame('301').intensity,0);assert.ok(!e.running().some(r=>r.cue.id==='c301'),'zero releases what the fader started');
 await e.command('masters.trigger',{slot:'m1',down:true});await e.command('masters.level',{slot:'m1',level:0});at(.4);assert.ok(e.running().some(r=>r.cue.id==='c301'),'a cue the key started stays at level 0');
 await e.command('masters.level',{slot:'m1',level:1});at(.5);assert.equal(frame('301').intensity,1);assert.deepEqual(e.runtime().masters.levels,{});
});

test('a held flash plays at full and on top, whatever its fader says, and lets go back to the fader',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:{id:'c',name:'c',duration:30,loop:true,tracks:[],look:[{id:'301',values:{intensity:1,pan:.2}}]}});
 await e.command('cue.save',{cue:{id:'other',name:'other',duration:30,loop:true,tracks:[],look:[{id:'301',values:{intensity:.3,pan:.8}}]}});await e.command('masters.assign',{slot:'m1',cue:'c'});
 await e.command('masters.level',{slot:'m1',level:.6});await e.command('masters.level',{slot:'m1',level:0});at(.1);assert.equal(frame('301').intensity,0,'fader down');
 await e.command('masters.trigger',{slot:'m1',down:true});at(.2);assert.equal(frame('301').intensity,1,'the flash is full, not the fader level');await e.command('masters.trigger',{slot:'m1',down:false});at(.3);assert.equal(frame('301').intensity,0);
 await e.command('masters.level',{slot:'m1',level:.4});await e.command('cue.play',{id:'other'});at(.4);assert.equal(frame('301').pan,.8,'a newer cue covers the master');
 await e.command('masters.trigger',{slot:'m1',down:true});at(.5);assert.equal(frame('301').intensity,1,'flash over its own running cue bumps it to full');assert.equal(frame('301').pan,.2,'and on top');assert.deepEqual(e.runtime().masters.held,['m1']);
 await e.command('masters.trigger',{slot:'m1',down:false});at(.6);assert.equal(frame('301').intensity,.4,'let go: back to the fader level');assert.deepEqual(e.runtime().masters.held,[]);
});

test('the performance lock refuses show edits but keeps playback, survives a restart and saves a pre-show version',async()=>{
 const dir=tmp();try{
  const {e}=rig({dataDir:dir});await e.command('cue.save',{cue:look('c301',['301'])});await e.command('masters.assign',{slot:'m1',cue:'c301'});
  await e.command('performance.lock',{enabled:true});assert.equal(e.runtime().locked,true);
  for(const [n,a] of [['cue.delete',{id:'c301'}],['page.delete',{id:'scene-1'}],['masters.assign',{slot:'m2',cue:'c301'}],['settings.set',{clearFade:1}]])await assert.rejects(e.command(n,a),/performance lock is on/);
  await e.command('masters.trigger',{slot:'m1',down:true});await e.command('page.go',{id:'scene-1'});await e.command('tempo.tap');await e.command('cue.stop',{});
  await e.command('masters.assign',{slot:'m1',sound:{channel:1,sensitivity:.7}});assert.equal(e.show.masters.slots[0].sound.sensitivity,.7,'sound trigger tuning stays open while locked');await assert.rejects(e.command('masters.assign',{slot:'m1',sound:{channel:1},label:'x'}),/performance lock/);
  assert.ok(e.versions.list().some(v=>v.reason==='performance-lock'));e.live.write(e.liveSnapshot());
  const again=new Engine({dataDir:dir,output:output()});assert.equal(again.locked,true,'the lock comes back after a restart');
  await e.command('performance.lock',{enabled:false});await e.command('cue.save',{cue:look('c401',['401'])});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('show versions are written on edits, listed newest first, and restored with the current show saved first',async()=>{
 const dir=tmp();try{
  const {e,at}=rig({dataDir:dir});await e.command('cue.save',{cue:look('first',['301'])});const v1=e.versions.list();assert.equal(v1.length,1);assert.equal(v1[0].reason,'edits');
  at(10);await e.command('cue.save',{cue:look('second',['301'])});assert.equal(e.versions.list().length,1,'at most one version per five minutes of edits');
  at(400);await e.command('cue.save',{cue:look('third',['301'])});const list=(await e.command('show.versions')).versions;assert.equal(list.length,2);assert.ok(list[0].id>list[1].id);
  await e.command('show.restore',{id:v1[0].id});assert.ok(e.show.cues.some(c=>c.id==='first'));assert.ok(!e.show.cues.some(c=>c.id==='third'));
  assert.ok(e.versions.list().some(v=>v.reason==='before-restore'));validateShow(e.show);
  await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});await assert.rejects(e.command('show.restore',{id:v1[0].id}),/Disarm/);
  for(let i=0;i<60;i++)e.versions.snapshot(e.show,'test');assert.ok(e.versions.list().length<=51,'pruned to the newest 50 plus one per older day');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('the pre-show check reports every row and the rig check page',async()=>{
 const {e}=rig();const c=await e.command('show.check',{network:false});const ids=c.rows.map(r=>r.id);
 for(const id of ['output','routing','fixtures','saved','lock','timing','rig'])assert.ok(ids.includes(id),id);
 assert.equal(c.rows.find(r=>r.id==='output').state,'warn');assert.equal(c.rows.find(r=>r.id==='lock').state,'warn');
 const n=await e.command('show.check',{});assert.equal(n.rows[0].id,'network');assert.equal(n.rows[0].state,'pass');
});

test('after an unclean exit the engine offers to resume; resuming re-arms, restores the scene and GOes the cue; a clean exit offers nothing',async()=>{
 const dir=tmp();try{
  const {e}=rig({dataDir:dir});await e.command('master.set',{value:.7});await e.command('scene.save',{scene:{id:'warm',name:'Warm',look:[{id:'401',values:{intensity:.5}}]}});
  await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});await e.command('page.go',{id:'scene-1',entry:'entry-2'});await e.command('scene.go',{id:'warm',fade:0}).catch(()=>{});
  e.scene={id:'warm',name:'Warm',rev:-1};e.live.write(e.liveSnapshot());
  const b=new Engine({dataDir:dir,output:output()});const r=b.runtime().resume;assert.ok(r);assert.equal(r.armed,true);assert.equal(r.scene,'Warm');assert.equal(r.cue.number,2);assert.equal(r.master,.7);
  assert.equal(b.output.armed,false,'never re-armed by itself');await assert.rejects(b.command('resume.apply',{}),/confirmation/);
  await b.command('resume.apply',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});assert.equal(b.output.armed,true);assert.equal(b.runtime().scene.id,'warm');assert.equal(b.runtime().stack.entry,'entry-2');assert.equal(b.master,.7);assert.equal(b.runtime().resume,null);
  b.live.close(b.liveSnapshot());assert.equal(new Engine({dataDir:dir,output:output()}).runtime().resume,null,'a clean exit offers nothing');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('modules that are off load nothing: no helper, no module code, unchanged runtime; module commands say how to turn them on',async()=>{
 const {e}=rig();assert.equal(e.mods,null);await e.command('master.set',{value:1});assert.deepEqual(Object.keys(e.runtime()).filter(k=>['sound','controller'].includes(k)),[]);
 await assert.rejects(e.command('sound.status'),/sound module is off/);await assert.rejects(e.command('midi.test',{note:60}),/MIDI module is off/);
 const s=await e.command('modules.status');assert.equal(s.sound.enabled,false);assert.equal(s.helper.running,false);
 await e.command('page.save',{page:{id:'p',name:'P',cues:[{id:'x',cue:'first-light',fade:0,follow:'manual',send:[{message:'midi',note:60}]}]}});await e.command('page.go',{id:'p'});
 assert.ok(e.logs.some(l=>/MIDI send skipped/.test(l.message)),'a MIDI send with the module off is logged, not an error');
});

test('sound module: the kick channel flashes its master for the hold, extends on another hit, and turning it off stops the helper',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('kick',['401'])});
 await e.command('masters.assign',{slot:'m1',cue:'kick',sound:{channel:3,band:'kick',sensitivity:.8,holdMs:60,gapMs:50}});
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'}});const io=e.mods.io,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
 await until(()=>io.devices);e.mods.sound.configure();const open=sent.find(m=>m.op==='audio.open');assert.equal(open.device,'Dante Virtual Soundcard');assert.deepEqual(open.triggers,[{id:'m1',channel:3,band:'kick',threshold:-49.2,gapMs:50}]);
 const st=await e.command('sound.status');assert.equal(st.devices[0].inputs,64);
 io.receive(JSON.stringify({ev:'audio',ok:true,device:'Dante Virtual Soundcard',channels:64}));io.receive(JSON.stringify({ev:'meter',input:-18,levels:{m1:-20}}));assert.deepEqual(e.runtime().sound,{input:-18,meter:{m1:-20},hits:{},device:'Dante Virtual Soundcard'},'the input level is in the runtime for the desk meter');
 io.receive(JSON.stringify({ev:'hit',id:'m1',level:-12}));at(.01);assert.equal(e.runtime().sound.hits.m1,1,'hits are counted for the desk to blink');assert.equal(frame('401').intensity,1,'a hit flashes the master at once');assert.deepEqual(e.runtime().masters.held,['m1']);
 await wait(40);io.receive(JSON.stringify({ev:'hit',id:'m1',level:-10}));await wait(40);at(.02);assert.equal(frame('401').intensity,1,'a second hit extends the hold');
 await wait(60);at(.03);assert.equal(frame('401').intensity,0,'let go after the hold');
 await e.command('sound.test',{slot:'m1'});assert.deepEqual(e.runtime().masters.held,['m1']);await wait(80);
 const check=(await e.command('show.check',{network:false})).rows.find(r=>r.id==='sound');assert.equal(check.state,'pass');
 await e.command('masters.assign',{slot:'m1',sound:{channel:3,band:'kick',sensitivity:.8,holdMs:60,gapMs:50,enabled:false}});assert.deepEqual(e.mods.sound.triggers(),[],'a switched-off trigger stops listening');assert.equal(e.show.masters.slots[0].sound.channel,3,'and keeps its settings');
 const child=io.child;await e.command('modules.set',{sound:{enabled:false}});assert.equal(e.mods,null);await until(()=>child.exitCode!==null);
});

test('sound follow mode: the master level rides the channel, starts the cue, stays through a pause and releases after 2 s of silence',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('pad',['401'])});
 await e.command('masters.assign',{slot:'m2',cue:'pad',sound:{channel:2,band:'full',mode:'follow',sensitivity:.5,rangeDb:24,attackMs:20,releaseMs:300}});
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'}});const io=e.mods.io,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
 await until(()=>io.devices);e.mods.sound.configure();const t=sent.find(m=>m.op==='audio.open').triggers[0];assert.deepEqual([t.mode,t.attackMs,t.releaseMs,t.threshold],['follow',20,300,-33]);
 const lvl=db=>io.receive(JSON.stringify({ev:'level',levels:{m2:db}}));
 lvl(-45);at(.1);assert.ok(!e.running().length,'below the line: nothing');
 lvl(-21);at(.2);assert.equal(frame('401').intensity,.5,'half way up the range is half level');assert.ok(e.running().some(r=>r.cue.id==='pad'));
 lvl(-9);at(.3);assert.equal(frame('401').intensity,1,'the top of the range is full');lvl(0);at(.35);assert.equal(frame('401').intensity,1,'louder stays full');
 lvl(-60);at(.4);assert.equal(frame('401').intensity,0,'quiet goes dark');assert.ok(e.running().some(r=>r.cue.id==='pad'),'but the cue keeps running through a pause');
 lvl(-27);at(.5);assert.equal(frame('401').intensity,.25,'and comes straight back');
 lvl(-60);await wait(2100);lvl(-60);at(.6);assert.ok(!e.running().some(r=>r.cue.id==='pad'),'2 s of silence releases it');
 await e.command('sound.test',{slot:'m2'});at(.7);assert.equal(frame('401').intensity,1,'test swell');
 assert.ok(!e.logs.some(l=>/masters.level/.test(l.message)),'level updates are not logged');await e.command('modules.set',{sound:{enabled:false}});
});

test('a sound trigger switches on and off live: masters.sound, while locked, and from the APC40 Activator buttons',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('kick',['401'])});
 await e.command('masters.assign',{slot:'m1',cue:'kick',sound:{channel:1,sensitivity:.6}});await assert.rejects(e.command('masters.sound',{slot:'m2'}),/no sound trigger/);
 await e.command('modules.set',{sound:{enabled:true,device:'Dante Virtual Soundcard'},midi:{enabled:true}});await until(()=>e.mods.midi.apc);
 await e.command('performance.lock',{enabled:true});
 const r=await e.command('masters.sound',{slot:'m1'});assert.equal(r.created.sound,false,'toggles off');assert.equal(e.show.masters.slots[0].sound.sensitivity,.6,'keeps its settings');assert.deepEqual(e.mods.sound.triggers(),[]);
 const io=e.mods.io,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
 e.mods.midi.input([0x90,0x32,127]);e.mods.midi.input([0x80,0x32,127]);await e.mods.midi.queue;assert.equal(e.show.masters.slots[0].sound.enabled,true,'Activator 1 switches it back on, still locked');
 assert.ok(sent.some(m=>m.port==='apc'&&m.bytes[0]===0x90&&m.bytes[1]===0x32&&m.bytes[2]===1),'Activator 1 lights while the trigger is on');
 await e.command('masters.sound',{slot:'m1',enabled:false});io.receive(JSON.stringify({ev:'hit',id:'m1'}));at(.1);assert.equal(frame('401').intensity,0,'a hit already on its way while off is ignored');
 await e.command('masters.sound',{slot:'m1',enabled:true});assert.deepEqual(e.mods.sound.triggers().map(t=>t.id),['m1']);await e.mods.close();e.mods=null;
});

test('MIDI module: a GO sends its note on the virtual StageLight port; a master sends note on and off',async()=>{
 const {e}=rig();await e.command('modules.set',{midi:{enabled:true}});const io=e.mods.io,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
 await e.command('page.save',{page:{id:'p',name:'P',cues:[{id:'x',cue:'first-light',fade:0,follow:'manual',send:[{message:'midi',note:60,channel:2,velocity:90}]}]}});
 await e.command('page.go',{id:'p'});assert.deepEqual(sent.find(m=>m.op==='midi.send'&&m.port==='virtual').bytes,[0x91,60,90]);await wait(250);assert.ok(sent.some(m=>m.port==='virtual'&&m.bytes[0]===0x81),'note off after 200 ms');
 await e.command('cue.save',{cue:look('c301',['301'])});await e.command('masters.assign',{slot:'m1',cue:'c301',midi:{note:10}});sent.length=0;
 await e.command('masters.trigger',{slot:'m1',down:true});await e.command('masters.trigger',{slot:'m1',down:false});
 assert.deepEqual(sent.filter(m=>m.port==='virtual').map(m=>m.bytes),[[0x90,10,100],[0x80,10,0]]);await e.command('midi.test',{note:22});
 assert.equal((await e.command('midi.status')).virtualPort,'StageLight');await e.mods.close();e.mods=null;
});

test('APC40 mkII: connects in Ableton Live mode, pads and faders drive masters, scene buttons show scene colours, LEDs only send changes',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('c301',['301'])});await e.command('cue.save',{cue:look('c401',['401'])});
 await e.command('masters.assign',{slot:'m1',cue:'c301',color:'#ff0000'});await e.command('masters.assign',{slot:'m2',cue:'c401',action:'toggle'});
 await e.command('scene.save',{scene:{id:'blue',name:'Blue',color:'#0000ff',look:[{id:'402',values:{intensity:.4}}]}});
 await e.command('modules.set',{midi:{enabled:true}});const io=e.mods.io,sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};
 await until(()=>e.mods.midi.apc);assert.ok(e.logs.some(l=>l.message==='APC40 mkII connected'));
 const midi=e.mods.midi,feed=bytes=>{midi.input(bytes)},flush=()=>midi.queue;
 // Ableton Live mode introduction was sent on connect (captured before the spy: check the profile constant instead).
 assert.deepEqual(APC.INTRO.slice(0,9),[0xF0,0x47,0x7F,0x29,0x60,0x00,0x04,0x41,0x01]);
 // Top-left pad (note 32) is master 1: press flashes it, release lets go.
 feed([0x90,32,127]);await flush();at(.1);assert.equal(frame('301').intensity,1);feed([0x80,32,127]);await flush();at(.2);assert.equal(frame('301').intensity,0);
 // Fader 2 (CC 7 on channel 1) raises master 2 from zero, once it has picked up.
 feed([0xB1,7,0]);feed([0xB1,7,64]);await flush();at(.3);assert.ok(Math.abs(frame('401').intensity-64/127)<.01);
 // Master fader is the grand master; the scene button GOes the scene and its LED is the scene's blue.
 feed([0xB0,14,127]);feed([0xB0,14,64]);await flush();assert.ok(Math.abs(e.master-64/127)<.01);
 feed([0x90,0x52,127]);feed([0x80,0x52,127]);await flush();assert.equal(e.runtime().scene.id,'blue');
 const blue=APC.nearestColor('#0000ff');assert.ok([45,67].includes(blue));assert.ok(sent.some(m=>m.op==='midi.send'&&m.port==='apc'&&m.bytes[1]===0x52&&m.bytes[2]===blue),'scene LED in the scene colour');
 // Pad 1 LED is master 1's red when idle (dim) — and repeating a paint sends nothing new.
 const n=sent.length;midi.changed();assert.equal(sent.length,n,'unchanged LEDs are not resent');
 // Tap tempo and nudge, shift + nudge halves.
 feed([0x90,0x63,127]);await flush();feed([0x90,0x64,127]);await flush();
 feed([0x90,0x62,127]);feed([0x90,0x64,127]);await flush();feed([0x80,0x62,127]);
 // Bank ▶ moves the fader bank; the editor test runs a control's action as if pressed.
 feed([0x90,0x3D,127]);await flush();assert.equal(e.runtime().controller.bank,1);feed([0x90,0x3C,127]);await flush();assert.equal(e.runtime().controller.bank,0);
 await e.command('controller.save',{id:'apc40mk2',map:{'pad-1':{do:'blackout'}}});await e.command('controller.test',{id:'apc40mk2',control:'pad-1'});assert.equal(e.blackout,true);
 await e.command('controller.reset',{id:'apc40mk2'});assert.deepEqual(e.mods.midi.profile().map['pad-1'],{do:'master.press',n:1});
 const status=await e.command('midi.status');assert.equal(status.controller.model,'apc40mk2');assert.ok(status.controls.length>100);assert.equal(status.last.control,'bank-left');
 await e.mods.close();e.mods=null;
});

test('MCP lists the live-show tools',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await wait(20);child.kill();
 const names=JSON.parse(out.split('\n')[0]).result.tools.map(t=>t.name);
 for(const n of ['tempo_tap','tempo_set','masters_level','performance_lock','show_versions','show_restore','show_check','resume_apply','modules_set','modules_status','sound_status','sound_test','midi_test','controller_save','controller_test'])assert.ok(names.includes('lights_'+n),n);
});
