import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../engine/engine.mjs';import {COMMANDS,validateShow} from '../engine/spec.mjs';
// Kills and cues with only some parts (docs/KILL.md, docs/CUE-PLAYBACK.md), operator requests 2026-11-01.
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const rig=()=>{let t=0;const e=new Engine({output:output(),clock:()=>t});return {e,at:x=>{t=x;e.tick()},frame:id=>e.frames.find(f=>f.id===id)}};
const look=(id,entries,extra={})=>({id,name:id,duration:30,loop:true,tracks:[],look:entries,...extra});
const base=look('base',[{id:'301',values:{intensity:.4,color:'#ff0000',pan:.2,tilt:.3}},{id:'401',values:{intensity:.5,color:'#0000ff'}}]);

test('A cue with only intensity lifts the heads and leaves colour and position to the look underneath, which it never retires',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:base});
 await e.command('cue.save',{cue:look('hit',[{id:'301',values:{intensity:1}}],{only:['intensity']})});
 await e.command('cue.play',{id:'base'});at(.1);await e.command('cue.play',{id:'hit'});at(.2);
 assert.equal(frame('301').intensity,1);assert.deepEqual(frame('301').color,[1,0,0],'colour from below');assert.equal(frame('301').pan,.2,'position from below');
 assert.equal(frame('401').intensity,.5,'untouched fixtures keep the look');assert.deepEqual(e.runtime().running.map(r=>r.id),['hit','base'],'the look underneath is not retired');
 await e.command('cue.release',{id:'hit',fade:0});at(.3);assert.equal(frame('301').intensity,.4,'releasing it shows the look again');
 validateShow(e.show);
});

test('Save just the changes, or only some parts, like Hog record masks',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:base});await e.command('cue.play',{id:'base'});at(.1);
 await e.command('fixture.set',{ids:['301'],values:{intensity:1,color:'#00ff00'}});
 const r=await e.command('cue.record',{id:'drums',name:'Drums hit',changes:true,only:['intensity']});
 const c=e.show.cues.find(x=>x.id==='drums');assert.deepEqual(c.only,['intensity']);assert.deepEqual(c.look,[{id:'301',values:{intensity:1}}],'only the changed intensity, no colour');assert.equal(r.created.updated,false);
 await e.command('fixture.set',{ids:['301'],values:{intensity:1,color:'#00ff00'}});
 await e.command('cue.record',{id:'colours',name:'Colours',mode:'replace',only:['color']});const k=e.show.cues.find(x=>x.id==='colours');
 assert.deepEqual(k.only,['color']);assert.ok(k.look.every(x=>Object.keys(x.values).every(a=>['color','white','amber','mint','colorWheel','colorWheel2'].includes(a))),'colour attributes only');
 await e.command('fixture.set',{ids:['401'],values:{intensity:.9,color:'#ffffff'}});await e.command('cue.record',{id:'base',only:['intensity']});
 const b=e.show.cues.find(x=>x.id==='base').look.find(x=>x.id==='401'&&x.over);assert.deepEqual(b.values,{intensity:.9},'update with a mask merges only those parts');
 assert.ok(COMMANDS['cue.record'].schema.properties.only&&COMMANDS['cue.record'].schema.properties.changes);
});

