import test from 'node:test';import assert from 'node:assert/strict';
import {BEAM200_COLOR_PRESETS} from '../public/beam200-presets.js';import {defaults} from '../engine/model.mjs';import {baseState,encode} from '../engine/render.mjs';import {hexRGB,outputBands,bandSwatch} from '../public/fixture-colors.js';import {bandVertexColors} from '../public/beam-bands.js';
test('3901 defaults preserve all 24 spoken wheel values and put them on color channel 9',()=>{
 const expected=[0,8,13,16,20,24,30,34,41,46,50,54,58,69,73,78,84,89,95,99,101,106,109,112];assert.deepEqual(BEAM200_COLOR_PRESETS.map(p=>p.value),expected);
 const show=defaults(),f=show.fixtures.find(f=>f.id==='3901'),states=show.fixtures.map(baseState),state=states.find(s=>s.id===f.id);assert.deepEqual(f.colorSlots,BEAM200_COLOR_PRESETS);
 for(const slot of f.colorSlots){state.color=hexRGB(slot.color);const p=encode(show,states).get(2);assert.equal(p[f.address+7],slot.value,slot.name);assert.equal(p[f.address+8],0);assert.equal(p[f.address+14],0);}
});
test('preview resolves the same raw wheel value and preserves split-filter colors',()=>{
 const fixture=defaults().fixtures.find(f=>f.id==='3901');
 assert.deepEqual(outputBands('beam200',[1,1,1],0,fixture,{colorWheel:8,colorWheel2:0}),[[1,0,0]]);
 assert.deepEqual(outputBands('beam200',[1,1,1],0,fixture,{colorWheel:13}),[[1,0,0],[1,1,0]]);
 const three=outputBands('beam200',[1,1,1],0,fixture,{colorWheel:95});assert.equal(three.length,3);assert.deepEqual(three[2],[1,0,0]);assert.match(bandSwatch(three),/^linear-gradient/);
 const override=structuredClone(fixture);override.colorSlots.find(s=>s.value===13).name='Custom observation';override.colorSlots.find(s=>s.value===13).color='#00ff00';assert.deepEqual(outputBands('beam200',[1,1,1],0,override,{colorWheel:13}),[[0,1,0]]);
});
test('split beam triangles retain distinct colors rather than blending them into white',()=>{
 const positions=new Float32Array([1,0,1,2,0,1,1,0,2,-1,0,-1,-2,0,-1,-1,0,-2]),colors=bandVertexColors(positions,[[1,0,0],[1,1,0]]);
 assert.deepEqual([...colors.slice(0,9)],[1,0,0,1,0,0,1,0,0]);assert.deepEqual([...colors.slice(9)],[1,1,0,1,1,0,1,1,0]);
});
