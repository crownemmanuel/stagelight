import test from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../engine/engine.mjs';import {encode} from '../engine/render.mjs';
const output=()=>({armed:false,sent:[],send(p){if(this.armed)this.sent.push(p)},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const look=(id,intensity,color='#ffffff')=>({id,name:id,duration:30,loop:true,tracks:[],look:[{id:'401',values:{intensity,color}}]});
async function rig(){let time=0;const out=output(),e=new Engine({output:out,clock:()=>time});await e.command('master.set',{value:1});for(const c of [look('dim',.2),look('bright',1,'#ff0000')])await e.command('cue.save',{cue:c});await e.command('page.save',{page:{id:'act',name:'Act',cues:[{id:'a',cue:'dim',fade:0,follow:'manual'},{id:'b',cue:'bright',fade:2,follow:'manual'}]}});return {e,out,at:t=>{time=t;e.tick()}}}
const live=(e,id='401')=>e.frames.find(f=>f.id===id);const prev=(e,id='401')=>e.runtime().previewFrames.find(f=>f.id===id);

test('Preview renders a cue beside live output without touching frames or packets',async()=>{
 const {e,out,at}=await rig();out.armed=true;await e.command('page.go',{id:'act'});
 const before=encode(e.show,e.frames,{physical:true});
 await e.command('preview.cue',{page:'act',entry:'b'});assert.equal(e.runtime().preview.entry,'b');
 at(1);assert.ok(Math.abs(prev(e).intensity-.6)<1e-9,'preview crossfades from the live look with the entry fade');assert.equal(live(e).intensity,.2);
 at(2);assert.equal(prev(e).intensity,1);assert.deepEqual(prev(e).color,[1,0,0]);assert.equal(live(e).intensity,.2);
 assert.deepEqual(encode(e.show,e.frames,{physical:true}),before,'live packets unchanged');assert.equal(e.runtime().stack.entry,'a');
 await e.command('preview.stop');assert.equal(e.runtime().preview,null);assert.equal(e.runtime().previewFrames,null);
});

test('Send to live GOes the previewed entry; library cues and unsaved cues behave safely',async()=>{
 const {e,at}=await rig();await e.command('page.go',{id:'act'});
 await e.command('preview.cue',{page:'act',entry:'b'});await e.command('preview.go_live',{requestId:'p1'});at(0);
 assert.equal(e.runtime().stack.entry,'b');assert.equal(e.runtime().preview,null);at(2);assert.equal(live(e).intensity,1);
 await e.command('preview.cue',{id:'dim'});await e.command('preview.go_live',{fade:0});assert.equal(e.playback.cue.id,'dim');assert.equal(e.runtime().stack,null);
 const unsaved={id:'draft',name:'Draft',duration:10,loop:true,tracks:[{group:'backlights',effect:'chase',start:0,duration:10,params:{color:'#00ff00'}}]};
 await e.command('preview.cue',{cue:unsaved});at(3);assert.ok(e.runtime().previewFrames.some(f=>f.intensity>0));await assert.rejects(e.command('preview.go_live',{}),/Save this cue/);
 await assert.rejects(e.command('preview.cue',{id:'dim',page:'act',entry:'a'}),/exactly one/);await assert.rejects(e.command('preview.cue',{cue:{...unsaved,tracks:[{...unsaved.tracks[0],group:'nope'}]}}),/Unknown group/);
 await e.command('preview.stop');await assert.rejects(e.command('preview.go_live',{}),/Nothing in preview/);
});

test('Preview loops one-shot cues and holds hold cues',async()=>{
 const {e,at}=await rig();await e.command('cue.save',{cue:{id:'shot',name:'Shot',duration:4,loop:false,tracks:[],look:[{id:'401',values:{intensity:.5,color:'#ffffff'}}]}});
 await e.command('preview.cue',{id:'shot'});at(5);assert.ok(Math.abs(e.runtime().preview.elapsed-1)<1e-9);assert.equal(prev(e).intensity,.5);
});
