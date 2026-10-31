import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateShow} from '../engine/spec.mjs';import {baseState,encode} from '../engine/render.mjs';import {PROFILE_DEFS} from '../engine/model.mjs';
const show=JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8'));
const face=show.fixtures.filter(f=>f.profile==='reveE3');
// Hog fixture window photos (IMG_3844/3845): Ovation Reve E-3 12ch, user numbers 1–49.
const hog=id=>id<=19?[2,1+12*(id-1)]:id<=44?[1,1+12*(id-20)]:{45:[2,229],46:[2,311],47:[2,323],48:[1,301],49:[1,313]}[id];
test('49 Rêve E-3 face lights carry the Hog patch',()=>{
 assert.equal(PROFILE_DEFS.reveE3.channels,12);
 assert.deepEqual(face.map(f=>[f.id,f.universe,f.address]),Array.from({length:49},(_,i)=>[String(i+1),...hog(i+1)]));
 assert.deepEqual(show.groups.find(g=>g.id==='face-lights').fixtures,face.map(f=>f.id));
 for(const f of face){assert.ok(f.position[2]>6,'mounted in the audience');assert.ok(f.aim[2]<f.position[2],'faces the stage')}
 // Even wash: the near row covers upstage, the far row downstage (Hog-noted specials 30–32 keep their own focus).
 const row=(a,b)=>face.filter(f=>+f.id>=a&&+f.id<=b&&!['30','31','32'].includes(f.id));
 assert.ok(row(1,24).every(f=>f.aim[2]<0)&&row(25,49).every(f=>f.aim[2]>0));
 for(const r of [row(1,24),row(25,49)]){const xs=r.map(f=>f.aim[0]);assert.ok(Math.min(...xs)<=-8&&Math.max(...xs)>=8,'spans the stage width')}
 validateShow(show);
});
test('Rêve E-3 12ch encodes Chauvet 12Ch: 16-bit dimmer, RGB, white on amber + mint, ch8–12 neutral',()=>{
 const states=show.fixtures.map(f=>({...baseState(f),...(f.id==='1'?{intensity:.5,color:[1,0,.5],white:.5}:{})}));
 const u=show.settings.mappings[2],p=encode(show,states).get(u);
 assert.deepEqual([...p.subarray(0,12)],[128,0,255,0,128,128,128,0,0,0,0,0]);
});

test('Rêve E-3 amber and mint can be set on their own (Hog CTB = RGB white + mint 101), else white drives both',async()=>{
 const {encode,baseState}=await import('../engine/render.mjs');const f=face[0],st={...baseState(f),intensity:1,color:[1,1,254/255],white:.5};
 const d=s=>[...encode(show,[s],{physical:true}).values()][0].slice(f.address-1,f.address+6);
 assert.deepEqual([...d(st)].slice(5,7),[128,128],'white drives amber and mint');
 assert.deepEqual([...d({...st,white:0,amber:0,mint:101/255})],[255,255,255,255,254,0,101],'matches the Hog CTB bytes');
 const {COMMANDS,validate}=await import('../engine/spec.mjs');validate(COMMANDS['palette.save'].schema,{id:'ctb',name:'CTB',color:'#fffffe',amber:0,mint:.396});
});
