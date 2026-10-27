import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {validateShow} from '../engine/spec.mjs';import {hiddenFixtureIds,visibleFixtures} from '../public/visibility.js';
// Start from the real rig with nothing hidden: the operator's own preview hides in data/show.json are not part of the test.
const seed=JSON.stringify({...JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8')),visualizer:{hiddenGroups:[],hiddenFixtures:[]}});
const engineWithShow=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vis-'));fs.writeFileSync(path.join(dir,'show.json'),seed);return {engine:new Engine({dataDir:dir}),dir}};
test('visualizer.hide hides groups and fixtures from the 3D view only, persists, and reads back',async()=>{
 const {engine,dir}=engineWithShow(),house=engine.show.groups.find(g=>g.id==='house-lights').fixtures;
 const r=await engine.command('visualizer.hide',{groups:['house-lights'],hidden:true});
 assert.equal(r.created.visualizer.drawn,engine.show.fixtures.length-house.length);
 await engine.command('visualizer.hide',{fixtures:['401'],hidden:true});
 const st=await engine.command('visualizer.status');assert.deepEqual([st.hiddenGroups,st.hiddenFixtures],[['house-lights'],['401']]);assert.equal(st.hidden.length,house.length+1);
 assert.ok(!visibleFixtures(engine.show).some(f=>house.includes(f.id)||f.id==='401'));
 // Preview only: hidden fixtures still exist, patch and output untouched.
 assert.equal(engine.show.fixtures.length,JSON.parse(seed).fixtures.length);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'show.json'),'utf8'));validateShow(saved);assert.deepEqual(saved.visualizer.hiddenGroups,['house-lights']);
 // Showing the group again also clears per-fixture hides inside it; 401 is not in it and stays hidden.
 await engine.command('visualizer.hide',{fixtures:[house[0]],hidden:true});await engine.command('visualizer.hide',{groups:['house-lights'],hidden:false});
 assert.deepEqual([...hiddenFixtureIds(engine.show)],['401']);
 await assert.rejects(engine.command('visualizer.hide',{hidden:true}),/Name groups/);await assert.rejects(engine.command('visualizer.hide',{groups:['nope'],hidden:true}),/Unknown group/);
 await engine.close?.();fs.rmSync(dir,{recursive:true,force:true});
});
test('deleting a hidden group removes it from the visualizer settings',async()=>{
 const {engine,dir}=engineWithShow();await engine.command('group.save',{id:'tmp',name:'Tmp',fixtures:['401']});
 await engine.command('visualizer.hide',{groups:['tmp'],hidden:true});await engine.command('group.delete',{id:'tmp'});
 assert.deepEqual(engine.show.visualizer.hiddenGroups,[]);validateShow(engine.show);await engine.close?.();fs.rmSync(dir,{recursive:true,force:true});
});
test('MCP exposes the visualizer visibility tools',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 assert.ok(by('lights_visualizer_hide'));assert.equal(by('lights_visualizer_status').annotations.readOnlyHint,true);
 assert.equal(by('lights_fixture_set').inputSchema.properties.ids.maxItems,512);
});
