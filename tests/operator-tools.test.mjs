// Operator tools added for show day: manual fade, copy a look, undo in the programmer, undo of the last show edit.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const make=(opts={})=>{const clock={now:0},e=new Engine({output:output(),clock:()=>clock.now,...opts});return {e,clock,at(t){clock.now=t;e.tick();return new Map(e.frames.map(f=>[f.id,f]))}}};
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-6,`${m??''} ${a} ≠ ${b}`);

test('manual changes can fade in, each fixture on its own clock',async()=>{
 const {e,clock,at}=make();at(0);
 await e.command('fixture.set',{ids:['401'],values:{intensity:1},fade:2});near(at(1).get('401').intensity,.5,'halfway');
 // A second fixture starts its own fade; the first is not restarted.
 await e.command('fixture.set',{ids:['402'],values:{intensity:1},fade:2});let f=at(2);near(f.get('401').intensity,1,'401 done');near(f.get('402').intensity,.5,'402 halfway');
 f=at(3.1);near(f.get('402').intensity,1);assert.equal(e.runtime().release,null,'release finished');
 // No fade given and manualFade unset: a change snaps, as before.
 await e.command('fixture.set',{ids:['403'],values:{intensity:.7}});near(at(3.2).get('403').intensity,.7);
 // The show default applies to palettes and positions too.
 await e.command('settings.set',{manualFade:1});assert.equal(e.show.playback.manualFade,1);clock.now=10;
 await e.command('fixture.set',{ids:['404'],values:{intensity:1}});near(at(10.5).get('404').intensity,.5);await e.command('fixture.set',{ids:['405'],values:{intensity:1},fade:0});near(at(10.6).get('405').intensity,1,'fade 0 still snaps');
});

test('look.copy copies what each target can do, in order, into the programmer',async()=>{
 const {e,at}=make();
 await e.command('fixture.set',{ids:['401'],values:{intensity:.8,color:'#ff0000',zoom:.2}});await e.command('fixture.set',{ids:['402'],values:{intensity:.4,color:'#0000ff',zoom:.9}});at(1);
 const rogues=e.show.groups.find(g=>g.id==='rogues').fixtures,r=await e.command('look.copy',{from:{ids:['401','402']},to:{group:'rogues'}});
 assert.equal(r.created.copied,rogues.length);const f=at(2);
 near(f.get(rogues[0]).intensity,.8);assert.deepEqual(f.get(rogues[0]).color,[1,0,0]);near(f.get(rogues[1]).intensity,.4);assert.deepEqual(f.get(rogues[1]).color,[0,0,1]);near(f.get(rogues[2]).intensity,.8,'the source repeats');
 assert.equal(e.overrides[rogues[0]].zoom,undefined,'a Rogue has no zoom');assert.equal(e.overrides[rogues[0]].pan,undefined,'position is not copied unless asked');
 const only=await e.command('look.copy',{from:{ids:[rogues[0]]},to:{ids:['403']},parts:['color']});assert.deepEqual(Object.keys(e.overrides['403']).sort(),['color','white'],'the colour family only');assert.equal(only.created.copied,1);
 await assert.rejects(e.command('look.copy',{from:{},to:{group:'rogues'}}),/give a group or ids/);await assert.rejects(e.command('look.copy',{from:{group:'nope'},to:{group:'rogues'}}),/Unknown group/);
 assert.equal(e.revision,1,'nothing saved');
});

test('override.undo steps the programmer back; a burst of changes is one step',async()=>{
 const {e,clock}=make();const go=async(c,a)=>{clock.now+=1;return e.command(c,a)};
 await assert.rejects(e.command('override.undo',{}),/Nothing to undo/);
 await go('fixture.set',{ids:['401'],values:{intensity:.5}});
 // A slider drag: many changes a few frames apart.
 clock.now+=1;for(const v of [.6,.7,.8,.9]){clock.now+=.05;await e.command('fixture.set',{ids:['401'],values:{intensity:v}})}
 await go('palette.apply',{id:e.show.palettes[0].id,ids:['401','402']});await go('fx.apply',{fixtures:['401','402'],preset:'breathe',fade:0});
 assert.equal(e.runtime().programmerUndo.available,4);
 await go('override.undo',{fade:0});assert.equal(e.fx.length,0,'the effect is gone');assert.ok(e.overrides['402'].color,'the palette stays');
 await go('override.undo',{fade:0});assert.equal(e.overrides['402'],undefined);assert.equal(e.overrides['401'].intensity,.9);
 await go('override.undo',{fade:0});assert.equal(e.overrides['401'].intensity,.5,'the whole drag is one step');
 await go('override.undo',{fade:0});assert.deepEqual(e.overrides,{});await assert.rejects(e.command('override.undo',{}),/Nothing to undo/);
 // Clear can be undone, and a cue is never touched.
 await go('fixture.set',{ids:['403'],values:{intensity:1}});await go('override.release',{fade:0});assert.deepEqual(e.overrides,{});await go('override.undo',{fade:0});assert.equal(e.overrides['403'].intensity,1);assert.equal(e.revision,1);
});

test('show.undo puts back the last show edit, live and armed, and a delete always leaves a version behind',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-undo-'));try{
  const {e}=make({dataDir:dir});await assert.rejects(e.command('show.undo',{}),/Nothing to undo/);
  await e.command('cue.play',{id:'first-light'});e.output.armed=true;
  const pagesBefore=JSON.stringify(e.show.pages),n=e.show.cues.length;
  await e.command('cue.delete',{id:'afterglow'});assert.equal(e.show.cues.length,n-1);assert.equal(e.runtime().showUndo.label,'cue.delete');
  assert.ok(e.versions.list().some(v=>v.reason==='before-delete'),'a version was written first');
  const r=await e.command('show.undo',{});assert.equal(r.created.undone,'cue.delete');assert.equal(e.show.cues.length,n);assert.equal(JSON.stringify(e.show.pages),pagesBefore,'its cue list entries are back too');
  assert.equal(e.runtime().running[0].id,'first-light','what was playing kept playing');assert.equal(e.output.armed,true);
  await e.command('show.undo',{});assert.equal(e.show.cues.length,n-1,'again = redo');await e.command('show.undo',{});
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'show.json'),'utf8')).cues.length,n,'and it is on disk');
  // Locked: no undo. After an import there is nothing to undo.
  await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('show.undo',{}),/performance lock/);await e.command('performance.lock',{enabled:false});
  e.output.armed=false;await e.command('show.import',{show:JSON.parse(JSON.stringify(e.show))});assert.equal(e.runtime().showUndo,null);await assert.rejects(e.command('show.undo',{}),/Nothing to undo/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('a Stop all key can be set; MCP exposes the new tools',async()=>{
 const {e}=make();await e.command('masters.save',{desk:{...e.show.masters.desk,stop:'f12'}});assert.equal(e.show.masters.desk.stop,'f12');await assert.rejects(e.command('masters.key',{slot:'m1',key:'f12'}),/Stop all key/);
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 for(const n of ['lights_look_copy','lights_override_undo','lights_show_undo'])assert.ok(by(n),n);assert.ok(by('lights_fixture_set').inputSchema.properties.fade);assert.ok(by('lights_settings_set').inputSchema.properties.manualFade);
});
