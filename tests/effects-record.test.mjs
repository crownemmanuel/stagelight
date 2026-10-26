import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../engine/engine.mjs';import {encode} from '../engine/render.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
async function rig(){let time=0;const e=new Engine({output:output(),clock:()=>time});await e.command('master.set',{value:1});
 await e.command('cue.save',{cue:{id:'base',name:'Base',duration:30,loop:true,tracks:[{group:'rogues',effect:'static',start:0,duration:30,params:{color:'#0000ff',brightness:.5},fadeIn:0,fadeOut:0}],look:[{id:'401',values:{intensity:.4,color:'#00ff00'}},{id:'301',values:{pan:.5,tilt:.5}}]}});
 await e.command('page.save',{page:{id:'act',name:'Act',cues:[{id:'a',cue:'base',fade:0,follow:'manual'}]}});await e.command('page.go',{id:'act'});return {e,at:t=>{time=t;e.tick()}}}
const f=(list,id)=>list.find(x=>x.id===id);

test('Effect preview layers on the live look in the visualizer only; apply keeps its phase',async()=>{
 const {e,at}=await rig();at(1);const live=encode(e.show,e.frames,{physical:true});
 await e.command('fx.preview',{fixtures:['401','402','301'],preset:'breathe'});const pv=e.runtime().fxPreview;assert.deepEqual(pv.fixtures,['401','402','301']);assert.equal(pv.layer,'intensity');
 at(2.3);const p=f(e.runtime().previewFrames,'401');assert.deepEqual(p.color,[0,1,0],'intensity layer keeps the look color');assert.ok(p.intensity>0&&p.intensity<=.4+1e-9,'pulses the current level');
 assert.deepEqual(encode(e.show,e.frames,{physical:true}),live,'nothing live');
 await assert.rejects(e.command('fx.preview',{fixtures:['401'],preset:'circle'}),/moving heads/);
 await e.command('fx.preview',{fixtures:['401','301'],preset:'circle'});assert.deepEqual(e.runtime().fxPreview.fixtures,['301'],'movement keeps only movers');
 at(3);const before=f(e.runtime().previewFrames,'301');await e.command('fx.apply',{fade:0});assert.equal(e.runtime().fxPreview,null);assert.equal(e.runtime().fx.length,1);
 const after=f(e.frames,'301');assert.ok(Math.abs(after.pan-before.pan)<1e-9&&Math.abs(after.tilt-before.tilt)<1e-9,'same phase on promotion');assert.ok(Math.abs(after.pan-.5)>1e-4,'circling around the cue aim');
});

test('Straight-to-live effects, one per layer, stopped by fx.stop and by Clear',async()=>{
 const {e,at}=await rig();await e.command('fx.apply',{fixtures:['401'],preset:'chase',fade:0});await e.command('fx.apply',{fixtures:['401'],preset:'rainbow',fade:0});await e.command('fx.apply',{fixtures:['401'],preset:'breathe',fade:0});
 assert.deepEqual(e.runtime().fx.map(x=>x.preset).sort(),['breathe','rainbow'],'breathe replaced chase on the intensity layer');
 await e.command('fx.stop',{ids:['401'],fade:0});assert.equal(e.runtime().fx.length,0);at(1);assert.equal(f(e.frames,'401').intensity,.4);
 await e.command('fx.apply',{fixtures:['301'],preset:'circle',fade:0});await e.command('fixture.set',{ids:['402'],values:{intensity:1}});await e.command('override.release',{fade:0});assert.equal(e.runtime().fx.length,0);assert.deepEqual(e.overrides,{});
});

test('Update merges changes and effects into the playing cue without a visible jump; replace snapshots',async()=>{
 const {e,at}=await rig();await e.command('fixture.set',{ids:['401'],values:{color:'#ff0000'}});await e.command('fx.apply',{fixtures:['301','302'],preset:'circle',fade:0});at(1);
 const seen=JSON.stringify(e.frames.filter(x=>['401','301','302','303'].includes(x.id)));
 const r=await e.command('cue.record',{id:'base'});assert.equal(r.created.updated,true);const cue=e.show.cues.find(c=>c.id==='base');
 assert.equal(f(cue.look.filter(x=>x.over),'401').values.color,'#ff0000');assert.equal(f(cue.look.filter(x=>!x.over),'401').values.intensity,.4,'original look kept');
 assert.ok(cue.tracks.some(t=>t.group==='rogues'),'cue keeps its own effect');assert.ok(cue.tracks.some(t=>t.layer==='position'&&t.effect==='orbit'&&t.fixtures.join()==='301,302'));
 assert.deepEqual(e.overrides,{});assert.equal(e.fx.length,0);assert.equal(JSON.stringify(e.frames.filter(x=>['401','301','302','303'].includes(x.id))),seen,'no visible change');
 at(2);assert.deepEqual(f(e.frames,'401').color,[1,0,0]);
 await assert.rejects(e.command('cue.record',{id:'base'}),/No changes/);
 await e.command('cue.record',{id:'base',mode:'replace'});assert.equal(e.show.cues.find(c=>c.id==='base').tracks.length,0);assert.ok(e.show.cues.find(c=>c.id==='base').look.length>40);
});

test('Save as new copies the playing cue plus changes, inserts it after the current entry and can GO it',async()=>{
 const {e,at}=await rig();await e.command('page.save',{page:{id:'act',name:'Act',cues:[{id:'a',cue:'base',fade:0,follow:'manual'},{id:'z',cue:'base',fade:0,follow:'manual'}]}});await e.command('page.go',{id:'act',entry:'a'});
 await e.command('fixture.set',{ids:['402'],values:{intensity:.9,color:'#ffff00'}});at(1);
 const r=await e.command('cue.record',{id:'base-2',name:'Base, warmer',page:'act',after:'a',go:true});
 assert.equal(r.created.updated,false);assert.deepEqual(e.show.pages.find(p=>p.id==='act').cues.map(x=>x.id),['a',r.created.entry,'z']);
 assert.equal(e.runtime().stack.entry,r.created.entry);assert.deepEqual(e.overrides,{});at(2);assert.equal(f(e.frames,'402').intensity,.9);
 assert.equal(e.show.cues.find(c=>c.id==='base').look.some(x=>x.id==='402'),false,'original untouched');
});

test('Blind records the blind changes',async()=>{
 const {e}=await rig();await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['403'],values:{intensity:.7}});
 await e.command('cue.record',{id:'base'});assert.equal(f(e.show.cues.find(c=>c.id==='base').look,'403').values.intensity,.7);assert.deepEqual(e.runtime().blind.fixtures,[]);
});
