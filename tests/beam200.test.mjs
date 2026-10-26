import test from 'node:test';import assert from 'node:assert/strict';import {defaults} from '../engine/model.mjs';import {baseState,encode} from '../engine/render.mjs';import {Engine} from '../engine/engine.mjs';import {aimAngles} from '../public/aim.js';
test('200W Beam matches photographed Hog layout with interleaved pan/tilt fine channels and neutral controls',()=>{
 const show=defaults(),states=show.fixtures.map(baseState),frame=states.find(f=>f.id==='3901');Object.assign(frame,{pan:0x1234/65535,tilt:0xabcd/65535,intensity:1,movementSpeed:1,frost:.5,gobo:17,goboShake:.2,focus:1,prism:1,prismRotation:0});
 const p=encode(show,states).get(2);assert.deepEqual([...p.subarray(161,177)],[0x12,0xab,0x34,0xcd,0,128,255,255,0,0,123,51,255,255,64,0]);frame.intensity=0;assert.equal(encode(show,states).get(2)[168],0);assert.equal(encode(show,states).get(2)[176],0);
 const f=show.fixtures.find(f=>f.id==='3901');assert.deepEqual(aimAngles(f,1,1),[225,135]);
});
test('200W Beam explicit lamp control uses ch16 without reset and rejects unsupported prism choices',async()=>{
 let t=0;const output={armed:true,last:null,send(p){this.last=p},status(){return {armed:true}}};const e=new Engine({output,clock:()=>t});e.tick();await e.command('fixture.lamp',{ids:['3901'],action:'strike'});assert.equal(output.last.get(2)[176],200);assert.equal(output.last.get(2)[168],0);t=5;e.tick();assert.equal(output.last.get(2)[176],0);await e.command('fixture.lamp',{ids:['3901'],action:'douse'});assert.equal(output.last.get(2)[176],100);t=10;e.tick();assert.equal(output.last.get(2)[176],0);await assert.rejects(e.command('fixture.set',{ids:['3901'],values:{prism:2}}),/3-face/);
});
