import test from 'node:test';import assert from 'node:assert/strict';
import {defaults,mh7Fixtures} from '../engine/model.mjs';import {encode,baseState} from '../engine/render.mjs';import {validateShow} from '../engine/spec.mjs';import {aimAngles} from '../public/aim.js';
test('MH7 photo patch and audience positions; new routes are initially absent',()=>{
 const s=defaults();validateShow(s);assert.deepEqual(mh7Fixtures().map(f=>[f.id,f.universe,f.address]),[['705',6,1],['707',6,43],['708',6,64],['706',6,22],['3101',1,337],['3102',1,358],['3103',6,235],['3104',6,256]]);
 assert.equal(s.settings.mappings[1],undefined);assert.equal(s.settings.mappings[6],undefined);assert.deepEqual([...encode(s,s.fixtures.map(baseState)).keys()],[2,3,4]);
 const f=s.fixtures.find(f=>f.id==='3101');assert.deepEqual(aimAngles(f,1,1),[270,125]);assert.equal(f.position[2],8);
});
test('MH7 channels match Martin chart: 16-bit intensity, shutter, green, pan/tilt and no lamp/reset',()=>{
 const s=defaults();s.settings.mappings={...s.settings.mappings,1:0,6:5};validateShow(s);
 const frames=s.fixtures.map(baseState),f=frames.find(f=>f.id==='3101');Object.assign(f,{opticalMode:'spot',intensity:1,color:[0,1,0],pan:1,tilt:0,zoom:1,focus:0,frost:1,prism:2,gobo:12});
 const packet=encode(s,frames).get(0);assert.deepEqual([...packet.subarray(336,357)],[255,255,255,33,16,0,0,131,96,0,0,255,255,255,0,0,255,255,0,0,0]);
 for(const intensity of [0,.1,.5,1]){f.intensity=intensity;const d=encode(s,frames).get(0);assert.equal(d[338],intensity?255:0);assert.equal(d[356],0)}
 const occupied=new Set(s.fixtures.filter(f=>f.universe===1).flatMap(f=>Array.from({length:21},(_,i)=>f.address-1+i)));for(let i=0;i<512;i++)if(!occupied.has(i))assert.equal(packet[i],0);
});

test('MH7 beam/spot open uses paired mode and gobo slots without changing dimmer or position',async()=>{
 const {Engine}=await import('../engine/engine.mjs');const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}}});e.show.settings.mappings[6]=5;
 await e.command('fixture.set',{ids:['705'],values:{intensity:1,pan:.6,tilt:.4,opticalMode:'spot'}});const spot=encode(e.show,e.frames).get(5);
 await e.command('fixture.set',{ids:['705'],values:{opticalMode:'beam'}});const beam=encode(e.show,e.frames).get(5);assert.equal(beam[4],0);assert.equal(beam[7],0);assert.equal(spot[4],16);assert.equal(spot[7],142);for(let i=0;i<512;i++)if(i!==4&&i!==7)assert.equal(beam[i],spot[i]);
 await e.command('look.capture',{id:'beam-test',name:'Beam test'});assert.equal(e.show.cues.find(c=>c.id==='beam-test').look.find(f=>f.id==='705').values.opticalMode,'beam');
 await assert.rejects(e.command('fixture.set',{ids:['705'],values:{opticalMode:'invalid'}}));
 const {COMMANDS}=await import('../engine/spec.mjs');assert.deepEqual(COMMANDS['fixture.set'].schema.properties.values.properties.opticalMode.enum,['spot','beam']);
});

test('Intensity-only MH7 control and cues default to confirmed open beam',async()=>{
 const {Engine}=await import('../engine/engine.mjs');const {render}=await import('../engine/render.mjs');const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}}});e.show.settings.mappings[6]=5;
 for(const intensity of [0,.2,1]){await e.command('fixture.set',{ids:['705'],values:{intensity}});const p=encode(e.show,e.frames).get(5);assert.equal(p[4],0);assert.equal(p[7],0);assert.equal(p[2],intensity?255:0);assert.equal(p[20],0)}
 const cue={tracks:[{group:'mh7s',effect:'static',start:0,duration:10,params:{brightness:1,color:'#ffffff'},fadeIn:0,fadeOut:0}]};const p=encode(e.show,render(e.show,cue,1)).get(5);assert.deepEqual([...p.subarray(0,5)],[255,255,255,0,0]);assert.equal(p[7],0);
});
