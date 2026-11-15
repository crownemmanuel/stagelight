import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import * as APC from '../engine/controllers/apc40mk2.mjs';
// Live-show failure modes of the sound and MIDI modules (docs/MIDI-AND-SOUND.md "When something fails"): the helper
// crashing or hanging, bad helper output, a sound card or the APC40 unplugged and plugged back, and switching on and off.
process.env.LIGHTS_IO_BIN=path.resolve('tests/fixtures/fake-io-flaky.mjs');
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false},async check(){return {ok:true,steps:[]}}});
// Every engine is closed after its test, pass or fail, so a failure never leaves a helper running.
const engines=[];test.afterEach(async()=>{for(const e of engines.splice(0))if(e.mods){await e.mods.close();e.mods=null}});
const rig=()=>{let time=0;const e=new Engine({output:output(),clock:()=>time});engines.push(e);return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=3000)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('timed out');await wait(10)}};
const look=(id,ids)=>({id,name:id,duration:30,loop:true,tracks:[],look:ids.map(f=>({id:f,values:{intensity:1}}))});
const DANTE='Dante Virtual Soundcard';
// Records what the engine sends the helper, across helper restarts (send is on the Helper, not the child).
const spy=io=>{const sent=[];const send=io.send.bind(io);io.send=m=>{sent.push(m);send(m)};return sent};
async function on(e,midi=true){
 await e.command('modules.set',{sound:{enabled:true,device:DANTE},...(midi?{midi:{enabled:true}}:{})});const io=e.mods.io;io.backoff=[40,80];
 await until(()=>io.devices&&(!midi||e.mods.midi.apc));return io;
}

test('the helper is restarted after it exits, and the input, virtual port and APC40 are opened again',async()=>{
 const {e}=rig();await e.command('masters.assign',{slot:'m1',cue:'first-light',sound:{channel:3}});const io=await on(e),sent=spy(io),first=io.child.pid;
 io.send({op:'test.crash',code:7});
 await until(()=>io.child&&io.child.pid!==first&&e.mods.midi.apc);
 assert.equal(io.restarts,1);assert.ok(e.logs.some(l=>/native helper stopped \(7\)/.test(l.message)),'the exit is logged');
 await until(()=>sent.filter(m=>m.op==='audio.open').length&&sent.some(m=>m.op==='midi.virtual'&&m.name==='StageLight')&&sent.some(m=>m.op==='midi.open'));
 assert.ok(sent.some(m=>m.op==='midi.send'&&m.port==='apc'&&m.bytes[0]===0xF0),'the APC40 gets its introduction again');
 assert.equal(sent.find(m=>m.op==='audio.open').device,DANTE);
 assert.equal((await e.command('modules.status')).helper.running,true);
 await e.mods.close();e.mods=null;
});

test('restarts back off and the count resets only after the helper has run for a while',async()=>{
 const {e}=rig();const io=await on(e,false);io.backoff=[30,60,90];
 for(let i=0;i<3;i++){const pid=io.child.pid;io.send({op:'test.crash'});await until(()=>io.child&&io.child.pid!==pid)}
 assert.equal(io.restarts,3);assert.equal(io.attempt,3,'three quick crashes climb the back-off steps');
 const msgs=e.logs.map(l=>l.message).filter(m=>/Restarting the native helper/.test(m));assert.deepEqual(msgs,['Restarting the native helper in 0.03 s','Restarting the native helper in 0.06 s','Restarting the native helper in 0.09 s']);
 io.startedAt=Date.now()-61000;const pid=io.child.pid;io.send({op:'test.crash'});await until(()=>io.child&&io.child.pid!==pid);assert.equal(io.attempt,1,'after a minute running, the next crash starts the back-off over');
 await e.mods.close();e.mods=null;
});

test('a helper that stops answering is killed and restarted; a quiet but healthy one is left alone',async()=>{
 const {e}=rig();const io=await on(e,false);io.quietMs=0;io.answerMs=60;
 io.check();await wait(30);io.check();assert.equal(io.restarts,0,'it answered the device request');assert.equal(io.pingAt>0,true);
 const pid=io.child.pid;io.send({op:'test.hang'});await wait(20);io.check();await wait(80);io.check();
 assert.ok(e.logs.some(l=>/stopped answering/.test(l.message)));await until(()=>io.child&&io.child.pid!==pid);assert.equal(io.restarts,1);
 await e.mods.close();e.mods=null;
});

test('malformed helper output is dropped without throwing and without flooding the log',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:look('kick',['401'])});await e.command('masters.assign',{slot:'m1',cue:'kick',sound:{channel:3}});
 const io=await on(e);let done=false;const off=io.on('garbage-done',()=>{done=true});
 for(let i=0;i<5;i++){done=false;io.send({op:'test.garbage'});await until(()=>done)}off();
 for(const line of ['null','{"ev":"devices","audio":5,"midiIn":"x"}','{"ev":"hit","id":"nope"}'])io.receive(line);
 at(.1);assert.equal(e.frames.find(f=>f.id==='401').intensity,0,'no hit fired from garbage');assert.deepEqual(e.runtime().sound?.meter??{},{});
 io.receive(JSON.stringify({ev:'devices',audio:[{name:DANTE,inputs:64}],midiIn:['APC40 mkII'],midiOut:['APC40 mkII']}));
 const helperLines=e.logs.filter(l=>/^Helper: $/.test(l.message));assert.ok(helperLines.length<=1,'a repeating helper error is logged once per 10 s');
 assert.ok(io.child,'the helper is still running');await e.mods.close();e.mods=null;
});

