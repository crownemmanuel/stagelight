// Code effects (docs/CODE-EFFECTS.md): an effect written as a small JavaScript function instead of picked from the built-in list,
// so an agent can build whatever the operator describes. The function is pure: the same time and fixture always give the same
// values, which is what lets a cue loop, pause, seek, follow the tempo and preview exactly like a built-in effect.
//
// The code never runs in the engine's own realm. Each source gets a node:vm context with no host objects in it (inputs go in
// and results come out as JSON text), string code generation off, and a time limit on every call, so a loop that never ends
// or an exception costs one frame of that effect and nothing else. Failing code is skipped (its fixtures keep the look below),
// reported in runtime.effectErrors, and tried again after a pause.
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';

// What a code effect may return per fixture. Anything else is refused when the effect is saved and ignored while it runs.
const UNIT=['intensity','white','amber','mint','pan','tilt','zoom','focus','frost','goboShake','movementSpeed'];
export const CODE_ATTRIBUTES=[...UNIT,'color','prismRotation','gobo','prism','opticalMode'];
export const CODE_LIMITS={source:20000,args:32,frameMs:15,checkMs:60};
const RESERVED=new Set(['code','args','step','stepAt','stepFade']);

const PRELUDE=new vm.Script(`'use strict';
const {sin,cos,tan,asin,acos,atan,atan2,abs,min,max,floor,ceil,round,trunc,sqrt,cbrt,pow,exp,log,log2,sign,hypot,PI,E}=Math;
const TAU=PI*2;
const clamp=(x,a=0,b=1)=>x<a?a:x>b?b:x;
const fract=x=>x-floor(x);
const lerp=(a,b,k)=>Array.isArray(a)?a.map((v,i)=>v+((Array.isArray(b)?b[i]:b)-v)*k):a+(b-a)*k;
const mix=lerp;
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const smoothstep=(a,b,x)=>smooth((x-a)/(b-a));
const step=(edge,x)=>x<edge?0:1;
const saw=x=>fract(x);
const tri=x=>1-abs(fract(x)*2-1);
const wave=x=>.5-.5*cos(x*TAU);
const square=(x,duty=.5)=>fract(x)<duty?1:0;
const pulse=(x,width=.25)=>{const d=fract(x);return d<width?1-d/width:0};
const bump=(x,center=0,width=.2)=>exp(-2*((x-center)/width)**2);
const hash=(a=0,b=0,c=0)=>fract(sin(a*127.1+b*311.7+c*74.7)*43758.5453123);
const noise=(x,y=0)=>{const xi=floor(x),yi=floor(y),u=smooth(x-xi),v=smooth(y-yi),a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v};
const hsv=(h,s=1,v=1)=>[5,3,1].map(n=>{const k=(n+fract(h)*6)%6;return v-v*s*max(0,min(k,4-k,1))});
const rgb=c=>Array.isArray(c)?c:[1,3,5].map(i=>parseInt(String(c).slice(i,i+2),16)/255);
const kelvin=k=>{const t=clamp(k,1000,12000)/100;return [t<=66?1:clamp(1.292936*pow(t-60,-.1332047)),t<=66?clamp(.390082*log(t)-.631841):clamp(1.129891*pow(t-60,-.0755148)),t>=66?1:t<=19?0:clamp(.543207*log(t-10)-1.196254)]};
const dist=(x1,z1,x2=0,z2=0)=>hypot(x1-x2,z1-z2);
Math.random=()=>{throw new Error('Math.random is not allowed: an effect must repeat exactly. Use hash(f.i, floor(t)) or noise(t) for randomness.')};
Object.defineProperty(globalThis,'Date',{get(){throw new Error('Date is not allowed: use t (seconds into the effect) so it repeats exactly.')}});
for(const k of ['Atomics','SharedArrayBuffer','WebAssembly','eval','Function','Promise','FinalizationRegistry','WeakRef'])delete globalThis[k];
Object.freeze(Math);
globalThis.__run=function(json){
 try{const a=JSON.parse(json),n=a.f.length,out=new Array(n);for(let k=0;k<n;k++){const r=__fn(a.t,a.f[k],a.b[k],a.p,a.c);out[k]=r&&typeof r==='object'&&!Array.isArray(r)?r:null}return JSON.stringify(out,(key,v)=>typeof v==='number'&&!isFinite(v)?'NaN':v)}
 catch(e){let m='The effect failed',s='';try{m=String(e&&e.message!==undefined?e.message:e);s=String(e&&e.stack||'')}catch(_){}return JSON.stringify({error:m.slice(0,300),stack:s.slice(0,800)})}
};`,{filename:'stagelight-effect-helpers.js'});
const RUN=new vm.Script('__out=__run(__in)',{filename:'stagelight-effect-run.js'});
// The time-limit error comes from Node, but not always as this realm's Error, so it is recognised by its code.
const timedOut=e=>{try{return e?.code==='ERR_SCRIPT_EXECUTION_TIMEOUT'}catch{return false}};
const lineOf=text=>{const m=/effect\.js:(\d+)/.exec(text??'');return m?Number(m[1]):null};
const say=(message,line)=>(line?`Line ${line}: `:'')+message;

