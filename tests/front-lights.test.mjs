import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {validateShow,COMMANDS} from '../engine/spec.mjs';import {baseState,encode} from '../engine/render.mjs';
const show=JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8'));
test('Front-truss Colorados 409–418 are patched like the Hog fixture window (Hog 2:241–304, 7ch)',()=>{
 const front=show.fixtures.filter(f=>+f.id>=409&&+f.id<=418);
 assert.deepEqual(front.map(f=>[f.id,f.profile,f.universe,f.address]),Array.from({length:10},(_,i)=>[String(409+i),'colorado',2,241+7*i]));
 assert.equal(show.settings.mappings['2'],1);assert.deepEqual(show.groups.find(g=>g.id==='front-lights').fixtures,front.map(f=>f.id));
 for(const f of front){assert.equal(f.position[2],8);assert.ok(f.aim[2]<f.position[2]&&f.aim[1]<f.position[1],'front lights face upstage and down')}
 validateShow(show);
 // Full intensity lands on Art-Net 1 at each head's first channel; backlights on Hog 3 are untouched by the new patch.
 const p=encode(show,show.fixtures.map(f=>({...baseState(f),intensity:1}))).get(1);for(const f of front)assert.equal(p[f.address-1],255);
 assert.deepEqual(show.fixtures.filter(f=>f.profile==='colorado'&&+f.id<409).map(f=>[f.universe,f.address]),Array.from({length:8},(_,i)=>[3,1+7*i]));
});
test('fixture.place saves an aim point and keeps the patch',async()=>{
 assert.ok(COMMANDS['fixture.place'].schema.properties.aim);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'front-'));fs.writeFileSync(path.join(dir,'show.json'),JSON.stringify(show));
 const engine=new Engine({dataDir:dir});await engine.command('fixture.place',{id:'409',position:[-8,6.1,8],aim:[-8,1.5,0]});
 const f=engine.show.fixtures.find(f=>f.id==='409');assert.deepEqual([f.position,f.aim,f.universe,f.address],[[-8,6.1,8],[-8,1.5,0],2,241]);
 await engine.command('fixture.place',{id:'409',position:[-8.1,6.1,8]});assert.deepEqual(engine.show.fixtures.find(f=>f.id==='409').aim,[-8,1.5,0]);
 await engine.close?.();fs.rmSync(dir,{recursive:true,force:true});
});

// Hog 4 DMX Output, universe 2, 2026-10-31: front light 409 in CTO = 255 255 205 94 0 127 0 (dimmer, R, G, B, W, zoom, strobe),
// the same as the backlights in CTO. The face lights' Hog CTO is #ffcdb4 + amber + mint, so one CTO palette carries both.
test('One CTO palette gives the Colorados and the face lights their own Hog values',async()=>{
 const output={armed:false,send(){},status(){return {armed:false}}},e=new Engine({output});await e.command('show.import',{show});
 await e.command('palette.save',{id:'hog-cto',name:'CTO · Hog',color:'#ffcdb4',amber:1,mint:103/255,profiles:[{profile:'colorado',color:'#ffcd5e',white:0}]});
 await e.command('palette.apply',{id:'hog-cto',ids:['409','401','27']});
 assert.deepEqual(e.overrides['409'],{color:'#ffcd5e',white:0,amber:0,mint:0});assert.deepEqual(e.overrides['401'],e.overrides['409']);
 assert.deepEqual(e.overrides['27'],{color:'#ffcdb4',amber:1,mint:103/255});
 const f=e.show.fixtures.find(f=>f.id==='409'),p=encode(show,[{...baseState(f),...e.overrides['409'],color:[1,205/255,94/255],intensity:1,zoom:127/255}]).get(1);
 assert.deepEqual([...p.subarray(240,247)],[255,255,205,94,0,127,0],'matches the Hog bytes');
 await assert.rejects(e.command('palette.save',{id:'x',name:'X',color:'#ffffff',profiles:[{profile:'colorado',color:'#000000'},{profile:'colorado',color:'#111111'}]}),/each profile once/);
 await assert.rejects(e.command('palette.apply',{id:'nope',ids:['409']}),/Unknown palette/);
 assert.ok(COMMANDS['palette.apply'].live&&!COMMANDS['palette.apply'].internal,'exposed to MCP as lights_palette_apply');
});
