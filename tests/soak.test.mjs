import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {Engine} from '../engine/engine.mjs';
// Show-day soak: the saved show, driven through everything an operator does in a service (every page entry, every master,
// every scene, pause, release, stop, blackout, master levels, tap tempo) with the engine ticking at 30 Hz on a test clock
// and output armed into a fake, so DMX is encoded every frame. Uses LIGHTS_SOAK_SHOW if set, else data/show.json; skips
// when neither exists. Asserts nothing throws, every frame value is finite and in range, layers stay capped, logs and
// maps stay bounded, and the mean tick stays inside the 4 ms budget.
const source=process.env.LIGHTS_SOAK_SHOW??fileURLToPathSafe(new URL('../data/show.json',import.meta.url));
function fileURLToPathSafe(u){return decodeURIComponent(u.pathname)}
const ROUNDS=Number(process.env.LIGHTS_SOAK_ROUNDS??2);

// Frame values: every number finite; intensity and the 0..1 attributes in 0..1; prism rotation signed −1..1 (direction);
// nothing else negative; colour channels within 0..255.
function checkFrames(frames,where){
 for(const f of frames)for(const [k,v] of Object.entries(f)){
  if(typeof v==='number'){if(!Number.isFinite(v))return `${where}: ${f.id}.${k} = ${v}`;if(['intensity','white','zoom','frost','focus','pan','tilt','movementSpeed'].includes(k)&&(v<-1e-9||v>1+1e-9))return `${where}: ${f.id}.${k} = ${v} out of 0..1`;if(k==='prismRotation'?Math.abs(v)>1+1e-9:v<-1e-9)return `${where}: ${f.id}.${k} = ${v} out of range`}
  else if(v&&typeof v==='object')for(const [c,n] of Object.entries(v))if(typeof n==='number'&&(!Number.isFinite(n)||n<0||n>255))return `${where}: ${f.id}.${k}.${c} = ${n}`;
 }
 return null;
}

