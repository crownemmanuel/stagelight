import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../engine/engine.mjs';import {encode} from '../engine/render.mjs';
const output=()=>({armed:true,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
async function rig(){let time=0;const e=new Engine({output:output(),clock:()=>time});await e.command('master.set',{value:1});
 await e.command('cue.save',{cue:{id:'base',name:'Base',duration:30,loop:true,tracks:[],look:[{id:'401',values:{intensity:.3,color:'#0000ff'}},{id:'301',values:{intensity:.4,color:'#ffffff',pan:.5,tilt:.5}}]}});
 await e.command('page.save',{page:{id:'act',name:'Act',cues:[{id:'a',cue:'base',fade:0,follow:'manual'}]}});await e.command('page.go',{id:'act'});return {e,at:t=>{time=t;e.tick()}}}
const f=(list,id)=>list.find(x=>x.id===id);

test('Blind edits show only in preview frames and never change live frames or DMX',async()=>{
 const {e}=await rig();const live=encode(e.show,e.frames,{physical:true});
 await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['401'],values:{intensity:1,color:'#ff0000'}});
 const r=e.runtime();assert.equal(r.blind.enabled,true);assert.deepEqual(r.blind.fixtures,['401']);assert.deepEqual(r.overrides,{});
 assert.equal(f(r.previewFrames,'401').intensity,1);assert.deepEqual(f(r.previewFrames,'401').color,[1,0,0]);assert.equal(f(r.previewFrames,'301').intensity,.4,'blind sits over the live look');
 assert.equal(f(e.frames,'401').intensity,.3);assert.deepEqual(encode(e.show,e.frames,{physical:true}),live);
 await e.command('fixture.clear',{ids:['401']});assert.deepEqual(e.runtime().blind.fixtures,[]);
});

test('Recording in blind captures the blind look; release clears only the blind buffer',async()=>{
 const {e}=await rig();await e.command('fixture.set',{ids:['301'],values:{intensity:.9}});
 await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['401'],values:{intensity:.8,color:'#00ff00'}});await e.command('fixture.set',{ids:['301'],values:{pan:.6}});
 await e.command('point.save',{id:'blind-pos',name:'Blind pos',fixtures:['301']});assert.equal(e.show.points.find(p=>p.id==='blind-pos').positions['301'].pan,.6);
 await e.command('look.capture',{id:'recorded',name:'Recorded in blind',page:'act',fade:1});const look=e.show.cues.find(c=>c.id==='recorded').look;
 assert.equal(f(look,'401').values.intensity,.8);assert.equal(f(look,'401').values.color,'#00ff00');assert.equal(f(look,'301').values.pan,.6);assert.equal(f(look,'301').values.intensity,.9,'live overrides are part of the blind base');
 assert.equal(f(e.frames,'401').intensity,.3);assert.equal(e.show.pages.find(p=>p.id==='act').cues.length,2);
 await e.command('override.release',{fade:0});assert.deepEqual(e.runtime().blind.fixtures,[]);assert.equal(e.overrides['301'].intensity,.9,'live overrides untouched');
});

test('Blind over a preview cue, and blind.apply fades the changes live',async()=>{
 const {e,at}=await rig();await e.command('cue.save',{cue:{id:'other',name:'Other',duration:30,loop:true,tracks:[],look:[{id:'401',values:{intensity:.6,color:'#ffffff'}}]}});
 await e.command('blind.set',{enabled:true});await e.command('preview.cue',{id:'other'});await e.command('fixture.set',{ids:['301'],values:{intensity:1}});
 let r=e.runtime();assert.equal(f(r.previewFrames,'401').intensity,.6);assert.equal(f(r.previewFrames,'301').intensity,1);
 await e.command('preview.stop');await e.command('point.recall',{id:'nope'}).catch(()=>{});
 await e.command('blind.apply',{fade:2});assert.deepEqual(e.runtime().blind.fixtures,[]);assert.equal(e.overrides['301'].intensity,1);
 at(1);assert.ok(Math.abs(f(e.frames,'301').intensity-.7)<1e-9,'halfway from .4 to 1');at(2);assert.equal(f(e.frames,'301').intensity,1);
 await assert.rejects(e.command('blind.apply',{}),/No blind changes/);
 await e.command('blind.set',{enabled:false});assert.equal(e.runtime().previewFrames,null);
});

test('Playback settings set Clear and Blind fades; blind clear fades the blind view; 0 is instant',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-settings-'));
 try{
  let time=0;const e=new Engine({dataDir:dir,output:output(),clock:()=>time});const at=t=>{time=t;e.tick()};await e.command('master.set',{value:1});
  assert.deepEqual(e.show.playback,{clearFade:3,blindFade:2,sceneFade:2});
  await e.command('settings.set',{clearFade:4,blindFade:1});assert.deepEqual(new Engine({dataDir:dir,output:output()}).show.playback,{clearFade:4,blindFade:1,sceneFade:2},'saved in the show');
  // Clear uses clearFade when no fade is given.
  await e.command('fixture.set',{ids:['401'],values:{intensity:1}});await e.command('override.release',{});at(2);assert.ok(Math.abs(f(e.frames,'401').intensity-.5)<1e-9,'halfway through a 4 s clear');at(4);assert.equal(f(e.frames,'401').intensity,0);
  // Blind clear fades the blind view over blindFade instead of cutting.
  await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['402'],values:{intensity:1}});at(4);assert.equal(f(e.runtime().previewFrames,'402').intensity,1);
  await e.command('override.release',{});assert.deepEqual(e.runtime().blind.fixtures,[]);at(4.5);assert.ok(Math.abs(f(e.runtime().previewFrames,'402').intensity-.5)<1e-9);assert.ok(e.runtime().blind.release);
  at(5);assert.equal(f(e.runtime().previewFrames,'402').intensity,0);assert.equal(e.runtime().blind.release,null);
  // blind.apply uses blindFade; 0 makes everything instant.
  await e.command('fixture.set',{ids:['403'],values:{intensity:1}});await e.command('blind.apply',{});at(5.5);assert.ok(Math.abs(f(e.frames,'403').intensity-.5)<1e-9);
  await e.command('settings.set',{clearFade:0,blindFade:0});await e.command('fixture.set',{ids:['404'],values:{intensity:1}});await e.command('override.release',{});assert.equal(f(e.runtime().previewFrames,'404').intensity,0,'instant blind clear');
  await e.command('blind.set',{enabled:false});await e.command('override.release',{});at(6);assert.equal(f(e.frames,'403').intensity,0,'instant live clear');
  await assert.rejects(e.command('settings.set',{clearFade:99}),/outside/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
