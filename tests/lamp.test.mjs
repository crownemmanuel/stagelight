import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../engine/engine.mjs';
const rig=()=>{let time=0;const output={armed:false,last:null,send(p){if(this.armed)this.last=p},status(){return {armed:this.armed}},async arm(){this.armed=true},close(){this.armed=false}};const e=new Engine({output,clock:()=>time});e.show.settings.mappings[6]=5;return {e,output,at:t=>{time=t;e.tick()}}};
test('Lamp pulse affects only selected MH7 control slot, expires to neutral and is not captured',async()=>{
 const {e,output,at}=rig();await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});const before=new Map([...output.last].map(([u,p])=>[u,Buffer.from(p)]));
 await e.command('fixture.lamp',{ids:['705'],action:'strike'});assert.equal(output.last.get(5)[20],50);
 for(const [u,p] of output.last)for(let i=0;i<512;i++)if(u!==5||i!==20)assert.equal(p[i],before.get(u)[i]);
 await assert.rejects(e.command('fixture.lamp',{ids:['705'],action:'douse'}),/progress/);
 await e.command('look.capture',{id:'lamp-look',name:'Lamp look',all:true});assert.ok(e.show.cues.find(c=>c.id==='lamp-look').look.every(x=>!('lamp' in x.values)));
 at(4.9);assert.equal(output.last.get(5)[20],50);at(5);assert.equal(output.last.get(5)[20],0);
 await e.command('fixture.lamp',{ids:['705'],action:'douse'});assert.equal(output.last.get(5)[20],70);at(10);assert.equal(output.last.get(5)[20],0);
});
test('Lamp requests require live mapped MH7s, validate entire selection and cancel on disarm',async()=>{
 const {e,output}=rig();await assert.rejects(e.command('fixture.lamp',{ids:['705'],action:'strike'}),/armed/);
 await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});
 await assert.rejects(e.command('fixture.lamp',{ids:['705','301'],action:'strike'}),/MH7/);assert.equal(e.lampCommands.size,0);
 await assert.rejects(e.command('fixture.lamp',{ids:['3101'],action:'strike'}),/route/);
 await assert.rejects(e.command('fixture.lamp',{ids:['705'],action:'reset'}));
 await e.command('fixture.lamp',{ids:['705'],action:'strike'});await e.command('output.disarm');assert.equal(e.lampCommands.size,0);assert.equal(output.last.get(5)[20],0);
 await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});assert.equal(output.last.get(5)[20],0);
});
