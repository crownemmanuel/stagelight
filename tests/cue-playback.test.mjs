import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';
// Running cues (docs/CUE-PLAYBACK.md): several cues can run; each can be paused, resumed and released on its own.
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const rig=()=>{let time=0;const e=new Engine({output:output(),clock:()=>time});return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
const red={id:'red',name:'Backlights red',duration:30,loop:true,tracks:[],look:['401','402','403'].map(id=>({id,values:{intensity:1,color:'#ff0000'}}))};
const sweep={id:'sweep',name:'Movers sweep',duration:30,loop:true,look:[],tracks:[{group:'rogues',effect:'sweep',start:0,duration:30,params:{color:'#ffffff',brightness:.8,speed:1,panAmplitude:.2},fadeIn:0,fadeOut:0}]};
const full={id:'full',name:'Full look',duration:30,loop:true,tracks:[],look:['401','402','403','301'].map(id=>({id,values:{intensity:.5,color:'#0000ff'}}))};
async function setup(){const r=rig();await r.e.command('master.set',{value:1});for(const cue of [red,sweep,full])await r.e.command('cue.save',{cue});return r}
test('a second cue layers over the first: the first keeps its fixtures, the newest owns its own',async()=>{
 const {e,at,frame}=await setup();await e.command('cue.play',{id:'red'});at(.1);await e.command('cue.play',{id:'sweep'});at(.2);
 assert.deepEqual(e.runtime().running.map(r=>[r.id,r.top]),[['sweep',true],['red',false]]);
 assert.equal(frame('401').intensity,1,'red stays on the backlights');assert.ok(frame('301').intensity>0,'sweep drives the rogues');
});
test('releasing the newest cue keeps the older one running; releasing the last fades to zero holding positions',async()=>{
 const {e,at,frame}=await setup();await e.command('cue.play',{id:'red'});at(.1);await e.command('cue.play',{id:'sweep'});at(1);
 const pan=frame('301').pan;await e.command('cue.release',{fade:0});at(1.1);
 assert.deepEqual(e.runtime().running.map(r=>r.id),['red']);assert.equal(frame('401').intensity,1);assert.equal(frame('301').intensity,0,'rogues are no longer in any cue');
 await e.command('cue.release',{id:'red',fade:0});at(1.2);
 assert.deepEqual(e.runtime().running,[]);assert.equal(frame('401').intensity,0);
 await assert.rejects(e.command('cue.release',{}),/No cue is running/);void pan;
});
test('releasing an older cue by id leaves the newest alone; a fade crossfades',async()=>{
 const {e,at,frame}=await setup();await e.command('cue.play',{id:'red'});at(.1);await e.command('cue.play',{id:'sweep'});at(.2);
 await e.command('cue.release',{id:'red',fade:1});at(.7);assert.ok(frame('401').intensity>0&&frame('401').intensity<1,'halfway through the release fade');
 at(1.3);assert.equal(frame('401').intensity,0);assert.deepEqual(e.runtime().running.map(r=>r.id),['sweep']);
 await assert.rejects(e.command('cue.release',{id:'red'}),/not running/);
});
test('pause freezes a cue where it is and resume continues from that point',async()=>{
 const {e,at,frame}=await setup();await e.command('cue.play',{id:'sweep'});at(1);
 await e.command('cue.pause',{paused:true});const held=frame('301').pan;at(2);at(5);assert.equal(frame('301').pan,held,'heads stop where they were');
 assert.equal(e.runtime().running[0].paused,true);
 await e.command('cue.pause',{paused:false,id:'sweep'});at(5.5);
 const ref=rig();await ref.e.command('cue.save',{cue:sweep});await ref.e.command('cue.play',{id:'sweep'});ref.at(1.5);
 assert.equal(frame('301').pan,ref.frame('301').pan,'resumed from 1 s, now at 1.5 s of the cue');
});
test('a newer cue that takes every fixture of an older cue retires it (full-look GO behaves as before)',async()=>{
 const {e,at,frame}=await setup();await e.command('cue.play',{id:'red'});at(.1);await e.command('cue.play',{id:'full'});at(.2);
 assert.deepEqual(e.runtime().running.map(r=>r.id),['full']);assert.equal(frame('401').intensity,.5);
 await e.command('cue.play',{id:'sweep'});await e.command('cue.play',{id:'sweep'});at(.3);assert.deepEqual(e.runtime().running.map(r=>r.id),['sweep','full'],'replaying a running cue does not stack it twice');
 await e.command('cue.stop',{fade:0});at(.4);assert.deepEqual(e.runtime().running,[]);
});
test('highlight shows selected fixtures full, open white, open beam; never recorded; off restores',async()=>{
 const {e,at,frame}=await setup();await e.command('fixture.set',{ids:['301'],values:{intensity:.2,color:'#ff0000',gobo:3,prism:1,frost:.5,pan:.3}});
 await e.command('selection.set',{ids:['301']});await e.command('highlight.set',{enabled:true});at(.1);
 const f=frame('301');assert.equal(f.intensity,1);assert.deepEqual(f.color,[1,1,1]);assert.equal(f.gobo,0);assert.equal(f.prism,0);assert.equal(f.frost,0);assert.equal(f.opticalMode,'beam');assert.equal(f.pan,.3,'position kept');
 assert.equal(e.programmed.find(s=>s.id==='301').intensity,.2,'programmer and recordings never see highlight');assert.equal(e.runtime().highlight,true);
 await e.command('selection.set',{ids:['302']});at(.2);assert.equal(frame('301').intensity,.2,'follows the selection');assert.equal(frame('302').intensity,1);
 await e.command('highlight.set',{enabled:false});at(.3);assert.equal(frame('302').intensity,0);
});
test('MCP exposes cue release, cue pause with id, and highlight',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 assert.ok(by('lights_cue_release'));assert.ok(by('lights_highlight_set'));assert.ok(by('lights_cue_pause').inputSchema.properties.id);
});