const cache=new Map(),checks=new Map(),errors=new Map();let report=null;
/** The engine's log, called once per new failure. */
export function onEffectError(fn){report=fn}
/** Failures of running effects, newest first: [{effect, message, line, at, count}]. One leaves the list when it runs clean again, or 30 s after its last failure (a failing effect is retried at least every 10 s while it runs). */
export function effectErrors(){const now=Date.now();for(const [k,e] of errors)if(now-Date.parse(e.at)>30000)errors.delete(k);return [...errors.values()].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,20)}
export function clearEffectErrors(label){if(label===undefined)errors.clear();else errors.delete(label)}
function fail(label,message,line){const key=label??'effect',old=errors.get(key);errors.set(key,{effect:key,message,...(line?{line}:{}),at:new Date().toISOString(),count:(old?.count??0)+1});if(old?.message!==message)report?.(`Code effect · ${key}: ${say(message,line)}`)}

// An effect returns its values straight away, so nothing that waits is allowed in: promise callbacks would run outside the
// function, where an endless loop is far harder to stop cleanly. Comments and quoted text are ignored by this check.
const WAITING=/\b(async|await|Promise|import|FinalizationRegistry|WeakRef)\b/;
const bare=code=>code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,'""').replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*/g,' ');
function compile(code){
 const entry={context:null,error:null,line:null,fails:0,retryAt:0,ms:0,runs:0};
 try{
  const waits=WAITING.exec(bare(code));if(waits)throw Error(`"${waits[1]}" cannot be used: an effect is a plain function that returns its values straight away`);
  const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false},microtaskMode:'afterEvaluate'});PRELUDE.runInContext(context,{timeout:500});
  const load=source=>{new vm.Script(source,{filename:'effect.js',lineOffset:-1}).runInContext(context,{timeout:CODE_LIMITS.checkMs});return vm.runInContext('typeof __fn',context,{timeout:50})==='function'};
  // A whole function ("(t, f) => ({...})" or "function (t, f, base, p, ctx) {...}") or just its body ("return {...}").
  let ok=false,asExpression=null;try{ok=load(`globalThis.__fn=(\n${code}\n);`)}catch(e){asExpression=e}
  if(!ok){try{ok=load(`globalThis.__fn=function(t,f,base,p,ctx){'use strict';\n${code}\n};`)}catch(e){const first=asExpression instanceof Error&&/^\s*(\(|async\b|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(code)?asExpression:e;throw first}}
  if(!ok)throw Error('The code must be a function or the body of one that ends with return {...}');
  entry.context=context;
 }catch(e){const text=e instanceof Error?`${e.stack??''}`:'';entry.line=lineOf(text);entry.error=timedOut(e)?'The code did not finish loading in time (an endless loop outside the function?)':e instanceof Error?e.message:'The code could not be loaded'}
 return entry;
}
function entryFor(code){let e=cache.get(code);if(e){cache.delete(code);cache.set(code,e);return e}e=compile(code);cache.set(code,e);if(cache.size>96)cache.delete(cache.keys().next().value);return e}

