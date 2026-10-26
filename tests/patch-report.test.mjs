import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../engine/engine.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
test('patch.report lists every fixture with route, footprint, status and live DMX bytes',async()=>{
 const e=new Engine({output:output()});await e.command('master.set',{value:1});await e.command('fixture.set',{ids:['401'],values:{intensity:1,color:'#ff0000'}});
 const r=await e.command('patch.report');assert.equal(r.fixtures.length,e.show.fixtures.length);
 const b=r.fixtures.find(f=>f.id==='401');assert.deepEqual([b.universe,b.address,b.end,b.artnet,b.channels,b.state],[3,1,7,2,7,'ready']);assert.deepEqual(b.dmx.slice(0,4),[255,255,0,0]);assert.ok(b.groups.includes('backlights'));
 const mh7=r.fixtures.find(f=>f.id==='705');assert.equal(mh7.state,'unrouted');assert.equal(mh7.dmx,null);assert.ok(r.issues.some(i=>i.startsWith('705:')));
 const u3=r.universes.find(u=>u.hog===3);assert.equal(u3.artnet,2);assert.ok(u3.channelsUsed>=56);assert.ok(u3.ranges.some(x=>x.id==='401'&&x.from===1&&x.to===7));
 assert.equal(r.network.armed,false);assert.match(r.note,/no acknowledgment/);
 assert.ok(r.fixtures.filter(f=>!f.enabled).every(f=>f.state==='disabled'&&f.dmx===null));
});