test('Kill turns a group or a master\'s lights off over every cue and toggled master; held flashes and sound hits still punch through',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:base});
 await e.command('cue.save',{cue:look('back-up',[{id:'401',values:{intensity:1,color:'#ffffff'}},{id:'402',values:{intensity:1,color:'#ffffff'}}])});
 await e.command('masters.assign',{slot:'m2',cue:'back-up',priority:true,soloKill:true});assert.equal(e.show.masters.slots[1].soloKill,true);
 await e.command('cue.play',{id:'base'});await e.command('masters.trigger',{slot:'m2',down:true});at(.1);assert.equal(frame('401').intensity,1);
 await e.command('masters.trigger',{slot:'m2',down:false});const k=await e.command('kill.set',{slot:'m2'});assert.equal(k.created.killed,true);at(.2);
 assert.equal(frame('401').intensity,0);assert.equal(frame('301').intensity,.4,'other lights untouched');
 assert.deepEqual(e.runtime().kills,[{slot:'m2',master:2,name:'back-up'}]);
 await e.command('fixture.set',{ids:['401'],values:{intensity:1}});await e.command('highlight.set',{enabled:true});at(.3);assert.equal(frame('401').intensity,0,'over programmer and Highlight');await e.command('highlight.set',{enabled:false});
 // A held master flash or sound hit still punches through a kill, even the killed master's own (operator, 2026-11-01).
 await e.command('masters.trigger',{slot:'m2',down:false});await e.command('override.release',{fade:0});at(.31);assert.equal(frame('401').intensity,0);
 await e.command('masters.trigger',{slot:'m2',down:true});at(.32);assert.equal(frame('401').intensity,1,'the hit shows through the kill');
 await e.command('masters.trigger',{slot:'m2',down:false});at(.33);assert.equal(frame('401').intensity,0,'killed again when the hit lets go');
 await e.command('cue.save',{cue:look('heads',[{id:'301',values:{intensity:1}}],{only:['intensity']})});await e.command('masters.assign',{slot:'m3',cue:'heads',priority:true});
 await e.command('kill.set',{group:'rogues',killed:true});at(.34);assert.equal(frame('301').intensity,0);await e.command('masters.trigger',{slot:'m3',down:true});at(.35);
 assert.equal(frame('301').intensity,1,'an intensity-only drum hit shows through a group kill');assert.deepEqual(frame('301').color,[1,0,0],'in the colour of the look');
 await e.command('masters.trigger',{slot:'m3',down:false});await e.command('kill.set',{group:'rogues',killed:false});await e.command('override.release',{fade:0});
 await e.command('masters.trigger',{slot:'m2',down:true});
 await e.command('kill.set',{slot:'m2'});at(.4);assert.equal(frame('401').intensity,1,'unkilled: whatever is live comes back');
 await e.command('masters.trigger',{slot:'m2',down:false});await e.command('kill.set',{group:'backlights',killed:true});at(.5);assert.ok(e.show.groups.find(g=>g.id==='backlights').fixtures.every(id=>frame(id).intensity===0));
 await e.command('kill.clear',{});at(.6);assert.deepEqual(e.runtime().kills,[]);assert.equal(frame('401').intensity,.5,'back to the running look');
 await assert.rejects(e.command('kill.set',{slot:'m9'}),/has no cue/);await assert.rejects(e.command('kill.set',{}),/group or a master/);
 await e.command('performance.lock',{enabled:true});await e.command('kill.set',{group:'backlights'});assert.equal(e.runtime().kills.length,1,'kill works under the lock');
});

test('Stop settles a cue back over its own releaseFade',async()=>{
 const {e,at,frame}=rig();await e.command('cue.save',{cue:base});await e.command('cue.save',{cue:look('move',[{id:'301',values:{pan:.8}}],{only:['position'],releaseFade:4})});
 await e.command('cue.play',{id:'base'});await e.command('cue.play',{id:'move'});at(1);assert.equal(frame('301').pan,.8);
 await e.command('cue.release',{id:'move'});at(3);const mid=frame('301').pan;assert.ok(mid>.2&&mid<.8,'still settling after 2 s');at(5.1);assert.equal(frame('301').pan,.2,'home after 4 s');
});

