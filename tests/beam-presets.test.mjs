import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../engine/engine.mjs';import {COMMANDS,validateShow} from '../engine/spec.mjs';import {encode} from '../engine/render.mjs';
// Beam presets (docs/BEAM-PRESETS.md). Hog DMX Output 2026-10-31, R3 301 soft look: prism 1 (ch10) 255, frost (ch14) 0, focus (ch15) 255.
const r3=['301','302','303','304','305','306'];
test('A beam preset captures the R3 soft look, applies only to R3s and gives the Hog bytes',async()=>{
 let t=0;const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}},clock:()=>t});
 await e.command('fixture.set',{ids:r3,values:{intensity:1,color:'#ff0000',prism:1,frost:0,focus:1}});t=.1;e.tick();
 const r=await e.command('beam.capture',{id:'soft-5',name:'Soft · 5-face',ids:r3});
 assert.deepEqual(r.created.preset,{id:'soft-5',name:'Soft · 5-face',values:{gobo:0,prism:1,prismRotation:0,frost:0,focus:1},profiles:['rogue']},'beam attributes only, no colour or position');
 await e.command('fixture.set',{ids:r3,values:{prism:3,frost:.5,focus:.2,pan:.3}});
 const a=await e.command('beam.apply',{id:'soft-5',ids:[...r3,'401']});assert.deepEqual(a.created,{applied:r3,skipped:['401']});
 t=.2;e.tick();const f=e.show.fixtures.find(f=>f.id==='301'),d=encode(e.show,e.frames).get(e.show.settings.mappings[f.universe]).subarray(f.address-1,f.address+15);
 assert.deepEqual([d[9],d[13],d[14]],[255,0,255],'prism 1 in, frost off, focus full');assert.equal(e.frames.find(x=>x.id==='301').pan,.3,'position kept');
 assert.equal(e.overrides['301'].color,'#ff0000','colour kept');assert.equal(e.overrides['401'],undefined,'other types untouched');
 await assert.rejects(e.command('beam.apply',{id:'soft-5',ids:['401']}),/none of these fixtures/);
 validateShow(e.show);await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('beam.save',{preset:{id:'x',name:'X',values:{frost:1}}}),/performance lock/);
 await e.command('performance.lock',{enabled:false});await e.command('beam.delete',{id:'soft-5'});assert.equal(e.show.beamPresets.length,0);
 for(const k of ['beam.save','beam.capture','beam.apply','beam.delete'])assert.ok(COMMANDS[k]&&!COMMANDS[k].internal,'exposed to MCP as lights_'+k.replace('.','_'));
});
test('The R3 profile names its prisms as observed: 5-face, 8-face, both wide',async()=>{
 const {PROFILE_DEFS}=await import('../engine/model.mjs');assert.deepEqual(PROFILE_DEFS.rogue.prismNames,{1:'5-face',2:'8-face',3:'Both · wide'});
});
