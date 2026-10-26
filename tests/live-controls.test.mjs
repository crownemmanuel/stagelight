import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createLiveControl} from '../public/live-controls.js';
import {Engine} from '../engine/engine.mjs';

test('Dragging sends immediately, merges attributes and keeps the original selection',async()=>{
 const calls=[];let release;const first=new Promise(r=>release=r);
 const send=createLiveControl(async(ids,values)=>{calls.push({ids,values});if(calls.length===1)await first},1);
 const ids=['401'];send(ids,{intensity:.2});
 assert.equal(calls.length,1,'The first change must not wait until dragging stops');
 send(ids,{intensity:.4});send(ids,{color:'#ff0000'});send(ids,{intensity:.8});ids[0]='402';
 send(ids,{intensity:.6});release();await delay(20);
 assert.deepEqual(calls,[{ids:['401'],values:{intensity:.2}},{ids:['401'],values:{intensity:.8,color:'#ff0000'}},{ids:['402'],values:{intensity:.6}}]);
});

test('Intensity overrides update a paused preview and respect the master',async()=>{
 const engine=new Engine();await engine.command('cue.play',{id:'afterglow'});await engine.command('cue.pause',{paused:true});
 await engine.command('fixture.set',{ids:['405'],values:{intensity:0}});assert.equal(engine.frames.find(f=>f.id==='405').intensity,0);
 await engine.command('fixture.set',{ids:['405'],values:{intensity:1}});assert.equal(engine.frames.find(f=>f.id==='405').intensity,.8);
 assert.equal(engine.output.armed,false);assert.equal(engine.output.status().packets,0);
});

test('A rejected control edit does not block subsequent edits',async()=>{
 let calls=0;const errors=[];
 const edit=createLiveControl(async()=>{calls++;if(calls===1)throw Error('offline')},1,e=>errors.push(e.message));
 edit(['401'],{intensity:.2});edit(['401'],{intensity:.4});await delay(20);
 assert.equal(calls,2);assert.deepEqual(errors,['offline']);
});
