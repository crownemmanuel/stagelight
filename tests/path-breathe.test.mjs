import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../engine/engine.mjs';
// Path movement and breathe depth (docs/CUE-PLAYBACK.md), operator requests 2026-11-01.
const rig=()=>{let t=0;const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}},clock:()=>t});return {e,at:x=>{t=x;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
test('Path flows through saved positions without stopping, loops, and follows the BPM',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});
 for(const [id,pan,tilt] of [['a',.3,.3],['b',.3,.7],['c',.6,.5]]){await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['301'],values:{pan,tilt}});e.tick();await e.command('point.save',{id,name:id,fixtures:['301']});await e.command('override.release',{fade:0});await e.command('blind.set',{enabled:false})}
 await e.command('cue.save',{cue:{id:'flow',name:'flow',duration:3600,loop:true,only:['position'],look:[],tracks:[{fixtures:['301'],layer:'position',effect:'path',start:0,duration:3600,params:{points:['a','b','c'],lap:9},fadeIn:0,fadeOut:0}]}});
 await e.command('cue.play',{id:'flow'});const pose=x=>{at(x);const f=frame('301');return [f.pan,f.tilt]};
 const close=(p,q)=>Math.abs(p[0]-q[0])<1e-6&&Math.abs(p[1]-q[1])<1e-6;
 assert.ok(close(pose(0),[.3,.3]),'starts at a');assert.ok(close(pose(3),[.3,.7]),'at b a third of the lap in');assert.ok(close(pose(6),[.6,.5]),'at c');assert.ok(close(pose(9),[.3,.3]),'back at a after one lap');
 let slowest=1;for(let x=0;x<9;x+=.05){const a=pose(x),b=pose(x+.05);slowest=Math.min(slowest,Math.hypot(b[0]-a[0],b[1]-a[1]))}assert.ok(slowest>.001,'never stops between points');
 await assert.rejects(e.command('point.delete',{id:'b'}),/A cu/);
 const cue=structuredClone(e.show.cues.find(c=>c.id==='flow'));cue.bpm=60;await e.command('cue.save',{cue});await e.command('cue.play',{id:'flow'});await e.command('tempo.set',{bpm:120});
 const t0=10;at(t0);const start=pose(t0);assert.ok(close(pose(t0+4.5),start),'at double the BPM a 9 s lap takes 4.5 s');
});
test('Breathe depth keeps a pulse subtle and never fully off',async()=>{
 const {e,at,frame}=rig();const ids=['201','202'];
 await e.command('cue.save',{cue:{id:'pulse',name:'pulse',duration:3600,loop:true,only:['intensity'],look:ids.map(id=>({id,values:{intensity:.8}})),tracks:[{fixtures:ids,layer:'intensity',effect:'breathe',start:0,duration:3600,params:{speed:.3,depth:.45,brightness:1},fadeIn:0,fadeOut:0}]}});
 await e.command('master.set',{value:1});await e.command('cue.play',{id:'pulse'});let lo=1,hi=0;for(let x=0;x<40;x+=.2){at(x);const v=frame('201').intensity;lo=Math.min(lo,v);hi=Math.max(hi,v)}
 assert.ok(lo>.8*.5,'never below about half its level');assert.ok(hi>.79&&hi<=.8+1e-9,'swells to its level');assert.ok(hi-lo>.25,'still a visible breath');
});
test('An even strobe flashes every head at full, scattered, at its frequency',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});const ids=['301','302','303','304','305','306'];
 await e.command('cue.save',{cue:{id:'s',name:'s',duration:3600,loop:true,only:['intensity'],look:[],tracks:[{fixtures:ids,layer:'intensity',effect:'strobe',start:0,duration:3600,params:{frequency:4,duty:.35,strobePattern:'scatter',even:true,brightness:1},fadeIn:0,fadeOut:0}]}});
 await e.command('cue.play',{id:'s'});const seen=new Map(ids.map(id=>[id,new Set()]));for(let x=0;x<2;x+=.01){at(x);for(const id of ids)seen.get(id).add(Math.round(frame(id).intensity*100))}
 for(const id of ids)assert.deepEqual([...seen.get(id)].sort((a,b)=>a-b),[0,100],'every flash is full or off on '+id);
});
test('A cue follows the global tempo or not, with its own speed on top, and a running cue changes at once',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:{id:'c',name:'c',duration:3600,loop:true,look:[{id:'301',values:{intensity:1}}],tracks:[]}});
 await e.command('tempo.set',{bpm:180});await e.command('cue.play',{id:'c'});at(1);const rate=()=>e.running().find(r=>r.cue.id==='c').rate;assert.equal(rate(),1,'no bpm: ignores the tempo');
 const cue=structuredClone(e.show.cues.find(x=>x.id==='c'));cue.speed=2;await e.command('cue.save',{cue});assert.equal(rate(),2,'own speed, at once');
 cue.bpm=120;await e.command('cue.save',{cue});assert.equal(rate(),3,'follows the tempo (180/120) times its own speed');
 delete cue.bpm;delete cue.speed;await e.command('cue.save',{cue});assert.equal(rate(),1);
});