// One call per frame for all of an effect's fixtures. Returns the raw array (one object or null per fixture) or {error, line}.
function call(entry,json,timeout){
 if(entry.error)return {error:entry.error,line:entry.line};
 const t0=performance.now();let text;
 try{entry.context.__in=json;RUN.runInContext(entry.context,{timeout});text=entry.context.__out}
 catch(e){return {error:timedOut(e)?`It took longer than ${timeout} ms for one frame (an endless loop, or far too much work per fixture)`:e instanceof Error?e.message:'The effect failed'}}
 const ms=performance.now()-t0;entry.ms=entry.runs?entry.ms*.9+ms*.1:ms;entry.runs++;
 if(typeof text!=='string')return {error:'The effect returned nothing'};
 let out;try{out=JSON.parse(text)}catch{return {error:'The effect returned something that is not plain data'}}
 if(!Array.isArray(out))return {error:String(out?.error??'The effect failed'),line:lineOf(out?.stack)};
 return out;
}
const hexColor=c=>/^#[0-9a-fA-F]{6}$/.test(c)?[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255):null;
const unit=v=>v<0?0:v>1?1:v;
/** One fixture's returned values, made safe: finite, in range, known attributes only. notes collects what was dropped. */
export function sanitize(raw,notes=null){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const out={};let any=false;
 for(const key of Object.keys(raw)){const v=raw[key];let value;
  if(v===null||v===undefined)continue;
  if(key==='color')value=typeof v==='string'?hexColor(v):Array.isArray(v)&&v.length>=3&&v.slice(0,3).every(Number.isFinite)?v.slice(0,3).map(unit):undefined;
  else if(key==='opticalMode')value=v==='spot'||v==='beam'?v:undefined;
  else if(!CODE_ATTRIBUTES.includes(key)){notes?.unknown.add(key);continue}
  else if(typeof v!=='number'||!Number.isFinite(v))value=undefined;
  else if(key==='prismRotation')value=Math.max(-1,Math.min(1,v));
  else if(key==='gobo')value=Math.max(0,Math.min(17,Math.round(v)));
  else if(key==='prism')value=Math.max(0,Math.min(3,Math.round(v)));
  else value=unit(v);
  if(value===undefined||value===null){notes?.bad.add(key);continue}
  out[key]=value;any=true}
 return any?out:null;
}
/** params → what the code reads as p: the ordinary effect params (color, secondary, speed, brightness, ...) with args on top. */
export function codeArgs(params){const p={};for(const [k,v] of Object.entries(params??{}))if(!RESERVED.has(k))p[k]=v;return Object.assign(p,params?.args??{})}
/**
 * Run one frame. input = {t, f:[fixture], b:[state below], p, c}; fJson may carry f already serialised.
 * Returns an array with a safe value object (or null = leave it alone) per fixture, or null when the code failed this frame.
 */
export function runCodeEffect(code,input,{label,fJson}={}){
 const entry=entryFor(code),now=performance.now();if(entry.retryAt>now)return null;
 const json=fJson?`{"t":${JSON.stringify(input.t)},"f":${fJson},"b":${JSON.stringify(input.b)},"p":${JSON.stringify(input.p)},"c":${JSON.stringify(input.c)}}`:JSON.stringify(input);
 const out=call(entry,json,CODE_LIMITS.frameMs),rig=fJson??'';
 if(!Array.isArray(out)){fail(label,out.error,out.line);
  // Broken source never recovers. A runtime failure is tried again: at once the first two times, holding the last good
  // frame so a single slow frame is never seen on stage, then after a growing pause (10 s from the fifth in a row).
  entry.fails++;entry.retryAt=entry.error?Infinity:entry.fails<=2?0:now+(entry.fails>=5?10000:entry.fails*200);
  return entry.fails<=2&&entry.last?.rig===rig?entry.last.out:null}
 entry.fails=0;if(label&&errors.has(label))errors.delete(label);
 const safe=out.map(r=>sanitize(r));entry.last={rig,out:safe};return safe;
}
export function codeTiming(code){const e=cache.get(code);return e?.runs?+e.ms.toFixed(4):null}

