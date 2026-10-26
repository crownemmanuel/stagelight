import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {encode} from '../engine/render.mjs';import {aimAngles,aimDirection} from '../public/aim.js';
const out=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},close(){this.armed=false},async arm(){this.armed=true}});
test('visual alignment holds cue, preserves DMX bytes and survives export/import/restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-alignment-'));try{
 let now=0;const e=new Engine({dataDir:dir,output:out(),clock:()=>now});await e.command('cue.play',{id:'prism-dance'});now=3;e.tick();await e.command('calibration.hold',{id:'302'});
 const pose=e.frames.find(f=>f.id==='302'),actual=[pose.pan,pose.tilt],before=encode(e.show,e.frames);now=8;e.tick();assert.equal(e.playback.paused,true);assert.deepEqual([e.frames.find(f=>f.id==='302').pan,e.frames.find(f=>f.id==='302').tilt],actual);
 e.output.armed=true;await e.command('fixture.place',{id:'302',position:[-5.5,6.3,0]});await e.command('calibration.align',{id:'302',actual,virtual:[45,60],panSign:-1,tiltSign:1,name:'Lectern'});
 assert.deepEqual(encode(e.show,e.frames),before);const fixture=e.show.fixtures.find(f=>f.id==='302');assert.deepEqual(aimAngles(fixture,...actual),[45,60]);assert.ok(Math.abs(aimAngles(fixture,actual[0]+.1,actual[1])[0]+9)<1e-8);
 const bundle=JSON.parse(JSON.stringify(e.snapshot().show));const restarted=new Engine({dataDir:dir,output:out()});assert.deepEqual(restarted.show.fixtures.find(f=>f.id==='302'),fixture);assert.equal(restarted.output.armed,false);
 const other=new Engine({output:out()});other.show.settings.source='127.0.0.1';await other.command('show.import',{show:bundle});assert.deepEqual(other.show.fixtures.find(f=>f.id==='302'),fixture);assert.equal(other.show.settings.source,'127.0.0.1');assert.equal(other.playback,null);assert.ok(other.frames.every(f=>f.intensity===0));
 other.output.armed=true;await assert.rejects(other.command('show.import',{show:bundle}),/Disarm/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('stale poses and invalid calibration do not save',async()=>{
 const e=new Engine({output:out()});await e.command('calibration.hold',{id:'301'});const f=e.frames.find(f=>f.id==='301');const args={id:'301',actual:[f.pan,f.tilt],virtual:[0,90],panSign:1,tiltSign:1,name:'Test'};
 await e.command('fixture.set',{ids:['301'],values:{pan:.9}});await assert.rejects(e.command('calibration.align',args),/changed/);assert.equal(e.show.fixtures.find(f=>f.id==='301').calibration.alignment,undefined);
 await assert.rejects(e.command('calibration.align',{...args,virtual:[NaN,0]}));
 assert.deepEqual(aimDirection(0,0),[0,-1,0]);assert.ok(Math.abs(aimDirection(90,90)[0]-1)<1e-9);
});

test('Floor MH7 preview is upright without changing DMX and explicit alignment takes precedence',()=>{
 const e=new Engine({output:out()}),f=e.show.fixtures.find(f=>f.id==='705');e.show.settings.mappings[6]=5;
 const bytes=encode(e.show,e.frames);assert.deepEqual(aimAngles(f,.5,.5),[-0,180]);assert.ok(aimDirection(...aimAngles(f,.5,.5))[1]>.99);
 const floorDir=aimDirection(...aimAngles(f,.6,.7));const hanging=structuredClone(f);hanging.position[1]=6.3;const hangingDir=aimDirection(...aimAngles(hanging,.6,.7));assert.ok(Math.abs(floorDir[0]+hangingDir[0])<1e-9);assert.ok(Math.abs(floorDir[1]+hangingDir[1])<1e-9);assert.ok(Math.abs(floorDir[2]-hangingDir[2])<1e-9);
 f.calibration.alignment={actual:[.5,.5],virtual:[25,70],panSign:1,tiltSign:1,name:'Matched',savedAt:'2026-10-25'};assert.deepEqual(aimAngles(f,.5,.5),[25,70]);assert.deepEqual(encode(e.show,e.frames),bytes);
});
