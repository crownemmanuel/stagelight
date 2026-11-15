// Code effects (docs/CODE-EFFECTS.md): effects written as JavaScript, run in a sandbox with a time limit.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {performance} from 'node:perf_hooks';
import {Engine} from '../engine/engine.mjs';
import {CODE_DOC,CODE_LIMITS,checkCodeEffect,runCodeEffect,sanitize,clearEffectErrors} from '../engine/code-effects.mjs';
const output=()=>({armed:false,sent:0,send(){this.sent++},status(){return {armed:this.armed,packets:this.sent,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const make=(opts={})=>{const clock={now:0},e=new Engine({output:output(),clock:()=>clock.now,...opts});return {e,clock,at(t){clock.now=t;e.tick();return new Map(e.frames.map(f=>[f.id,f]))}}};
const comet={id:'comet-code',name:'Comet tail',icon:'chase',effect:'code',params:{code:'const head = fract(t * p.rate), d = fract(head - f.phase);\nreturn {intensity: exp(-d * p.tail), color: lerp(rgb(p.color), rgb(p.secondary), clamp(d * 3))};',args:{rate:.3,tail:8},color:'#ffffff',secondary:'#2b6cff'}};

test('effect.test dry-runs code on real fixtures and says exactly what is wrong with bad code',async()=>{
 const {e}=make(),t=(params,extra={})=>e.command('effect.test',{group:'backlights',params,...extra});
 const good=await t({code:'return {intensity: wave(t - f.phase), color: hsv(f.phase)}'});
 assert.equal(good.ok,true);assert.equal(good.fixtures,8);assert.deepEqual(good.sets.sort(),['color','intensity']);assert.equal(good.frames[0].fixtures[0].id,'401');assert.ok(good.frames.some(f=>f.lit>0));assert.ok(good.ms<CODE_LIMITS.frameMs);assert.deepEqual(good.warnings,[]);
 assert.match((await t({code:'const a = ;\nreturn {}'})).error,/Line 1: Unexpected token/);
 assert.match((await t({code:'const k = 2;\nreturn {intensity: k * nope.x}'})).error,/Line 2: nope is not defined/);
 assert.match((await t({code:'return {brightness: 1}'})).error,/Unknown attribute "brightness".*intensity/);
 assert.match((await t({code:'return {intensity: Math.random()}'})).error,/Math.random is not allowed.*hash/);
 assert.match((await t({code:'return {intensity: f.i / (f.n - 1)}'})).error,/f\.n is 1/);
 assert.match((await t({code:'while (true) {}'})).error,/longer than \d+ ms/);
 assert.match((await t({code:'t > 1'})).error,/never returned any values/);
 // Colour alone on dark fixtures runs, with a warning that nothing would be seen.
 const dark=await t({code:'return {color: "#ff0000"}'});assert.equal(dark.ok,true);assert.match(dark.warnings[0],/Nothing is lit/);
 assert.match((await t({code:'return {pan: base.pan + .02 * sin(t), intensity: 1}'})).warnings.join(' '),/none of these fixtures is a moving head/);
 await assert.rejects(t({code:'return {intensity: 1}'},{group:'nope'}),/Unknown group/);
 assert.equal(e.revision,1,'nothing was saved');assert.equal(e.playback,null);assert.deepEqual(e.runtime().effectErrors,[]);
});

test('every documented example passes the same check an agent\'s code gets',()=>{
 for(const x of CODE_DOC.examples)assert.doesNotThrow(()=>checkCodeEffect({code:x.code,args:x.args,...(x.params??{})}),x.name);
 assert.ok(CODE_DOC.helpers.cycles.includes('wave'));assert.ok(Object.keys(CODE_DOC.returns).includes('intensity'));
});

test('a code preset is saved in the show and works like any preset: preview, apply, cue, record',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-code-'));try{
  const {e,at}=make({dataDir:dir});
  assert.equal((await e.command('preset.save',{preset:comet})).created.preset,'comet-code');
  const schema=await e.command('schema');assert.equal(schema.presets['comet-code'].custom,true);assert.equal(schema.presets['comet-code'].category,'intensity');assert.ok(schema.code.examples.length);assert.equal(schema.effects.code.code,true);
  await e.command('preset.save',{preset:{...comet,id:'drift',name:'Drift',layer:'position',params:{code:'return {pan: base.pan + p.size * sin(t + f.phase * TAU)}',args:{size:.03}}}});
  assert.equal((await e.command('schema')).presets.drift.category,'movement');assert.equal((await e.command('schema')).presets.drift.movers,true);
  // Programmer effect over the live look: the code sees what is underneath as base.
  await e.command('fixture.set',{ids:['401','402'],values:{intensity:.5,color:'#00ff00'}});
  await e.command('fx.apply',{fixtures:['401','402'],preset:'comet-code',fade:0});
  const fx=e.runtime().fx[0];assert.equal(fx.effect,'code');assert.equal(fx.params.code,undefined,'the source is not streamed in runtime');assert.deepEqual(fx.params.args,{rate:.3,tail:8});
  const a=at(1),b=at(1.4),again=at(1);assert.notEqual(a.get('401').intensity,b.get('401').intensity,'it moves');assert.deepEqual(again.get('401'),a.get('401'),'same time, same values');
  assert.ok(a.get('401').intensity>0||a.get('402').intensity>0);assert.equal(a.get('403').intensity,0,'other fixtures untouched');
  // Changing an arg re-sends params.args only; the code stays the preset's.
  await e.command('fx.apply',{fixtures:['401','402'],preset:'comet-code',params:{args:{rate:.3,tail:0}},fade:0});assert.equal(at(2).get('401').intensity,1,'tail 0 = everything at full');
  // Recorded into a cue, the track carries the code.
  const rec=await e.command('cue.record',{id:'comet-look',name:'Comet look'});const saved=e.show.cues.find(c=>c.id===rec.created.cue);assert.equal(saved.tracks.at(-1).effect,'code');assert.ok(saved.tracks.at(-1).params.code.includes('fract'));
  assert.deepEqual(saved.look.find(x=>x.id==='401').values.intensity,.5,'the look under the effect is recorded, not one frame of the effect');assert.equal(saved.look.find(x=>x.id==='401').values.color,'#00ff00');
  // A cue from the preset on a group.
  const cue=await e.command('effect.apply',{preset:'comet-code',group:'backlights',speed:2});const made=e.show.cues.find(c=>c.id===cue.created.cue);assert.equal(made.tracks[0].params.speed,2);assert.equal(made.tracks[0].params.args.tail,8);
  await e.command('override.release',{fade:0});await e.command('cue.play',{id:made.id});const f=at(e.clock()+3);assert.ok([...f.values()].filter(x=>x.intensity>.05).length>=1);
  // Persists and still validates on load.
  const again2=new Engine({dataDir:dir,output:output()});assert.equal(again2.show.presets.length,2);assert.equal(again2.show.cues.find(c=>c.id===made.id).tracks[0].effect,'code');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('code in a cue follows the cue: layered over its look, frozen on pause, in step with speed and note steps',async()=>{
 const {e,clock,at}=make();
 const look=['401','402','403','404'].map(id=>({id,values:{intensity:.8,color:'#ff0000'}}));
 await e.command('cue.save',{cue:{id:'pulse',name:'Pulse',duration:10,loop:true,look,tracks:[{fixtures:['401','402','403','404'],layer:'intensity',effect:'code',start:0,duration:10,fadeIn:0,fadeOut:0,params:{code:'return {intensity: base.intensity * (f.i === floor(t) % f.n ? 1 : .25)}'}}]}});
 await e.command('cue.play',{id:'pulse'});
 let f=at(.5);assert.ok(Math.abs(f.get('401').intensity-.8)<1e-9);assert.ok(Math.abs(f.get('402').intensity-.2)<1e-9);assert.deepEqual(f.get('402').color,[1,0,0],'the look\'s colour stays');
 f=at(1.5);assert.ok(Math.abs(f.get('402').intensity-.8)<1e-9);
 await e.command('cue.pause',{paused:true});f=at(7.5);assert.ok(Math.abs(f.get('402').intensity-.8)<1e-9,'paused: frozen');await e.command('cue.pause',{paused:false});
 // Twice the speed: the cue's clock runs double, so the code's t does too.
 await e.command('cue.save',{cue:{...e.show.cues.find(c=>c.id==='pulse'),speed:2}});await e.command('cue.play',{id:'pulse'});const t0=clock.now;f=at(t0+.75);assert.ok(Math.abs(f.get('402').intensity-.8)<1e-9);
 // Note step: ctx.step counts the hits of masters.step.
 await e.command('cue.save',{cue:{id:'hits',name:'Hits',duration:30,loop:true,tracks:[{fixtures:['401','402','403'],effect:'code',start:0,duration:30,fadeIn:0,fadeOut:0,params:{code:'return {intensity: ctx.step >= 0 && ctx.step % f.n === f.i ? 1 : 0}'}}]}});
 await e.command('masters.assign',{slot:'m1',cue:'hits',action:'toggle'});await e.command('masters.trigger',{slot:'m1',down:true});
 f=at(clock.now+.1);assert.equal(f.get('401').intensity,0,'dark before the first hit');
 await e.command('masters.step',{slot:'m1'});f=at(clock.now+.05);assert.equal(f.get('401').intensity,1);await e.command('masters.step',{slot:'m1'});f=at(clock.now+.05);assert.equal(f.get('401').intensity,0);assert.equal(f.get('402').intensity,1);
 assert.equal(e.show.cues.find(c=>c.id==='hits').tracks[0].params.step,undefined,'step state is never saved');
});

test('code that cannot run is never saved or started',async()=>{
 const {e}=make(),bad={code:'return {intensity: undefinedThing}'},rev=e.revision;
 await assert.rejects(e.command('preset.save',{preset:{...comet,params:bad}}),/Preset Comet tail · Code effect: Line 1: undefinedThing is not defined/);
 await assert.rejects(e.command('cue.save',{cue:{id:'x',name:'Broken',duration:5,loop:true,tracks:[{group:'backlights',effect:'code',start:0,duration:5,params:bad}]}}),/Cue Broken · Code effect/);
 await assert.rejects(e.command('fx.apply',{fixtures:['401'],effect:'code',params:bad}),/Code effect/);
 await assert.rejects(e.command('fx.preview',{fixtures:['401'],effect:'code',params:{}}),/needs params\.code/);
 await assert.rejects(e.command('effect.preview',{group:'backlights',effect:'code',params:bad}),/Code effect/);
 await assert.rejects(e.command('preset.save',{preset:{...comet,effect:'breathe',params:{code:'return {}'}}}),/belong to the "code" effect/);
 await assert.rejects(e.command('preset.save',{preset:{...comet,effect:'breathe',layer:'color',params:{speed:1}}}),/only a code effect chooses its layer/);
 await assert.rejects(e.command('preset.save',{preset:{...comet,params:{code:'return {intensity: 1}',args:{'bad key':1}}}}),/plain name/);
 await assert.rejects(e.command('preset.save',{preset:{...comet,params:{code:'return {intensity: 1}',args:{deep:{a:1}}}}}),/use a number/);
 await assert.rejects(e.command('preset.save',{preset:{...comet,params:{code:'x'.repeat(CODE_LIMITS.source+1)}}}),/invalid text/);
 assert.equal(e.revision,rev);assert.equal(e.show.presets.length,0);assert.equal(e.fx.length,0);
 // The performance lock keeps the library closed; testing code stays open.
 await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('preset.save',{preset:comet}),/performance lock/);assert.equal((await e.command('effect.test',{group:'backlights',params:comet.params})).ok,true);
});

test('code that fails or hangs mid-show costs that effect only: the look stays, the engine keeps ticking, the failure is reported',async()=>{
 clearEffectErrors();const {e,clock,at}=make();
 const look=['401','402'].map(id=>({id,values:{intensity:.6,color:'#0000ff'}}));
 // Passes every check, then throws after two minutes.
 await e.command('cue.save',{cue:{id:'late',name:'Late fault',duration:600,loop:true,look,tracks:[{fixtures:['401','402'],layer:'intensity',effect:'code',start:0,duration:600,fadeIn:0,fadeOut:0,params:{code:'if (t > 120) throw new Error("lost the plot");\nreturn {intensity: 1}'}}]}});
 await e.command('cue.play',{id:'late'});assert.equal(at(5).get('401').intensity,1);
 const logs=e.logs.length;let f=at(130);assert.equal(f.get('401').intensity,1,'one bad frame is covered by the last good one');at(130.03);f=at(130.07);assert.ok(Math.abs(f.get('401').intensity-.6)<1e-9,'still failing: falls back to the look underneath');assert.deepEqual(f.get('401').color,[0,0,1]);
 const err=e.runtime().effectErrors[0];assert.equal(err.effect,'Late fault');assert.match(err.message,/lost the plot/);assert.equal(err.line,1);
 for(let i=1;i<=60;i++)at(130+i/30);assert.ok(e.logs.slice(logs).filter(l=>/Code effect · Late fault/.test(l.message)).length===1,'logged once, not every frame');
 assert.equal((await e.command('status')).runtime.effectErrors.length,1);
 // An endless loop that only starts later: each attempt is cut off at the frame limit and attempts back off.
 await e.command('cue.save',{cue:{id:'hang',name:'Late hang',duration:600,loop:true,look,tracks:[{fixtures:['401','402'],layer:'intensity',effect:'code',start:0,duration:600,fadeIn:0,fadeOut:0,params:{code:'if (t > 120) { while (true) {} }\nreturn {intensity: 1}'}}]}});
 await e.command('cue.play',{id:'hang'});const start=clock.now;assert.equal(at(start+5).get('402').intensity,1);
 const t0=performance.now();for(let i=0;i<30;i++)f=at(start+130+i/30);const spent=performance.now()-t0;
 assert.ok(spent<CODE_LIMITS.frameMs*4+60,`30 frames with a hanging effect took ${spent.toFixed(1)} ms`);assert.ok(Math.abs(f.get('402').intensity-.6)<1e-9);
 assert.match(e.runtime().effectErrors.find(x=>x.effect==='Late hang').message,/longer than/);
 // Fix the code: the same cue runs clean again and leaves the error list.
 await e.command('cue.save',{cue:{...e.show.cues.find(c=>c.id==='hang'),tracks:[{fixtures:['401','402'],layer:'intensity',effect:'code',start:0,duration:600,fadeIn:0,fadeOut:0,params:{code:'return {intensity: .9}'}}]}});
 await e.command('cue.play',{id:'hang'});assert.ok(Math.abs(at(clock.now+1).get('401').intensity-.9)<1e-9);assert.equal(e.runtime().effectErrors.some(x=>x.effect==='Late hang'),false);
});

test('the sandbox holds nothing of the engine and returned values are made safe',()=>{
 const run=code=>runCodeEffect(code,{t:0,f:[{id:'a',i:0,n:1,phase:0}],b:[{intensity:.5,color:[1,1,1]}],p:{},c:{}})?.[0];
 assert.deepEqual(run('return {intensity: [typeof process, typeof require, typeof globalThis.fetch, typeof module].every(x => x === "undefined") ? 1 : 0}'),{intensity:1});
 assert.throws(()=>checkCodeEffect({code:'return {intensity: (function(){}).constructor("return 1")()}'}),/Code effect/);
 assert.throws(()=>checkCodeEffect({code:'return {intensity: new Date().getSeconds() / 60}'}),/Date is not allowed/);
 for(const code of ['async (t) => { await null; while (true) {} }','return {intensity: Promise.resolve(1)}','import("node:fs"); return {intensity: 1}','const r = new WeakRef({}); return {intensity: 1}'])assert.throws(()=>checkCodeEffect({code}),/cannot be used: an effect is a plain function/,code);
 assert.doesNotThrow(()=>checkCodeEffect({code:'// no await here, "async" is only a word\nreturn {intensity: 1} /* Promise */'}));
 assert.deepEqual(sanitize({intensity:7,pan:-2,gobo:3.6,prism:9,prismRotation:-4,color:[2,.5,-1,9],opticalMode:'spot'}),{intensity:1,pan:0,gobo:4,prism:3,prismRotation:-1,color:[1,.5,0],opticalMode:'spot'});
 assert.deepEqual(sanitize({color:'#ff8000'}),{color:[1,128/255,0]});
 const notes={unknown:new Set(),bad:new Set()};assert.equal(sanitize({intensity:'NaN',colour:1,color:'red',opticalMode:'wide'},notes),null);assert.deepEqual([...notes.unknown],['colour']);assert.deepEqual([...notes.bad].sort(),['color','intensity','opticalMode']);
 assert.equal(sanitize(null),null);assert.equal(sanitize([1,2]),null);
});

test('a code effect over a large group stays far inside the tick budget',async()=>{
 clearEffectErrors();const {e,clock}=make();await e.command('cue.save',{cue:{id:'big',name:'Big',duration:60,loop:true,tracks:[{group:'grid',effect:'code',start:0,duration:60,params:{code:comet.params.code,args:comet.params.args,color:'#ffffff',secondary:'#2b6cff'}},{group:'movers',layer:'position',effect:'code',start:0,duration:60,params:{code:'const a = t * .3 * TAU + f.phase * TAU;\nreturn {pan: base.pan + .04 * cos(a), tilt: base.tilt + .03 * sin(a)}'}}]}});
 await e.command('cue.play',{id:'big'});for(let i=0;i<20;i++){clock.now+=1/30;e.tick()}
 const t0=performance.now(),n=150;for(let i=0;i<n;i++){clock.now+=1/30;e.tick()}const ms=(performance.now()-t0)/n;
 assert.ok(ms<2,`tick with two code tracks: ${ms.toFixed(3)} ms`);assert.deepEqual(e.runtime().effectErrors,[]);
});

test('MCP exposes effect.test and the code effect in the schemas',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 const t=by('lights_effect_test');assert.ok(t);assert.equal(t.annotations.readOnlyHint,true);assert.ok(t.inputSchema.properties.params.properties.code);assert.ok(t.inputSchema.properties.params.properties.args);
 assert.ok(by('lights_preset_save').inputSchema.properties.preset.properties.effect.enum.includes('code'));assert.ok(by('lights_preset_save').inputSchema.properties.preset.properties.layer);
 assert.ok(by('lights_fx_apply').inputSchema.properties.effect.enum.includes('code'));assert.match(by('lights_schema').description,/code/);
});
