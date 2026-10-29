import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {validateShow} from '../engine/spec.mjs';
// Scenes (docs/MASTERS-AND-SCENES.md): the active scene stays on underneath every cue and is what the rig fades back to.
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const rig=opts=>{let time=0;const e=new Engine({output:output(),clock:()=>time,...opts});return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
const look=(id,ids,values)=>({id,name:id,duration:30,loop:true,tracks:[],look:ids.map(f=>({id:f,values}))});
const base={id:'base',name:'Warm base',look:[{id:'401',values:{intensity:.5,color:'#ff8000'}}]};
const setup=async e=>{await e.command('master.set',{value:1});await e.command('scene.save',{scene:base});await e.command('cue.save',{cue:look('c301',['301'],{intensity:1})});await e.command('cue.save',{cue:look('c401',['401'],{intensity:1,color:'#0000ff'})})};

test('scene.capture records the live look without Highlight and saves a valid show',async()=>{
 const {e,at}=rig();await e.command('master.set',{value:1});await e.command('fixture.set',{ids:['401'],values:{intensity:.5,color:'#ff0000'}});
 await e.command('selection.set',{ids:['401']});await e.command('highlight.set',{enabled:true});at(.1);assert.equal(e.frames.find(f=>f.id==='401').intensity,1,'highlight is showing');
 await e.command('scene.capture',{id:'warm',name:'Warm',color:'#ffaa00'});
 const v=e.show.scenes[0].look.find(x=>x.id==='401').values;assert.equal(v.intensity,.5);assert.equal(v.color,'#ff0000');assert.equal(e.show.scenes[0].color,'#ffaa00');
 assert.equal(e.runtime().scene,null,'capturing does not activate');validateShow(e.show);
});

test('the active scene fills fixtures no cue uses, and release or stop fades back to it instead of to dark',async()=>{
 const {e,at,frame}=rig();await setup(e);
 await e.command('scene.go',{id:'base',fade:0});at(.1);assert.equal(frame('401').intensity,.5);assert.equal(frame('402').intensity,0);assert.deepEqual(e.runtime().scene,{id:'base',name:'Warm base'});
 await e.command('cue.play',{id:'c301'});at(.2);assert.equal(frame('301').intensity,1);assert.equal(frame('401').intensity,.5,'scene stays underneath a cue');
 await e.command('cue.play',{id:'c401'});at(.3);assert.equal(frame('401').intensity,1,'a cue overrides the scene');
 await e.command('cue.release',{id:'c401',fade:0});at(.4);assert.equal(frame('401').intensity,.5,'released fixtures go back to the scene');
 await e.command('cue.release',{id:'c301',fade:1});at(.9);assert.ok(Math.abs(frame('301').intensity-.5)<.02,'fades out');at(1.5);assert.equal(frame('301').intensity,0);assert.equal(frame('401').intensity,.5,'last cue released: back to the scene, not dark');
 await e.command('cue.play',{id:'c401'});at(2);await e.command('cue.stop',{fade:1});at(3.2);assert.equal(frame('401').intensity,.5,'cue.stop fades back to the scene');assert.equal(e.running().length,0);
 await e.command('cue.save',{cue:{...look('short',['301'],{intensity:1}),duration:1,loop:false}});await e.command('cue.play',{id:'short'});at(3.5);assert.equal(frame('301').intensity,1);
 at(4.6);at(7);assert.equal(frame('301').intensity,0);assert.equal(frame('401').intensity,.5,'a cue that ends hands back to the scene');
 await e.command('scene.release',{fade:0});at(7.1);assert.equal(frame('401').intensity,0,'releasing the scene goes dark');assert.equal(e.runtime().scene,null);
});

test('scene.go crossfades between scenes; deleting the active scene releases it; arming waits for release',async()=>{
 const {e,at,frame}=rig();await setup(e);await e.command('scene.save',{scene:{id:'cool',name:'Cool',look:[{id:'401',values:{intensity:1,color:'#0000ff'}}]}});
 await e.command('scene.go',{id:'base',fade:0});at(.1);await e.command('scene.go',{id:'cool',fade:2});at(1.1);assert.ok(Math.abs(frame('401').intensity-.75)<.02,'halfway between scenes');at(2.2);assert.equal(frame('401').intensity,1);
 await assert.rejects(e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'}),/Release the scene/);assert.equal(e.output.armed,false);
 await e.command('scene.delete',{id:'cool'});at(5);assert.equal(e.runtime().scene,null);assert.equal(frame('401').intensity,0);assert.ok(!e.show.scenes.some(s=>s.id==='cool'));
 await assert.rejects(e.command('scene.go',{id:'cool'}),/Unknown scene/);
});

test('scenes are saved in the show; the active scene is never restored at startup',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-scenes-'));
 try{const {e}=rig({dataDir:dir});await setup(e);await e.command('scene.go',{id:'base'});assert.ok(e.runtime().scene);
  const again=new Engine({dataDir:dir,output:output()});assert.equal(again.runtime().scene,null);assert.deepEqual(again.show.scenes,[base]);validateShow(JSON.parse(fs.readFileSync(path.join(dir,'show.json'),'utf8')));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
