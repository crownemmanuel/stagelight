// What an agent reads back (docs/CODE-EFFECTS.md, "Reading the show"): small by default, full detail on request.
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {briefReply,briefRuntime} from '../mcp/brief.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const size=o=>JSON.stringify(o).length;

test('overview maps the show and what is live without per-fixture values',async()=>{
 const e=new Engine({output:output()});await e.command('cue.play',{id:'first-light'});await e.command('fixture.set',{ids:['401'],values:{intensity:.4}});await e.command('fx.apply',{fixtures:['401','402'],preset:'breathe',fade:0});
 const o=await e.command('overview'),full=await e.command('status');
 assert.ok(size(o)<size(full)/4,`overview ${size(o)} vs status ${size(full)}`);assert.ok(size(o)<24000);
 assert.equal(o.fixtures.total,e.show.fixtures.length);assert.deepEqual(o.fixtures.types.flatMap(t=>t.ids).sort(),e.show.fixtures.map(f=>f.id).sort());assert.ok(o.fixtures.types.find(t=>t.profile==='rogue').moving);
 assert.deepEqual(o.groups.find(g=>g.id==='backlights').fixtures,e.show.groups.find(g=>g.id==='backlights').fixtures);assert.equal(o.groups.find(g=>g.id==='grid').count,23,'large groups give a count');
 const cue=o.cues.find(c=>c.id==='first-light');assert.ok(cue.effects.length);assert.ok(cue.on.length);assert.equal(o.pages[0].cues[0].cue,e.show.pages[0].cues[0].cue);
 assert.equal(o.live.running[0].id,'first-light');assert.deepEqual(o.live.programmer.fixtures,['401']);assert.equal(o.live.programmer.effects[0].effect,'breathe');assert.equal(o.live.output.armed,false);assert.ok(o.effects.builtIn.includes('chase'));
 assert.equal(/"calibration"|"address"|"frames"/.test(JSON.stringify(o)),false,'no per-fixture patch or values');
});
test('status and schema can be read one part at a time',async()=>{
 const e=new Engine({output:output()});
 const one=await e.command('status',{only:['cues'],ids:['afterglow']});assert.deepEqual(Object.keys(one),['show']);assert.deepEqual(one.show.cues.map(c=>c.id),['afterglow']);
 const rt=await e.command('status',{only:['runtime']});assert.equal(rt.runtime.frames,undefined);assert.equal(rt.runtime.output.armed,false);assert.ok(size(rt)<4000);
 const fr=await e.command('status',{only:['frames'],ids:['401','402']});assert.deepEqual(fr.frames.map(f=>f.id),['401','402']);
 const both=await e.command('status',{only:['groups','masters']});assert.deepEqual(Object.keys(both.show).sort(),['groups','masters']);assert.equal(both.show.groups.length,e.show.groups.length);
 assert.ok((await e.command('status')).show.cues.length,'no arguments: everything, as before');await assert.rejects(e.command('status',{only:['nope']}),/unsupported/);
 const sc=await e.command('schema',{only:['effects','code']});assert.deepEqual(Object.keys(sc).sort(),['code','effects','version']);assert.ok((await e.command('schema')).commands.overview);
});
test('MCP replies carry a brief runtime; status keeps the full one',async()=>{
 const e=new Engine({output:output()});const r=await e.command('cue.play',{id:'first-light'}),b=briefReply('cue.play',r);
 assert.ok(size(b)<2500,`brief reply ${size(b)}`);assert.ok(size(r)>size(b)*3);assert.equal(b.ok,true);assert.equal(b.runtime.frames,undefined);assert.equal(b.runtime.running[0].id,'first-light');assert.equal(b.runtime.fixtures,e.show.fixtures.length);assert.equal(typeof b.runtime.lit,'number');
 assert.equal(briefReply('status',await e.command('status')).runtime.frames.length,e.show.fixtures.length);assert.deepEqual(briefReply('output.status',{armed:false}),{armed:false});assert.equal(briefRuntime(null),null);
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',clientInfo:{name:'t',version:'1'}}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');while(out.split('\n').length<3)await new Promise(r=>setTimeout(r,20));child.kill();
 const [init,list]=out.split('\n').map(l=>l&&JSON.parse(l)),by=n=>list.result.tools.find(t=>t.name===n);
 assert.match(init.result.instructions,/lights_overview/);assert.match(init.result.instructions,/code effect/);assert.match(init.result.serverInfo.version,/^\d+\.\d+\.\d+/);
 assert.equal(by('lights_overview').annotations.readOnlyHint,true);assert.ok(by('lights_status').inputSchema.properties.only);assert.ok(by('lights_schema').inputSchema.properties.only);
});
