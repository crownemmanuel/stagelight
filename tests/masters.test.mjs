import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {MASTER_KEYS,defaults,migrate} from '../engine/model.mjs';import {validateShow} from '../engine/spec.mjs';import {routeOSC} from '../engine/osc-routes.mjs';
// Masters (docs/MASTERS-AND-SCENES.md): slots that hold a cue and fire it from a key: flash, toggle, go, pause or release.
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const rig=()=>{let time=0;const e=new Engine({output:output(),clock:()=>time});return {e,at:t=>{time=t;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
const look=(id,ids)=>({id,name:id,duration:30,loop:true,tracks:[],look:ids.map(f=>({id:f,values:{intensity:1}}))});
const setup=async e=>{await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('c301',['301'])});await e.command('cue.save',{cue:look('c401',['401'])})};
const running=e=>e.running().map(l=>l.cue.id).sort();
const press=async(e,slot)=>{await e.command('masters.trigger',{slot,down:true});await e.command('masters.trigger',{slot,down:false})};

test('a new show has 18 blank flash masters on A S D F G H J K L, with Highlight on Shift+H',()=>{
 const {e}=rig(),m=e.show.masters;assert.equal(m.slots.length,18);assert.deepEqual(m.slots.slice(0,9).map(s=>s.key),MASTER_KEYS);assert.ok(MASTER_KEYS.includes('h'));
 assert.ok(m.slots.every(s=>s.action==='flash'&&!s.cue&&s.fade===0));assert.ok(m.slots.slice(9).every(s=>!s.key));assert.deepEqual(m.desk,{highlight:'shift+h',clear:'c',blackout:'b'});
 const old=defaults();delete old.masters;delete old.scenes;validateShow(migrate(old));
});

test('flash plays while held and releases on let go, but never lets go of a cue it did not start',async()=>{
 const {e,at,frame}=rig();await setup(e);await e.command('masters.assign',{slot:'m1',cue:'c301'});
 await e.command('masters.trigger',{slot:'m1',down:true});at(.1);assert.deepEqual(running(e),['c301']);assert.equal(frame('301').intensity,1);assert.deepEqual(e.runtime().masters.held,['m1']);
 await e.command('masters.trigger',{slot:'m1',down:false});at(.2);assert.deepEqual(running(e),[]);assert.equal(frame('301').intensity,0);assert.deepEqual(e.runtime().masters.held,[]);
 await e.command('cue.play',{id:'c301'});await press(e,'m1');assert.deepEqual(running(e),['c301'],'already running from elsewhere: the flash leaves it alone');
 await e.command('cue.stop',{fade:0});await e.command('masters.assign',{slot:'m1',fade:1});at(1);await e.command('masters.trigger',{slot:'m1',down:true});at(1.5);assert.ok(Math.abs(frame('301').intensity-.5)<.02,'flash fades in over the slot fade');
 await e.command('masters.trigger',{slot:'m1',down:false});at(2);assert.ok(frame('301').intensity>0,'and fades out');at(2.6);assert.equal(frame('301').intensity,0);
 await assert.rejects(e.command('masters.trigger',{slot:'m2',down:true}),/Master 2 has no cue/);await e.command('masters.trigger',{slot:'m2',down:false});
});

test('a flash over a cue that uses the same fixtures hands them back on let go instead of retiring it',async()=>{
 const {e,at,frame}=rig();await setup(e);await e.command('cue.save',{cue:{id:'blue',name:'blue',duration:30,loop:true,tracks:[],look:[{id:'301',values:{intensity:.4,color:'#0000ff'}}]}});
 await e.command('masters.assign',{slot:'m1',cue:'c301'});await e.command('cue.play',{id:'blue'});at(.1);
 await e.command('masters.trigger',{slot:'m1',down:true});at(.2);assert.equal(frame('301').intensity,1);assert.deepEqual(running(e),['blue','c301']);
 await e.command('masters.trigger',{slot:'m1',down:false});at(.3);assert.equal(frame('301').intensity,.4,'the cue underneath shows again');assert.deepEqual(running(e),['blue']);
});

test('toggle, go, pause and release actions; masters keep manual changes and the page cue list',async()=>{
 const {e,at}=rig();await setup(e);
 await e.command('masters.assign',{slot:'m2',cue:'c401',action:'toggle'});await press(e,'m2');assert.deepEqual(running(e),['c401'],'toggle on stays on after let go');await press(e,'m2');assert.deepEqual(running(e),[],'second press releases');
 await e.command('masters.assign',{slot:'m3',cue:'c301',action:'go'});await press(e,'m3');at(5);await press(e,'m3');assert.equal(e.runningCue('c301').started,5,'go restarts');
 await e.command('masters.assign',{slot:'m4',cue:'c301',action:'pause'});await press(e,'m4');assert.equal(e.runningCue('c301').paused,true);await press(e,'m4');assert.equal(e.runningCue('c301').paused,false);
 await e.command('masters.assign',{slot:'m5',cue:'c301',action:'release'});await press(e,'m5');assert.deepEqual(running(e),[]);await press(e,'m4');assert.deepEqual(running(e),[],'pause does nothing while the cue is stopped');
 await e.command('fixture.set',{ids:['402'],values:{intensity:.4}});await e.command('page.go',{id:'scene-1'});await press(e,'m2');
 assert.ok(e.overrides['402'],'manual changes stay');assert.equal(e.runtime().stack.page,'scene-1','the page stack stays');assert.deepEqual(running(e),['c401','first-light']);
});

test('auto-follow times the page cue even while a master cue is on top',async()=>{
 const {e,at}=rig();await setup(e);await e.command('masters.assign',{slot:'m1',cue:'c301',action:'toggle'});
 await e.command('page.go',{id:'scene-1',entry:'entry-2'});at(30);await press(e,'m1');assert.equal(e.playback.cue.id,'c301');
 at(59);assert.equal(e.runtime().stack.entry,'entry-2');at(60.1);assert.equal(e.runtime().stack.entry,'entry-3','prism-dance ran 60 s, then afterglow followed');
});

test('keys: a taken key is refused with its owner named, then swapped or taken; desk shortcuts too; reserved keys never',async()=>{
 const {e}=rig();await setup(e);await e.command('masters.assign',{slot:'m2',cue:'c401'});const key=id=>e.show.masters.slots.find(s=>s.id===id).key;
 await assert.rejects(e.command('masters.key',{slot:'m1',key:'s'}),/S is already on Master 2 · c401/);assert.equal(key('m1'),'a');
 await e.command('masters.key',{slot:'m1',key:'s',conflict:'swap'});assert.equal(key('m1'),'s');assert.equal(key('m2'),'a');
 await e.command('masters.key',{slot:'m1',key:'d',conflict:'take'});assert.equal(key('m1'),'d');assert.equal(key('m3'),undefined);
 await assert.rejects(e.command('masters.key',{slot:'m10',key:'b'}),/the Blackout key/);await e.command('masters.key',{slot:'m10',key:'b',conflict:'take'});assert.equal(key('m10'),'b');assert.equal(e.show.masters.desk.blackout,undefined);
 await e.command('masters.key',{slot:'m11',key:'shift+h',conflict:'swap'});assert.equal(e.show.masters.desk.highlight,undefined,'nothing to swap back: Highlight is left without a key');
 for(const bad of [' ','space','arrowleft','enter','cmd+a'])await assert.rejects(e.command('masters.key',{slot:'m1',key:bad}));
 await e.command('masters.key',{slot:'m1',clear:true});assert.equal(key('m1'),undefined);
 await assert.rejects(e.command('masters.save',{slots:[{id:'x',key:'a',action:'flash',fade:0},{id:'y',key:'a',action:'flash',fade:0}]}),/used twice/);
});

test('deleting a cue empties its masters; masters.save adds slots; OSC presses by number, ID or key',async()=>{
 const {e}=rig();await setup(e);await e.command('masters.assign',{slot:'m1',cue:'c301',label:'Hit'});await e.command('masters.assign',{slot:'m4',cue:'c301'});
 await e.command('cue.delete',{id:'c301'});assert.ok(!e.show.masters.slots.some(s=>s.cue==='c301'));
 await e.command('masters.save',{slots:[...e.show.masters.slots,{id:'m19',action:'toggle',fade:0}]});assert.equal(e.show.masters.slots.length,19);
 await e.command('masters.assign',{slot:'m1',clear:true});assert.equal(e.show.masters.slots[0].label,undefined);
 const rt=e.runtime();for(const ref of [1,'m1','a'])assert.deepEqual(routeOSC('/stagelight/masters/trigger',[ref,1],e.show,rt),{command:'masters.trigger',args:{slot:'m1',down:true}});
 assert.throws(()=>routeOSC('/stagelight/masters/trigger',['m1',2],e.show,rt),/1 \(press\) or 0/);
});

test('MCP lists the masters and scene tools',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 for(const n of ['masters_trigger','masters_assign','masters_key','masters_save','scene_capture','scene_save','scene_delete','scene_go','scene_release'])assert.ok(by('lights_'+n),n);
 assert.deepEqual(by('lights_masters_trigger').inputSchema.required,['slot','down']);
});
