import test from 'node:test';import assert from 'node:assert/strict';import {BEAM7R_COLOR_PRESETS} from '../public/beam7r-presets.js';import {defaults} from '../engine/model.mjs';import {baseState,encode} from '../engine/render.mjs';import {hexRGB,outputBands} from '../public/fixture-colors.js';import {sharedWheelColors} from '../public/wheel-selection.js';
test('all four 7R heads share the 20 observed presets and encode them on their own color channel',()=>{
 assert.deepEqual(BEAM7R_COLOR_PRESETS.map(p=>p.value),[0,11,17,24,31,35,41,49,55,60,67,72,78,82,85,91,97,101,109,113]);
 const show=defaults(),fixtures=show.fixtures.filter(f=>f.profile==='beam7r'),states=show.fixtures.map(baseState);assert.equal(fixtures.length,4);assert.equal(sharedWheelColors(fixtures).length,20);
 for(const f of fixtures){assert.deepEqual(f.colorSlots,BEAM7R_COLOR_PRESETS);const st=states.find(s=>s.id===f.id);for(const slot of f.colorSlots){st.color=hexRGB(slot.color);st.colorWheel=slot.value;const packet=encode(show,states).get(2);assert.equal(packet[f.address-1],slot.value);assert.equal(packet[f.address+13],0);assert.equal(packet[f.address+14],0);}}
});
test('7R preview honors corrected blue/green at DMX 35 and preserves other split filters',()=>{
 const f=defaults().fixtures.find(f=>f.id==='4102');assert.equal(f.colorSlots.find(s=>s.value===35).name,'Blue + green');
 assert.deepEqual(outputBands('beam7r',[1,1,1],0,f,{colorWheel:35}),[hexRGB('#0040ff'),hexRGB('#00ff40')]);assert.deepEqual(outputBands('beam7r',[1,1,1],0,f,{colorWheel:109}),[hexRGB('#caff30'),hexRGB('#ff80bd')]);
 assert.deepEqual(outputBands('beam7r',[1,1,1],0,f,{colorWheel:11}),[[1,0,0]]);
});
