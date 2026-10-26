import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {defaults,migrate,EFFECT_PRESETS} from '../engine/model.mjs';import {validateShow} from '../engine/spec.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const rig=(dataDir)=>{let time=0;const e=new Engine({output:output(),clock:()=>time,dataDir});return {e,at:t=>{time=t;e.tick()}}};
const look=(id,intensity,color='#ffffff')=>({id,name:id,duration:30,loop:true,tracks:[],look:[{id:'401',values:{intensity,color}}]});
const frame=(e,id='401')=>e.frames.find(f=>f.id===id);
async function stackRig(entries){const r=rig();await r.e.command('master.set',{value:1});for(const c of [look('dim',.2),look('bright',1,'#ff0000'),look('last',.5)])await r.e.command('cue.save',{cue:c});await r.e.command('page.save',{page:{id:'act',name:'Act',cues:entries}});return r}

test('GO walks the cue list and crossfades with the entry fade',async()=>{
 const {e,at}=await stackRig([{id:'a',cue:'dim',fade:0,follow:'manual'},{id:'b',cue:'bright',fade:2,follow:'manual'},{id:'c',cue:'last',fade:0,follow:'manual'}]);
 await e.command('page.go',{id:'act'});assert.equal(e.runtime().stack.entry,'a');assert.ok(Math.abs(frame(e).intensity-.2)<1e-9);
 await e.command('page.go',{id:'act'});at(1);assert.equal(e.runtime().stack.entry,'b');assert.ok(Math.abs(frame(e).intensity-.6)<1e-9,'halfway through a 2 s fade');assert.ok(Math.abs(e.runtime().transition.progress-.5)<1e-9);
 at(2);assert.equal(frame(e).intensity,1);assert.deepEqual(frame(e).color,[1,0,0]);assert.equal(e.runtime().transition,null);
 await e.command('page.go',{id:'act'});assert.equal(frame(e).intensity,.5);await assert.rejects(e.command('page.go',{id:'act'}),/End of cue list/);
 await e.command('page.back',{});assert.equal(e.runtime().stack.entry,'b');at(4);assert.equal(frame(e).intensity,1);
 await e.command('page.go',{id:'act',entry:'a',fade:0});assert.equal(frame(e).intensity,.2);await assert.rejects(e.command('page.back',{}),/first cue/);
});

test('Auto-follow fires the next entry after its wait; manual entries wait for GO',async()=>{
 const {e,at}=await stackRig([{id:'a',cue:'dim',fade:0,follow:'auto',wait:3},{id:'b',cue:'bright',fade:0,follow:'manual'},{id:'c',cue:'last',fade:0,follow:'manual'}]);
 await e.command('page.go',{id:'act'});at(2.9);assert.equal(e.runtime().stack.entry,'a');assert.ok(Math.abs(e.runtime().stack.follow.remaining-.1)<1e-9);
 at(3);assert.equal(e.runtime().stack.entry,'b');assert.equal(frame(e).intensity,1);at(60);assert.equal(e.runtime().stack.entry,'b');
});

test('Overrides survive GO and release fades back to the running cue',async()=>{
 const {e,at}=await stackRig([{id:'a',cue:'dim',fade:0,follow:'manual'},{id:'b',cue:'bright',fade:0,follow:'manual'}]);
 await e.command('page.go',{id:'act'});await e.command('fixture.set',{ids:['401'],values:{intensity:.8}});await e.command('page.go',{id:'act'});assert.equal(frame(e).intensity,.8);
 await e.command('override.release',{fade:2});assert.deepEqual(e.overrides,{});at(1);assert.ok(Math.abs(frame(e).intensity-.9)<1e-9);assert.ok(e.runtime().release.fixtures.includes('401'));
 at(2);assert.equal(frame(e).intensity,1);assert.equal(e.runtime().release,null);
 await e.command('fixture.set',{ids:['401','402'],values:{intensity:.3}});await e.command('override.release',{ids:['402'],fade:0});assert.deepEqual(Object.keys(e.overrides),['401']);
});

test('Effect presets create cues on groups and append to pages; fades hold their end state',async()=>{
 const {e,at}=rig();await e.command('master.set',{value:1});
 const made=await e.command('effect.apply',{preset:'fade-in',group:'backlights',duration:4,page:'scene-1',fade:1});
 const cue=e.show.cues.find(c=>c.id===made.created.cue);assert.equal(cue.hold,true);assert.equal(e.show.pages[0].cues.at(-1).id,made.created.entry);
 await e.command('cue.play',{id:cue.id});at(2);const mid=frame(e).intensity;assert.ok(mid>.3&&mid<.6);at(10);assert.ok(Math.abs(frame(e).intensity-.9)<1e-6);assert.ok(e.playback,'held cue keeps playing');
 await assert.rejects(e.command('effect.apply',{preset:'circle',group:'backlights'}),/moving heads/);
 const circle=await e.command('effect.apply',{preset:'circle',group:'rogues',color:'#ff8800',name:'Swirl'});assert.equal(e.show.cues.find(c=>c.id===circle.created.cue).tracks[0].params.color,'#ff8800');
 for(const [id,p] of Object.entries(EFFECT_PRESETS))await e.command('effect.apply',{preset:id,group:p.movers?'rogues':'backlights',id:'preset-'+id});
 validateShow(e.show);
});