// A small made-up rig for checking code when it is saved: six fixtures across a truss, then one on its own.
const SAMPLE_STATE={intensity:0,color:[1,1,1],white:0,movementSpeed:1,pan:.5,tilt:.5,opticalMode:'beam',zoom:.5,gobo:0,goboShake:0,prism:0,prismRotation:0,frost:0,focus:.5};
const sampleRig=n=>Array.from({length:n},(_,i)=>({id:'sample-'+(i+1),i,n,phase:n>1?i/(n-1):0,x:n>1?-5+10*i/(n-1):0,y:6,z:n>1?(i%2?1:-1):0,u:n>1?i/(n-1):.5,v:.5,w:n>1?(i%2?1:0):.5,profile:'sample',moving:true,home:{pan:.5,tilt:.5}}));
export function checkArgs(args){
 if(args===undefined)return;if(!args||typeof args!=='object'||Array.isArray(args))throw Error('params.args must be an object of named values');
 const keys=Object.keys(args);if(keys.length>CODE_LIMITS.args)throw Error(`params.args holds at most ${CODE_LIMITS.args} values`);
 for(const k of keys){if(!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(k)||['__proto__','constructor','prototype'].includes(k))throw Error(`params.args.${k}: use a plain name (letters, digits, _)`);const v=args[k];
  if(!(typeof v==='number'&&Number.isFinite(v))&&typeof v!=='boolean'&&!(typeof v==='string'&&v.length<=100)&&!(Array.isArray(v)&&v.length<=64&&v.every(Number.isFinite)))throw Error(`params.args.${k}: use a number, true/false, short text (a #rrggbb colour) or a list of numbers`)}
}
/**
 * Refuse code that would not work: it must load, run inside the time limit at several moments, return only known attributes
 * and finite values, and light or move something. Throws an Error that says what to fix. Cached per source and params.
 */
export function checkCodeEffect(params){
 const code=params?.code;if(typeof code!=='string'||!code.trim())throw Error('A code effect needs params.code: a JavaScript function, or its body ending in return {...}');
 if(code.length>CODE_LIMITS.source)throw Error(`params.code is longer than ${CODE_LIMITS.source} characters`);checkArgs(params.args);
 const p=codeArgs(params),key=code+'\u0000'+JSON.stringify(p),known=checks.get(key);if(known!==undefined){if(known)throw Error(known);return}
 let problem=null;
 try{
  const entry=entryFor(code);if(entry.error)throw Error(say(entry.error,entry.line));
  const notes={unknown:new Set(),bad:new Set()};let useful=false;
  for(const n of [6,1]){const f=sampleRig(n),b=f.map(()=>({...SAMPLE_STATE}));
   for(const time of [0,.137,1,2.71,9.4,59.9]){const speed=typeof p.speed==='number'?p.speed:1,out=call(entry,JSON.stringify({t:time*speed,f,b,p,c:{time,duration:60,progress:time/60,bpm:120,beat:time*2,step:n===6?Math.floor(time):-1,sinceStep:time%1}}),CODE_LIMITS.checkMs);
    if(!Array.isArray(out))throw Error(say(out.error,out.line)+` (at t = ${time} s with ${n} fixture${n===1?'':'s'})`);
    const before=notes.bad.size;for(const r of out)if(sanitize(r,notes))useful=true;
    if(notes.bad.size>before)throw Error(`${[...notes.bad].join(', ')} was not a usable value at t = ${time} s with ${n} fixture${n===1?' (f.n is 1: do not divide by f.n - 1, use f.phase)':'s'}. Numbers must be finite; color is [r, g, b] in 0–1 or "#rrggbb".`)}}
  if(notes.unknown.size)throw Error(`Unknown attribute ${[...notes.unknown].map(k=>`"${k}"`).join(', ')}. Return any of: ${CODE_ATTRIBUTES.join(', ')}.`);
  if(!useful)throw Error(`The code never returned any values. End with return {intensity: ..., color: ...} using any of: ${CODE_ATTRIBUTES.join(', ')}.`);
 }catch(e){problem='Code effect: '+e.message}
 checks.set(key,problem);if(checks.size>400)checks.delete(checks.keys().next().value);if(problem)throw Error(problem);
}