test('a sound card unplugged and plugged back is closed, then opened fresh; the APC40 reconnects with its LEDs',async()=>{
 const {e}=rig();await e.command('masters.assign',{slot:'m1',cue:'first-light',sound:{channel:3}});const io=await on(e),sent=spy(io);
 io.send({op:'test.devices',audio:[{name:'MacBook Pro Microphone',inputs:1}],midiIn:[],midiOut:[]});
 await until(()=>!e.mods.midi.apc&&e.mods.sound.missing);
 assert.ok(sent.some(m=>m.op==='audio.close'),'the dead stream is closed');assert.ok(sent.some(m=>m.op==='midi.close'&&m.id==='apc'));
 assert.equal(e.mods.sound.opened.ok,false);assert.match(e.mods.sound.checks()[0].detail,/not connected/);
 const before=sent.length;io.send({op:'test.devices',audio:[{name:DANTE,inputs:64}],midiIn:['APC40 mkII'],midiOut:['APC40 mkII']});
 await until(()=>e.mods.midi.apc&&sent.slice(before).some(m=>m.op==='audio.open'));
 const after=sent.slice(before);assert.ok(after.some(m=>m.op==='midi.open'));assert.ok(after.some(m=>m.port==='apc'&&m.bytes[0]===0xF0),'introduction sent');
 assert.ok(after.filter(m=>m.port==='apc'&&m.op==='midi.send').length>10,'every LED is sent again');
 assert.ok(e.logs.some(l=>/is back/.test(l.message)));await e.mods.close();e.mods=null;
});

test('an audio stream error closes and reopens the input',async()=>{
 const {e}=rig();await e.command('masters.assign',{slot:'m1',cue:'first-light',sound:{channel:3}});const io=await on(e,false),sent=spy(io);
 io.receive(JSON.stringify({ev:'error',message:'Audio input: The requested device is no longer available'}));assert.equal(e.mods.sound.opened.ok,false);
 await until(()=>sent.some(m=>m.op==='audio.open'),4000);const i=sent.findIndex(m=>m.op==='audio.close'),j=sent.findIndex(m=>m.op==='audio.open');assert.ok(i>=0&&i<j,'closed before it is opened again');
 await until(()=>e.mods.sound.opened?.ok);await e.mods.close();e.mods=null;
});

test('a follow cue lets go when the helper stops, when levels stop arriving, and when sound is switched off',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('pad',['401'])});
 await e.command('masters.assign',{slot:'m2',cue:'pad',sound:{channel:2,band:'full',mode:'follow',sensitivity:.5,rangeDb:24}});const io=await on(e,false);
 const lvl=db=>io.receive(JSON.stringify({ev:'level',levels:{m2:db}})),up=()=>e.running().some(r=>r.cue.id==='pad');
 lvl(-9);at(.1);assert.ok(up());assert.equal(frame('401').intensity,1);
 const pid=io.child.pid;io.send({op:'test.crash'});await until(()=>!up());at(.2);assert.equal(frame('401').intensity,0,'helper gone: released');await until(()=>io.child&&io.child.pid!==pid);
 lvl(-9);at(.3);assert.ok(up());await until(()=>!up(),3500);assert.ok(!e.mods.sound.watch,'the silence check stops once nothing is following');
 lvl(-9);at(.4);assert.ok(up());await e.command('modules.set',{sound:{enabled:false}});assert.ok(!up(),'switching sound off releases it');
});

test('switching modules on and off many times leaves no handlers, timers or helpers behind',async()=>{
 const {e}=rig();await e.command('masters.assign',{slot:'m1',cue:'first-light',sound:{channel:3}});
 const timers=()=>process.getActiveResourcesInfo().filter(r=>r==='Timeout').length;const children=[];
 await on(e);await e.command('modules.set',{sound:{enabled:false},midi:{enabled:false}});await wait(50);const base=timers();
 for(let i=0;i<5;i++){const io=await on(e);children.push(io.child);assert.equal([...io.handlers.values()].flat().length,10,'sound (7) and MIDI (3) handlers only');
  await e.command('modules.set',{sound:{enabled:false},midi:{enabled:false}});assert.equal(e.mods,null)}
 await until(()=>children.every(c=>c.exitCode!==null||c.signalCode!==null));await wait(50);
 assert.ok(timers()<=base,`timers do not pile up (${timers()} vs ${base})`);
});

test('the APC40 parser and MIDI module ignore malformed bytes; the metronome blink is kept to a sane rate',async()=>{
 for(const b of [null,[],[0x90],[0x90,0x20],[0xB0,7,'x'],[0x90,200,1],'zz'])assert.equal(APC.parse(b),null);
 assert.deepEqual(APC.ledMessage('no-such-control',1),[]);
 const {e}=rig();const io=await on(e);const m=e.mods.midi;
 for(const b of [[],[0xF0],[0xF0,0x47,0x7F,0x29,0x61],[0x90,-1,1],[0x90,0x20,'x']])m.input(b);
 e.tempo.bpm=5000;assert.equal(m.bpm(),300);e.tempo.bpm=-4;assert.equal(m.bpm(),null);e.tempo.bpm=NaN;assert.equal(m.bpm(),null);e.tempo.bpm=null;
 io.receive(JSON.stringify({ev:'midi',port:'apc',bytes:[0x90,0x62,127]}));assert.equal(m.shift,true);
 io.send({op:'test.devices',audio:[],midiIn:[],midiOut:[]});await until(()=>!m.apc);assert.equal(m.shift,false,'a held Shift does not stick across an unplug');
 await e.mods.close();e.mods=null;
});
