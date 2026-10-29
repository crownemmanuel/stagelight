import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateShow} from '../engine/spec.mjs';import {baseState,encode} from '../engine/render.mjs';import {PROFILE_DEFS} from '../engine/model.mjs';
const show=JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8'));
const house=show.fixtures.filter(f=>f.profile==='pendant4');
// Hog fixture window photos IMG_3836–3843: RGBW Pendant Light 4ch. 3319 has no patch on the Hog.
const hog=[];for(let n=1001;n<=1062;n++)hog.push([String(n),8,1+4*(n-1001)]);for(let n=3301;n<=3318;n++)hog.push([String(n),5,165+4*(n-3301)]);for(let n=3320;n<=3362;n++)hog.push([String(n),5,241+4*(n-3320)]);
test('123 house pendants carry the Hog patch and are verified for output (Hog Fixture Builder, 2026-10-28)',()=>{
 assert.equal(PROFILE_DEFS.pendant4.channels,4);
 assert.deepEqual(house.map(f=>[f.id,f.universe,f.address]),hog);
 assert.ok(house.every(f=>f.enabled&&f.verified),'enabled and verified, so encoded while armed');assert.deepEqual(PROFILE_DEFS.pendant4.attributes,['intensity','color'],'no white channel');
 assert.ok(!show.fixtures.some(f=>f.id==='3319'));assert.equal(show.settings.mappings['8'],7);
 assert.deepEqual(show.groups.find(g=>g.id==='house-lights').fixtures,hog.map(h=>h[0]));
 // No pendant footprint overlaps any other fixture's patch.
 const used=new Map();for(const f of show.fixtures)for(let a=f.address;a<f.address+(PROFILE_DEFS[f.profile].channels||0);a++){const k=f.universe+':'+a;assert.ok(!used.has(k),`${f.id} overlaps ${used.get(k)} at ${k}`);used.set(k,f.id)}
 // Lowest number sits at the stage-right (+X) end of the front row, in the audience.
 const p=id=>show.fixtures.find(f=>f.id===id).position;assert.ok(p('1001')[0]>0&&p('1009')[0]<0&&p('1010')[0]>0&&p('1023')[0]<0);
 // Operator rows (2026-10-28): row 1 = 1001–1009, row 2 = 1010–1023; rows 3–5 and the 3300s are provisional.
 const row=n=>show.groups.find(g=>g.id==='house-row-'+n).fixtures,ids=(a,b)=>Array.from({length:b-a+1},(_,i)=>String(a+i));
 assert.deepEqual(row(1),ids(1001,1009));assert.deepEqual(row(2),ids(1010,1023));assert.ok(Math.hypot(p('1010')[0],p('1010')[2])>Math.hypot(p('1001')[0],p('1001')[2]));
 // House rows start behind the last face-light row.
 const dist=f=>Math.hypot(f.position[0],f.position[2]),face=show.fixtures.filter(f=>f.profile==='reveE3');assert.ok(Math.min(...house.map(dist))>Math.max(...face.map(dist))+1);
 assert.ok(show.fixtures.length>128);validateShow(show);
});
test('pendant 4ch encodes dimmer, red, green, blue per the Hog Fixture Builder; an unverified pendant sends nothing',()=>{
 const s=structuredClone(show);const state=x=>({...baseState(x),...(x.id==='1001'?{intensity:.5,color:[1,0,.5],white:1}:{})});
 const p=encode(s,s.fixtures.map(state)).get(7);assert.deepEqual([...p.subarray(0,4)],[128,255,0,128],'ch1 dimmer, ch2 red, ch3 green, ch4 blue; white ignored');
 assert.deepEqual([...p.subarray(4,8)],[0,255,255,255],'1002 is dark through its dimmer (ch1 = 0), colour held at white');
 s.fixtures.find(f=>f.id==='1001').verified=false;const off=encode(s,s.fixtures.map(state)).get(7);assert.ok(!off||off.subarray(0,4).every(b=>b===0));
});
