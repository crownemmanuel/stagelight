import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../engine/engine.mjs';
import {encode} from '../engine/render.mjs';
import {outputRGB} from '../public/fixture-colors.js';
const output=()=>({armed:false,send(){},status(){return {armed:false}}});
const bytes=e=>encode(e.show,e.frames).get(2);
test('3901 direct wheel controls affect only its two photographed color channels, with strict static limits',async()=>{
 const e=new Engine({output:output()});for(const f of e.show.fixtures)if(['beam200','beam7r'].includes(f.profile))f.colorSlots=[];await e.command('fixture.set',{ids:['3901'],values:{intensity:.6,pan:.3,tilt:.7}});const before=Buffer.from(bytes(e));
 await e.command('fixture.set',{ids:['3901'],values:{colorWheel:32,colorWheel2:177}});const after=bytes(e);assert.equal(after[169],32);assert.equal(after[170],177);
 for(let i=0;i<512;i++)if(i!==169&&i!==170)assert.equal(after[i],before[i],`unrelated channel ${i+1}`);
 await assert.rejects(e.command('fixture.set',{ids:['3901'],values:{colorWheel:128}}),/outside allowed range/);
 await assert.rejects(e.command('fixture.set',{ids:['4101'],values:{colorWheel:120}}),/static color wheel range/);
 await assert.rejects(e.command('fixture.set',{ids:['4101'],values:{colorWheel2:1}}),/200W Beam only/);
 await assert.rejects(e.command('fixture.set',{ids:['301'],values:{colorWheel:5}}),/200W Beam and 7R only/);
});
test('observed wheel colors persist, translate RGB in cues, and match preview without overwriting other fixtures',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-wheel-'));
 try{
  const e=new Engine({dataDir,output:output()});for(const f of e.show.fixtures)if(['beam200','beam7r'].includes(f.profile))f.colorSlots=[];const other=structuredClone(e.show.fixtures.find(f=>f.id==='4101'));
  // Synthetic observations exercise the mechanism; these are not fixture claims.
  await e.command('fixture.color.save',{id:'3901',name:'Test red',color:'#ff0000',value:32,secondary:177});
  await e.command('fixture.color.save',{id:'3901',name:'Test blue',color:'#0000ff',value:64,secondary:0});
  assert.deepEqual(e.show.fixtures.find(f=>f.id==='4101'),other);
  const restored=new Engine({dataDir,output:output()}),f=restored.show.fixtures.find(f=>f.id==='3901');assert.equal(f.colorSlots.length,2);
  await restored.command('fixture.set',{ids:['3901'],values:{color:'#ff0000',intensity:.5,pan:.6}});assert.equal(bytes(restored)[169],32);assert.equal(bytes(restored)[170],177);
  const frame=restored.frames.find(f=>f.id==='3901');assert.deepEqual(outputRGB('beam200',frame.color,0,f,frame),[1,0,0]);
  await restored.command('look.capture',{id:'test-wheel-look',name:'Wheel look'});await restored.command('cue.play',{id:'test-wheel-look'});assert.equal(bytes(restored)[169],32);assert.equal(bytes(restored)[170],177);
  await restored.command('fixture.set',{ids:['3901'],values:{colorWheel:90,colorWheel2:10}});await restored.command('fixture.set',{ids:['3901'],values:{color:'#0000ff'}});assert.equal(bytes(restored)[169],64);assert.equal(bytes(restored)[170],0);assert.equal(restored.overrides['3901'].colorWheel,undefined);
  await restored.command('fixture.set',{ids:['3901'],values:{color:'#ffffff'}});assert.equal(bytes(restored)[169],0);assert.equal(bytes(restored)[170],0);
  const imported=new Engine({output:output()});await imported.command('show.import',{show:restored.show});assert.deepEqual(imported.show.fixtures.find(f=>f.id==='3901').colorSlots,f.colorSlots);
  const schema=await imported.command('schema');assert.ok(schema.commands['fixture.color.save']);assert.equal(schema.profiles.beam200.colorControls.primary.channel,9);
 }finally{fs.rmSync(dataDir,{recursive:true,force:true})}
});
test('raw wheel values are captured and restored exactly and a color override supersedes a captured raw wheel',async()=>{
 const e=new Engine({output:output()});for(const f of e.show.fixtures)if(['beam200','beam7r'].includes(f.profile))f.colorSlots=[];await e.command('fixture.set',{ids:['3901'],values:{colorWheel:37,colorWheel2:91}});await e.command('look.capture',{id:'raw-wheel',name:'Raw wheel'});await e.command('cue.play',{id:'raw-wheel'});assert.equal(bytes(e)[169],37);assert.equal(bytes(e)[170],91);
 await e.command('fixture.set',{ids:['3901'],values:{color:'#ffffff'}});assert.equal(bytes(e)[169],0);assert.equal(bytes(e)[170],0);
 await e.command('fixture.color.save',{id:'4101',name:'Test green',color:'#00ff00',value:18});await e.command('fixture.set',{ids:['4101'],values:{color:'#00ff00'}});assert.equal(bytes(e)[56],18);
});

