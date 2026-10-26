import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Engine} from '../engine/engine.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const slowSpin={id:'slow-spin',name:'Slow spin',icon:'orbit',effect:'orbit',params:{speed:.25,panAmplitude:.08,tiltAmplitude:.03},description:'Wide, lazy circle for ballads.'};
test('Custom presets are saved in the show, flagged custom, and work like built-ins',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-presets-'));try{
  const e=new Engine({dataDir:dir,output:output()});
  const r=await e.command('preset.save',{preset:slowSpin});assert.equal(r.created.preset,'slow-spin');
  const schema=await e.command('schema');assert.equal(schema.presets['slow-spin'].custom,true);assert.equal(schema.presets['slow-spin'].category,'movement');assert.equal(schema.presets['slow-spin'].movers,true);assert.equal(schema.presets.breathe.custom,false);assert.ok(schema.icons.includes('orbit'));
  await e.command('fx.preview',{fixtures:['301','401'],preset:'slow-spin'});assert.deepEqual(e.runtime().fxPreview.fixtures,['301']);assert.equal(e.runtime().fxPreview.params.panAmplitude,.08);
  await e.command('fx.apply',{fade:0});assert.equal(e.runtime().fx[0].preset,'slow-spin');
  const cue=await e.command('effect.apply',{preset:'slow-spin',group:'rogues'});assert.equal(e.show.cues.find(c=>c.id===cue.created.cue).tracks[0].params.speed,.25);
  assert.equal(new Engine({dataDir:dir,output:output()}).show.presets[0].name,'Slow spin','persists');
  await e.command('preset.save',{preset:{...slowSpin,name:'Slow spin v2'}});assert.equal(e.show.presets.length,1,'same id replaces');
  await e.command('preset.delete',{id:'slow-spin'});assert.equal(e.show.presets.length,0);await assert.rejects(e.command('fx.preview',{fixtures:['301'],preset:'slow-spin'}),/Unknown effect preset/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('Built-ins are protected; icons and effects are validated',async()=>{
 const e=new Engine({output:output()});
 await assert.rejects(e.command('preset.save',{preset:{...slowSpin,id:'breathe'}}),/Built-in/);await assert.rejects(e.command('preset.delete',{id:'breathe'}),/Built-in/);
 await assert.rejects(e.command('preset.save',{preset:{...slowSpin,icon:'not-an-icon'}}),/unsupported/);await assert.rejects(e.command('preset.save',{preset:{...slowSpin,effect:'static'}}),/unsupported/);
 await e.command('preset.save',{preset:{id:'ember',name:'Ember',icon:'flame',effect:'breathe',params:{color:'#ff5a1f',secondary:'#ffb84a',speed:.35,brightness:.7}}});
 assert.equal((await e.command('schema')).presets.ember.category,'intensity');
});