test('soak: every page entry, master and scene, with pause, release, stop, blackout, levels and tempo, at 30 Hz',{skip:!fs.existsSync(source)&&`no show at ${source}`,timeout:600000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-soak-'));fs.copyFileSync(source,path.join(dir,'show.json'));
 let time=0,packets=0,badPacket=null;
 const output={armed:true,send(p){packets++;for(const [u,b] of p)if(!(b instanceof Uint8Array)||b.length>512)badPacket??=`universe ${u}: ${b?.constructor?.name} length ${b?.length}`},status(){return {armed:true,packets,interfaces:[]}},close(){},async arm(){this.armed=true},async check(){return {ok:true,steps:[]}}};
 const e=new Engine({dataDir:dir,showsDir:path.join(dir,'shows'),output,clock:()=>time});
 const failures=[],ticks=[];let maxLayers=0,maxLogs=0,step='start';
 const tick=n=>{for(let i=0;i<n;i++){time+=1/30;const t0=performance.now();try{e.tick()}catch(err){failures.push(`tick during ${step}: ${err.stack.split('\n').slice(0,3).join(' | ')}`);return}ticks.push(performance.now()-t0);
  maxLayers=Math.max(maxLayers,e.layers.length);maxLogs=Math.max(maxLogs,e.logs.length);if(i%15===0){const bad=checkFrames(e.frames,step);if(bad&&failures.length<20)failures.push(bad)}}};
 const run=async(name,args={})=>{step=`${name} ${JSON.stringify(args)}`;try{return await e.command(name,args)}catch(err){failures.push(`${step}: ${err.message}`);return null}};
 try{
  const show=e.show,slots=show.masters.slots.filter(s=>s.cue),scenes=show.scenes??[];
  await run('master.set',{value:1});tick(10);
  for(let round=0;round<ROUNDS;round++){
   for(const page of show.pages){
    for(const entry of page.cues){await run('page.go',{id:page.id,entry:entry.id});tick(45)}
    // Back from the last entry, then GO (next) from there: plain GO and Back, never past either end of the list.
    if(page.cues.length>1){await run('page.back');tick(20);await run('page.go',{id:page.id});tick(20)}
   }
   for(const s of slots){
    await run('masters.trigger',{slot:s.id,down:true});tick(20);await run('masters.level',{slot:s.id,level:.5});tick(10);
    await run('masters.trigger',{slot:s.id,down:false});tick(20);
    if(s.action==='toggle'||s.action==='go'){await run('masters.trigger',{slot:s.id,down:true});tick(5);await run('masters.trigger',{slot:s.id,down:false});tick(10)}
    await run('masters.level',{slot:s.id,level:1});tick(5);
   }
   // Several masters held at once, then let go in reverse.
   for(const s of slots.slice(0,8))await run('masters.trigger',{slot:s.id,down:true});tick(30);for(const s of slots.slice(0,8).reverse())await run('masters.trigger',{slot:s.id,down:false});tick(30);
   for(const sc of scenes){await run('scene.go',{id:sc.id});tick(60)}if(scenes.length){await run('scene.release',{fade:0.5});tick(30)}
   if(show.pages[0]?.cues.length){await run('page.go',{id:show.pages[0].id,entry:show.pages[0].cues[0].id});tick(30)}
   if(e.running().length){await run('cue.pause',{paused:true});tick(30);await run('cue.pause',{paused:false});tick(30);await run('cue.release',{fade:.5});tick(30)}
   for(const c of show.cues.slice(0,12)){await run('cue.play',{id:c.id});tick(8)}tick(30);
   await run('cue.stop',{fade:1});tick(45);
   await run('blackout.set',{enabled:true});tick(15);await run('blackout.set',{enabled:false});tick(15);
   for(const v of [.2,.8,0,1]){await run('master.set',{value:v});tick(8)}
   for(let i=0;i<4;i++){await run('tempo.tap');tick(15)}tick(60);await run('tempo.set',{});
   await run('cue.stop',{fade:0});tick(30);
  }
  // Bounded state: nothing an operator does should grow without limit.
  const sizes={logs:e.logs.length,flashes:e.flashes.size,levels:e.levels.size,soundHolds:e.soundHolds.size,requests:e.requests.size,lampCommands:e.lampCommands.size,netIn:e.net.in.length,looks:e.looks.size,presetBursts:e.presetBursts.size,taps:e.tempo.taps.length,kills:e.kills.size,layers:e.layers.length};
  const mean=ticks.reduce((a,b)=>a+b,0)/Math.max(1,ticks.length),worst=Math.max(...ticks);
  test.diagnostic?.(`soak ${path.basename(path.dirname(source))}/${path.basename(source)}: ${ticks.length} ticks, mean ${mean.toFixed(3)} ms, worst ${worst.toFixed(2)} ms, ${packets} packets, max layers ${maxLayers}`);
  console.log(`# soak: ${show.fixtures.length} fixtures, ${show.pages.reduce((n,p)=>n+p.cues.length,0)} page entries, ${slots.length} masters, ${scenes.length} scenes · ${ticks.length} ticks, mean ${mean.toFixed(3)} ms, worst ${worst.toFixed(2)} ms, max layers ${maxLayers}`);
  assert.deepEqual(failures,[],'no command or tick threw and every frame value stayed in range');
  assert.equal(badPacket,null);assert.ok(packets>=ticks.length,'output was sent every frame');
  assert.ok(maxLayers<=7,`at most 7 cues layered under the newest (saw ${maxLayers})`);assert.ok(maxLogs<=120);
  assert.ok(sizes.flashes<=slots.length&&sizes.levels<=slots.length&&sizes.soundHolds===0,JSON.stringify(sizes));
  assert.ok(sizes.requests<=1000&&sizes.taps<=8&&sizes.netIn<=200&&sizes.layers===0,JSON.stringify(sizes));
  assert.ok(mean<4,`mean tick ${mean.toFixed(3)} ms is inside the 4 ms budget`);
 }finally{await e.close();fs.rmSync(dir,{recursive:true,force:true})}
});