test('Positions recall for one group; groups and positions in use are protected',async()=>{
 const {e}=rig();await e.command('fixture.set',{ids:['301','302'],values:{pan:.4,tilt:.6}});await e.command('point.save',{id:'pulpit',name:'Pulpit',fixtures:['301','302']});
 await e.command('fixture.clear',{ids:['301','302']});await e.command('point.recall',{id:'pulpit',ids:['302','401']});assert.equal(e.overrides['301'],undefined);assert.equal(frame(e,'302').pan,.4);
 await assert.rejects(e.command('point.recall',{id:'pulpit',ids:['401']}),/No selected fixture/);
 await e.command('group.save',{id:'pair',name:'Pair',fixtures:['301','302']});await e.command('effect.apply',{preset:'circle',group:'pair',id:'pair-circle'});
 await assert.rejects(e.command('group.delete',{id:'pair'}),/Unknown group/);await e.command('cue.delete',{id:'pair-circle'});await e.command('group.delete',{id:'pair'});assert.ok(!e.show.groups.some(g=>g.id==='pair'));
 await e.command('point.delete',{id:'pulpit'});assert.equal(e.show.points.length,0);
 assert.ok(e.show.groups.find(g=>g.id==='movers').fixtures.includes('705'));
});

test('Old shows migrate to one page; deleting a cue removes its entries',async()=>{
 const old=defaults();delete old.pages;delete old.media;delete old.ledWall;const s=migrate(old);validateShow(s);assert.equal(s.pages[0].cues.length,s.cues.length);assert.equal(s.ledWall.media,'salvation-title');
 const {e}=rig();await e.command('cue.delete',{id:'prism-dance'});assert.ok(e.show.pages[0].cues.every(x=>x.cue!=='prism-dance'));
 await assert.rejects(e.command('page.save',{page:{id:'bad',name:'Bad',cues:[{id:'x',cue:'missing',fade:0,follow:'manual'}]}}),/unknown cue/);
});

test('LED wall media imports, displays and deletes through commands',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-media-'));try{
  const {e}=rig(dir);const src=path.join(dir,'logo.png');fs.writeFileSync(src,Buffer.from([0x89,0x50,0x4e,0x47]));
  await assert.rejects(e.command('media.import',{path:path.join(dir,'show.json'),name:'Not media'}),/Unsupported/);await assert.rejects(e.command('media.import',{path:'logo.png',name:'Relative'}),/absolute/);
  const {created}=await e.command('media.import',{path:src,name:'Logo'});const item=e.show.media.find(m=>m.id===created.media);assert.equal(item.kind,'image');assert.ok(fs.existsSync(path.join(dir,'media',path.basename(item.src))));
  await e.command('ledwall.set',{media:created.media,brightness:.5,fit:'contain'});assert.deepEqual(e.show.ledWall,{media:created.media,brightness:.5,fit:'contain'});
  await assert.rejects(e.command('ledwall.set',{media:'nope'}),/Unknown LED wall media/);await assert.rejects(e.command('media.delete',{id:'sunrise'}),/Built-in/);
  await e.command('media.delete',{id:created.media});assert.equal(e.show.ledWall.media,'off');assert.ok(!fs.existsSync(path.join(dir,'media',path.basename(item.src))));
  await e.command('ledwall.set',{media:'starfield'});assert.equal(new Engine({dataDir:dir,output:output()}).show.ledWall.media,'starfield');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('MCP lists every new command as a tool',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
 while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const names=JSON.parse(out.split('\n')[0]).result.tools.map(t=>t.name);
 for(const n of ['lights_page_save','lights_page_delete','lights_page_go','lights_page_back','lights_override_release','lights_effect_apply','lights_media_import','lights_media_delete','lights_ledwall_set','lights_point_delete','lights_group_delete','lights_palette_delete','lights_preview_cue','lights_preview_stop','lights_preview_go_live','lights_blind_set','lights_blind_apply','lights_settings_set','lights_group_edit','lights_patch_report','lights_fx_preview','lights_fx_apply','lights_fx_stop','lights_fx_cancel','lights_cue_record','lights_preset_save','lights_preset_delete','lights_network_configure','lights_network_status','lights_trigger_save','lights_trigger_delete','lights_trigger_fire','lights_target_save','lights_target_delete','lights_target_test'])assert.ok(names.includes(n),n);
});

test('group.edit renames, appends in order, removes, and keeps at least one member',async()=>{
 const {e}=rig();await e.command('group.save',{id:'pair',name:'Pair',fixtures:['301','302']});
 await e.command('group.edit',{id:'pair',name:'Downstage',add:['302','303','304'],remove:['301']});
 assert.deepEqual(e.show.groups.find(g=>g.id==='pair'),{id:'pair',name:'Downstage',fixtures:['302','303','304']});
 await assert.rejects(e.command('group.edit',{id:'pair',remove:['302','303','304']}),/at least one/);
 await assert.rejects(e.command('group.edit',{id:'pair',add:['nope']}),/Unknown fixture/);await assert.rejects(e.command('group.edit',{id:'missing',name:'X'}),/Unknown group/);
});

test('Agents appear while their MCP server says hello and drop out after 30 s; hello is not an agent tool',async()=>{
 let time=0;const e=new Engine({output:{armed:false,send(){},status(){return {armed:false}}},clock:()=>time});
 await e.command('agent.hello',{session:'s1',client:'claude-code',version:'2.1'});assert.deepEqual(e.runtime().agents.map(a=>a.client),['claude-code']);
 time=25;await e.command('agent.hello',{session:'s1',client:'claude-code',version:'2.1'});time=50;assert.equal(e.runtime().agents.length,1);assert.equal(e.runtime().agents[0].connectedFor,50);
 time=81;assert.equal(e.runtime().agents.length,0);assert.ok(e.logs.filter(l=>l.message.startsWith('Agent connected')).length===1,'heartbeats are not logged');
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 assert.ok(!JSON.parse(out.split('\n')[0]).result.tools.some(t=>t.name==='lights_agent_hello'));
});
