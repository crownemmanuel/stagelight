import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateShow} from '../engine/spec.mjs';import {baseState,encode} from '../engine/render.mjs';import {PROFILE_DEFS} from '../engine/model.mjs';
const show=JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8'));
const house=show.fixtures.filter(f=>f.profile==='pendant4');
// Hog fixture window photos IMG_3836–3843: RGBW Pendant Light 4ch. 3319 has no patch on the Hog.
const hog=[];for(let n=1001;n<=1062;n++)hog.push([String(n),8,1+4*(n-1001)]);for(let n=3301;n<=3318;n++)hog.push([String(n),5,165+4*(n-3301)]);for(let n=3320;n<=3362;n++)hog.push([String(n),5,241+4*(n-3320)]);
test('123 house pendants carry the Hog patch and are preview-only until the 4ch layout is confirmed',()=>{
 assert.equal(PROFILE_DEFS.pendant4.channels,4);
 assert.deepEqual(house.map(f=>[f.id,f.universe,f.address]),hog);
 assert.ok(house.every(f=>f.enabled&&!f.verified),'enabled for preview, unverified so never encoded');
 assert.ok(!show.fixtures.some(f=>f.id==='3319'));assert.equal(show.settings.mappings['8'],7);
 assert.deepEqual(show.groups.find(g=>g.id==='house-lights').fixtures,hog.map(h=>h[0]));
 // No pendant footprint overlaps any other fixture's patch.
 const used=new Map();for(const f of show.fixtures)for(let a=f.address;a<f.address+(PROFILE_DEFS[f.profile].channels||0);a++){const k=f.universe+':'+a;assert.ok(!used.has(k),`${f.id} overlaps ${used.get(k)} at ${k}`);used.set(k,f.id)}
 // Lowest number sits at the stage-right (+X) end of the front row, in the audience.
 const p=id=>show.fixtures.find(f=>f.id===id).position;assert.ok(p('1001')[0]>0&&p('1025')[0]<0);
 // House rows start behind the last face-light row.
 const dist=f=>Math.hypot(f.position[0],f.position[2]),face=show.fixtures.filter(f=>f.profile==='reveE3');assert.ok(Math.min(...house.map(dist))>Math.max(...face.map(dist))+1);
 assert.ok(show.fixtures.length>128);validateShow(show);
});
test('unverified pendants send nothing even at full; once verified, pendant 4ch encodes R, G, B, W scaled by intensity (no dimmer channel)',()=>{
 const full=encode(show,show.fixtures.map(x=>({...baseState(x),intensity:1,white:1}))).get(7);assert.ok(!full||full.every(b=>b===0));
 const s=structuredClone(show),f=s.fixtures.find(f=>f.id==='1001');f.enabled=f.verified=true;
 const p=encode(s,s.fixtures.map(x=>({...baseState(x),...(x.id==='1001'?{intensity:.5,color:[1,0,.5],white:1}:{})}))).get(7);
 assert.deepEqual([...p.subarray(0,4)],[128,0,64,128]);
});