test('A newer full cue takes its fixtures back from an older movement cue',async()=>{
 const {e,at,frame}=rig();await e.command('cue.save',{cue:base});
 await e.command('cue.save',{cue:look('swing',[{id:'301',values:{pan:.8}}],{only:['position']})});await e.command('cue.save',{cue:look('still',[{id:'301',values:{intensity:1,pan:.4,tilt:.5}}])});
 await e.command('cue.play',{id:'base'});await e.command('cue.play',{id:'swing'});at(1);assert.equal(frame('301').pan,.8,'movement over the older look');
 await e.command('cue.play',{id:'still'});at(2);assert.equal(frame('301').pan,.4,'the newer still look wins');
 assert.ok(!e.runtime().running.some(r=>r.id==='swing'),'a movement cue whose heads are all taken retires, like any covered cue');
});

test('Fader to zero releases what the master started, key included; a key press with the fader at zero comes up at full',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:look('chase',[{id:'401',values:{intensity:1}}])});
 await e.command('masters.assign',{slot:'m8',cue:'chase',action:'toggle',priority:true});await e.command('masters.level',{slot:'m8',level:0,go:false});
 await e.command('masters.trigger',{slot:'m8',down:true});await e.command('masters.trigger',{slot:'m8',down:false});at(.1);assert.equal(frame('401').intensity,1,'pressed at fader zero: full, not invisible');
 await e.command('masters.level',{slot:'m8',level:.5});at(.2);assert.equal(frame('401').intensity,.5);
 await e.command('masters.level',{slot:'m8',level:0});at(.3);assert.ok(!e.runtime().running.some(r=>r.id==='chase'),'fader down released the key-started cue');
 await e.command('cue.save',{cue:look('other',[{id:'402',values:{intensity:1}}])});await e.command('cue.play',{id:'other'});await e.command('masters.assign',{slot:'m7',cue:'other'});
 await e.command('masters.level',{slot:'m7',level:0});at(.4);assert.ok(e.runtime().running.some(r=>r.id==='other'),'a cue started elsewhere is never released by a fader');
});

test('A part cue wave only takes each fixture while its own step runs; the others keep the look underneath',async()=>{
 const {e,at,frame}=rig();await e.command('master.set',{value:1});await e.command('cue.save',{cue:base});
 const step=(id,start)=>({fixtures:[id],effect:'static',start,duration:1,params:{color:'#ffffff',brightness:1},fadeIn:0,fadeOut:0});
 await e.command('cue.save',{cue:look('wave',[],{only:['intensity','color'],duration:2,tracks:[step('401',0),step('301',1)]})});
 await e.command('cue.play',{id:'base'});await e.command('cue.play',{id:'wave'});at(.5);
 assert.equal(frame('401').intensity,1);assert.deepEqual(frame('401').color,[1,1,1],'401 flashes white in its step');assert.equal(frame('301').intensity,.4);assert.deepEqual(frame('301').color,[1,0,0],'301 keeps its look while waiting');
 at(1.5);assert.equal(frame('401').intensity,.5);assert.deepEqual(frame('401').color,[0,0,1],'401 back to its blue look');assert.deepEqual(frame('301').color,[1,1,1]);
});

test('Release all on a page stops its running cues and leaves masters and other pages',async()=>{
 const {e,at}=rig();await e.command('cue.save',{cue:base});await e.command('cue.save',{cue:look('fx',[{id:'301',values:{intensity:1}}],{only:['intensity']})});await e.command('cue.save',{cue:look('other',[{id:'402',values:{intensity:1}}])});
 await e.command('page.save',{page:{id:'pg',name:'Pg',cues:[{id:'a',cue:'base',fade:0,follow:'manual'},{id:'b',cue:'fx',fade:0,follow:'manual'}]}});
 await e.command('cue.play',{id:'other'});await e.command('page.go',{id:'pg',entry:'a'});await e.command('page.go',{id:'pg',entry:'b'});at(1);
 const r=await e.command('page.release',{id:'pg',fade:0});at(2);assert.deepEqual(r.created.released.sort(),['base','fx']);assert.deepEqual(e.runtime().running.map(x=>x.id),['other'],'other cues keep running');
});