// Served in schema.code so an agent can write an effect without reading the source.
export const CODE_DOC={
 summary:'A code effect is effect:"code" with params.code (JavaScript) and optional params.args (named numbers, booleans, "#rrggbb" colours or number lists the code reads as p.name). The code is one function, called once per fixture per frame (30 Hz), returning the attributes to set on that fixture. Whatever it does not return keeps the look underneath. It must be pure: same inputs, same output. No Math.random, no Date, no state kept between calls.',
 signature:'(t, f, base, p, ctx) => ({intensity, color, ...})   — or just the function body: "return {intensity: wave(t - f.phase)}"',
 inputs:{
  t:'Seconds since the effect started, already multiplied by params.speed. In a cue it follows the cue: it loops with the cue, freezes on pause and speeds up with the live tempo when the cue has a bpm.',
  f:'The fixture: {id, i (index in the group, from 0), n (how many), phase (i/(n-1), 0–1 across the group; 0 when alone), x, y, z (its place on the stage in metres: x left/right, y height, z depth), u, v, w (the same place scaled 0–1 across this effect\'s fixtures), profile, moving (true for moving heads), home: {pan, tilt}}.',
  base:'What the fixture shows underneath this effect: {intensity, color: [r, g, b] 0–1, white, pan, tilt, zoom, focus, frost, gobo, prism, prismRotation, ...}. Use it to modulate instead of replace, e.g. intensity: base.intensity * wave(t). In a cue it is the cue\'s own look (dark if the cue saved none); as a programmer effect (fx.apply) it is the live look.',
  p:'params.args, on top of the ordinary effect params (p.color, p.secondary as "#rrggbb", p.speed, p.brightness, ...). Give every tunable number a name in args so the operator gets a control for it.',
  ctx:'{time (seconds, not scaled by speed), duration, progress (0–1 through the track), bpm, beat (beats since the start, fractional), step (how many note-step hits so far, -1 before the first: advanced by masters.step or a master\'s step-mode sound trigger), sinceStep (seconds since that hit)}.'},
 returns:{
  intensity:'0–1. Multiplied by params.brightness when the preset sets one.',color:'[r, g, b] each 0–1, or "#rrggbb". Wheel fixtures take their nearest saved colour.',white:'0–1',amber:'0–1',mint:'0–1',
  pan:'0–1 of the calibrated range. Move around the current aim with base.pan + offset; keep offsets small (0.02–0.08).',tilt:'0–1, as pan.',zoom:'0–1',focus:'0–1',frost:'0–1',gobo:'whole number 0–17 (0 = open)',goboShake:'0–1',prism:'0–3',prismRotation:'-1 to 1 (0 = still)',movementSpeed:'0–1',opticalMode:'"spot" or "beam"',
  note:'Return null (or nothing) to leave a fixture untouched this frame. Values out of range are clamped; anything not finite is dropped. A fixture only uses what its type has: pan on a wash is ignored.'},
 helpers:{
  math:'sin cos tan asin acos atan atan2 abs min max floor ceil round trunc sqrt cbrt pow exp log log2 sign hypot PI E TAU (Math.* also works)',
  shaping:'clamp(x, a=0, b=1) · fract(x) · lerp(a, b, k) / mix (numbers or [r,g,b]) · smooth(x) · smoothstep(a, b, x) · step(edge, x)',
  cycles:'All take a count of cycles, so wave(t) is one cycle a second and wave(ctx.beat / 4) one every four beats. saw(x) ramps 0→1 · tri(x) 0→1→0 · wave(x) smooth 0→1→0 · square(x, duty=.5) 1 or 0 · pulse(x, width=.25) snaps to 1 then decays · bump(x, center, width) a soft spot',
  random:'hash(a, b=0, c=0) → a fixed 0–1 number for those inputs · noise(x, y=0) → smooth 0–1 noise',
  colour:'hsv(h, s=1, v=1) → [r,g,b] (h 0–1 wraps) · rgb("#rrggbb") → [r,g,b] · kelvin(3200) → [r,g,b] · lerp(colorA, colorB, k)',
  space:'dist(x1, z1, x2=0, z2=0) → metres apart on the stage floor'},
 rules:['Light it: a cue track on dark fixtures needs intensity as well as color.','Write randomness with hash() or noise(), never Math.random.','Guard single fixtures: use f.phase, not f.i / (f.n - 1).','Keep it light: one frame for all fixtures must take under '+CODE_LIMITS.frameMs+' ms (typical effects take 0.1 ms).','Test first with effect.test: it runs the code on real fixtures and returns sample frames, timing and any error with its line.'],
 use:['effect.test {code, group} → check it','preset.save {preset: {id, name, icon, effect: "code", layer, params: {code, args, speed, brightness}}} → it appears in the Effects library (layer intensity | color | position decides its heading and which other effect it replaces on a fixture)','fx.preview / fx.apply {fixtures, preset} → run it on a selection over the live look','effect.apply {preset, group, page?} → make a cue from it','cue.save with a track {group, effect: "code", start, duration, params: {code, args}} → write it straight into a cue; add layer to modify the cue\'s own look instead of replacing those fixtures'],
 examples:[
  {name:'Comet with a coloured tail',code:'const head = fract(t * p.rate), d = fract(head - f.phase);\nreturn {intensity: exp(-d * p.tail), color: lerp(rgb(p.color), rgb(p.secondary), clamp(d * 3))};',args:{rate:.3,tail:8},params:{color:'#ffffff',secondary:'#2b6cff'}},
  {name:'Fire',code:'const n = noise(t * 3 + f.i * 7.3, f.i), flick = noise(t * 11, f.i * 3.1);\nreturn {intensity: clamp(.35 + .5 * n + .25 * flick), color: lerp([1, .12, 0], [1, .6, .1], n)};',args:{}},
  {name:'Lightning',code:'const slot = floor(t * p.rate), strike = hash(slot, 7) < p.chance, age = fract(t * p.rate);\nconst flash = strike ? exp(-age * 9) * (hash(slot, floor(age * 14)) > .35 ? 1 : .2) * step(hash(slot, f.i), p.cover) : 0;\nreturn {intensity: flash, color: [.8, .88, 1]};',args:{rate:1.2,chance:.45,cover:.7}},
  {name:'Ripple out from centre stage on the beat',code:'const r = dist(f.x, f.z) / 8, ring = fract(ctx.beat / 2);\nreturn {intensity: base.intensity * (.2 + .8 * bump(r, ring, .15)), color: hsv(.55 + .1 * r)};',args:{}},
  {name:'Movers draw a slow circle, each a little behind the last',code:'const a = t * p.rate * TAU + f.phase * TAU * p.spread;\nreturn {pan: base.pan + p.size * cos(a), tilt: base.tilt + p.size * .6 * sin(a)};',args:{rate:.15,size:.04,spread:1},layer:'position'},
  {name:'One random light per note hit',code:'if (ctx.step < 0) return {intensity: 0};\nconst on = floor(hash(ctx.step, 3) * f.n) === f.i;\nreturn {intensity: on ? exp(-ctx.sinceStep * 4) : 0, color: hsv(hash(ctx.step))};',args:{}}]
};
