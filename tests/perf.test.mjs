import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {performance} from 'node:perf_hooks';
import {Engine} from '../engine/engine.mjs';import {migrate} from '../engine/model.mjs';
// Engine budget for the real rig (docs/VISUALIZER-PERFORMANCE.md): the 30 Hz tick must stay far inside its 33 ms slot
// with every effect, a preview, blind edits and a Look Link change-mode target running at once. The limit is generous
// for slow CI machines; the point is to catch work that grows with the square of the fixture count.
const output=()=>({armed:false,sent:[],send(){},status(){return {armed:false,packets:0,interfaces:[]}},async arm(){},close(){}});
const show=migrate(JSON.parse(fs.readFileSync(new URL('../data/show.json',import.meta.url),'utf8')));
const average=(fn,n=100)=>{for(let i=0;i<10;i++)fn();const t0=performance.now();for(let i=0;i<n;i++)fn();return (performance.now()-t0)/n};

test('A full tick over the 232-fixture show with effects, preview, blind and Look Link stays under budget',async()=>{
 let time=0;const e=new Engine({output:output(),clock:()=>time});await e.command('show.import',{show});
 assert.ok(e.show.fixtures.length>=230,'the saved show is the full rig');
 const track=(group,effect,params)=>({group,effect,start:0,duration:60,params,fadeIn:1,fadeOut:1});
 const cue={id:'perf',name:'Perf',duration:60,loop:true,tracks:[track('face-lights','wave',{color:'#ff8800',secondary:'#0044ff',speed:1,brightness:.8}),track('house-lights','rainbow',{speed:1,brightness:.8}),track('front-lights','chase',{color:'#ff8800',secondary:'#0044ff',speed:1,brightness:.8}),track('movers','orbit',{color:'#ffffff',speed:1,brightness:.8,panAmplitude:.04,tiltAmplitude:.03}),track('rear-heads','strobe',{color:'#ffffff',brightness:.8,spatialAxis:'x',strobePattern:'wave'})]};
 await e.command('cue.save',{cue});await e.command('cue.play',{id:'perf',fade:2});
 await e.command('fixture.set',{ids:e.show.fixtures.slice(0,100).map(f=>f.id),values:{intensity:.5,color:'#ff0000'}});
 await e.command('preview.cue',{id:'perf'});await e.command('blind.set',{enabled:true});await e.command('fixture.set',{ids:['401','402'],values:{intensity:1}});
 await e.command('zone.save',{zone:{id:'perf-zone',name:'Perf',role:'face',groups:['face-lights']}});
 await e.command('target.save',{target:{id:'perf-target',name:'Perf',kind:'osc',host:'10.0.0.9',port:9000,look:{mode:'change'}}});
 const ms=average(()=>{time+=1/30;e.lastWatch=-Infinity;e.tick()});
 assert.ok(ms<4,`tick took ${ms.toFixed(2)} ms`);
 const stringify=average(()=>JSON.stringify(e.runtime()));assert.ok(stringify<2,`runtime serialisation took ${stringify.toFixed(2)} ms`);
});