test('group wheel save captures individual positions, recalls shared swatches and persists atomically',async()=>{
 const {wheelEntries,sharedWheelColors}=await import('../public/wheel-selection.js');
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-wheel-group-'));
 try{
  const e=new Engine({dataDir,output:output()}),ids=['4101','4102','4103','4104'];for(const f of e.show.fixtures)if(['beam200','beam7r'].includes(f.profile))f.colorSlots=[];
  for(let i=0;i<ids.length;i++)await e.command('fixture.set',{ids:[ids[i]],values:{colorWheel:58+i,intensity:.7,pan:.4}});
  const selected=e.show.fixtures.filter(f=>ids.includes(f.id)),entries=wheelEntries(selected,e.frames),before=Buffer.from(bytes(e));
  assert.deepEqual(entries,selected.map(f=>({id:f.id,value:58+ids.indexOf(f.id)})));
  await e.command('fixture.colors.save',{entries,name:'Observed violet',color:'#8800ff'});
  assert.deepEqual(bytes(e),before); // Saving observations must not change the tested DMX values.
  assert.deepEqual(sharedWheelColors(e.show.fixtures.filter(f=>ids.includes(f.id)))[0].entries,entries);
  const restored=new Engine({dataDir,output:output()});for(const id of ids)assert.equal(restored.show.fixtures.find(f=>f.id===id).colorSlots[0].name,'Observed violet');
  const prior=structuredClone(e.show);await assert.rejects(e.command('fixture.colors.save',{entries:[{id:'4101',value:20},{id:'4104',value:120}],name:'Invalid',color:'#ffffff'}),/static color wheel range/);assert.deepEqual(e.show,prior);
  await assert.rejects(e.command('fixture.colors.save',{entries:[{id:'4101',value:20},{id:'4101',value:21}],name:'Duplicate',color:'#ffffff'}),/Duplicate fixture/);assert.deepEqual(e.show,prior);
  assert.ok((await e.command('schema')).commands['fixture.colors.save']);
 }finally{fs.rmSync(dataDir,{recursive:true,force:true})}
});

test('profile group saving from one 7R populates all four, with separate 200W values for the same palette',async()=>{
 const e=new Engine({output:output()});for(const f of e.show.fixtures)if(['beam200','beam7r'].includes(f.profile))f.colorSlots=[];await e.command('fixture.colors.save',{name:'Observed rose',color:'#ee4488',scope:'profile',entries:[{id:'4101',value:58},{id:'3901',value:32,secondary:20}]});
 for(const id of ['4101','4102','4103','4104'])assert.deepEqual(e.show.fixtures.find(f=>f.id===id).colorSlots,[{name:'Observed rose',color:'#ee4488',value:58}]);
 assert.equal(e.show.fixtures.find(f=>f.id==='3901').colorSlots[0].value,32);assert.equal(e.show.fixtures.find(f=>f.id==='3901').colorSlots[0].secondary,20);assert.ok(e.show.palettes.some(p=>p.name==='Observed rose'));
 const before=structuredClone(e.show);await assert.rejects(e.command('fixture.colors.save',{name:'Bad',color:'#ffffff',scope:'profile',entries:[{id:'4101',value:58},{id:'4102',value:59}]}),/one source/);assert.deepEqual(e.show,before);
});
