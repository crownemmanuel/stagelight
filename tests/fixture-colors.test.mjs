import test from 'node:test';import assert from 'node:assert/strict';import {nearestWheel,outputRGB,hexRGB,COLOR_WHEELS} from '../public/fixture-colors.js';import {defaults,PROFILE_DEFS} from '../engine/model.mjs';import {baseState,encode} from '../engine/render.mjs';import {Color,SRGBColorSpace} from '../public/vendor/three.core.js';
test('Visualizer wheel choices match actual DMX filter bytes, including pastel requests that select white',()=>{
 const show=defaults();show.settings.mappings[6]=5;const frames=show.fixtures.map(baseState);
 for(const [profile,id,expected] of [['rogue','301',6],['mh7','705',12]]){const f=show.fixtures.find(f=>f.id===id),frame=frames.find(f=>f.id===id);frame.color=[1,0,0];frame.intensity=1;const packet=encode(show,frames).get(show.settings.mappings[f.universe]);assert.equal(packet[f.address+(profile==='rogue'?6:2)],expected);assert.deepEqual(outputRGB(profile,frame.color),[1,0,0]);}
 for(const profile of ['rogue','mh7'])for(const [hex,value] of COLOR_WHEELS[profile]){const color=hexRGB(hex);assert.equal(nearestWheel(profile,color).value,value);assert.deepEqual(outputRGB(profile,color),color);}
 assert.equal(nearestWheel('rogue',[.65,.92,1]).value,0);assert.deepEqual(outputRGB('rogue',[.65,.92,1]),[1,1,1]);assert.deepEqual(PROFILE_DEFS.mh7.colorWheel,COLOR_WHEELS.mh7);
});
test('RGB wash preview retains requested saturation, white tint, and correct sRGB transfer',()=>{
 assert.deepEqual(outputRGB('q120',[0,1,1]),[0,1,1]);assert.deepEqual(outputRGB('colorado',[.2,0,.5],.1),[.30000000000000004,.1,.6]);assert.deepEqual(outputRGB('q120',[0,0,0],1),[1,.78,.5]);
 const c=new Color().setRGB(.5,0,1,SRGBColorSpace);assert.ok(Math.abs(c.r-.214041)<1e-5);assert.equal(c.g,0);assert.equal(c.b,1);
});

test('White preset selects open wheel slots and neutral full RGB while preserving dimmer and pose',async()=>{
 const {Engine}=await import('../engine/engine.mjs');const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}}});e.show.settings.mappings[6]=5;const ids=['301','705','201','401'];
 await e.command('fixture.set',{ids,values:{intensity:.6,pan:.65,tilt:.7,color:'#ff0000',white:.4}});const before=structuredClone(e.frames);
 await e.command('fixture.set',{ids,values:{color:'#ffffff',white:0}});const packets=encode(e.show,e.frames);
 for(const id of ids){const f=e.show.fixtures.find(f=>f.id===id),frame=e.frames.find(f=>f.id===id),old=before.find(f=>f.id===id),d=packets.get(e.show.settings.mappings[f.universe]),base=f.address-1;assert.equal(frame.intensity,old.intensity);assert.equal(frame.pan,old.pan);assert.equal(frame.tilt,old.tilt);if(f.profile==='rogue')assert.equal(d[base+7],0);else if(f.profile==='mh7')assert.equal(d[base+3],0);else assert.deepEqual([...d.subarray(base+1,base+5)],[255,255,255,0]);}
});
