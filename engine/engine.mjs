import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {defaults,migrate,syncGroups,zoneFixtures,fixtureIndex,EFFECTS,PROFILE_DEFS,EFFECT_PRESETS,BUILTIN_MEDIA,ATTRIBUTE_FAMILIES} from './model.mjs';
import {LOOK_PROTOCOL,measure,lookSnap,lookDiffers,CHANGE,STILL} from './look.mjs';
import crypto from 'node:crypto';
import {ICONS} from '../public/icons.js';
import {outputRGB} from '../public/fixture-colors.js';
import {hiddenFixtureIds} from '../public/visibility.js';
import {OSC_ADDRESSES} from './osc-routes.mjs';
import {COMMANDS,SHOW_EDITS,validate,validateShow,validateWheelAttributes,validateEffectParams,groupDescendants,BEAM_VALUES,BEAM_PRESET} from './spec.mjs';
import {CODE_DOC,CODE_LIMITS,checkCodeEffect,codeTiming,effectErrors,clearEffectErrors,onEffectError} from './code-effects.mjs';
import {Versions,LiveState,writeAtomic} from './safety.mjs';
import {ShowFiles,showHash} from './show-files.mjs';
import {render,compose,applyOverrides,finish,blend,blendState,encode,layerEffect,trackFixtures,codeEffect,baseState} from './render.mjs';
import {Output,validateNetwork,checkConnection} from './output.mjs';
import {Assistant} from './assistant.mjs';
const copy=x=>structuredClone(x);
// Show in Finder: select the file, or open the folder. Never waits on Finder.
const reveal=(p,file)=>{if(process.platform!=='darwin')throw Error('Show in Finder works on macOS only: the file is at '+p);import('node:child_process').then(({spawn})=>spawn('open',file?['-R',p]:[p],{stdio:'ignore',detached:true}).unref())};
// Master slots and their keys (show.masters). A key is on one slot or one desk shortcut at most.
const DESK_KEYS={highlight:'Highlight',clear:'Clear',blackout:'Blackout',tap:'Tap tempo',stop:'Stop all'};
// Commands that change the programmer: each is one step of override.undo.
const PROGRAMMER=new Set(['fixture.set','fixture.clear','palette.apply','beam.apply','point.recall','look.copy','override.release','fx.apply','fx.stop','blind.apply']);
const keyName=k=>k.split('+').map(p=>p.length===1?p.toUpperCase():p[0].toUpperCase()+p.slice(1)).join('+');
// Live controls that can fire many times a second: tallied once a minute in the audit log instead of a line each (tally()).
const QUIET=new Set(['masters.trigger','masters.level','masters.step','fixture.set','fixture.clear','master.set','tempo.tap','tempo.nudge','find.step','selection.set','selection.group','sound.meter','sound.test','agent.hello','point.recall','palette.apply','beam.apply']);
const masterSlot=(s,id)=>{const m=s.masters.slots.find(x=>x.id===id);if(!m)throw Error('Unknown master '+id);return m};
const slotName=(s,m)=>`Master ${s.masters.slots.indexOf(m)+1}`+(m.cue?' · '+(m.label??s.cues.find(c=>c.id===m.cue)?.name??m.cue):'');
// conflict: swap trades keys with the current owner (it gets this slot's old key); take leaves the owner without one.
function setMasterKey(s,id,key,conflict){
 const m=masterSlot(s,id),old=m.key??null;if(key===old)return;if(!key){delete m.key;return}
 const other=s.masters.slots.find(x=>x!==m&&x.key===key),desk=Object.keys(s.masters.desk).find(k=>s.masters.desk[k]===key);
 if(other||desk){
  if(!conflict)throw Error(`${keyName(key)} is already ${other?'on '+slotName(s,other):'the '+DESK_KEYS[desk]+' key'}. Pass conflict:"swap" to trade keys or "take" to move it here.`);
  if(other){if(conflict==='swap'&&old)other.key=old;else delete other.key}else{if(conflict==='swap'&&old)s.masters.desk[desk]=old;else delete s.masters.desk[desk]}
 }
 m.key=key;
}
const shortId=prefix=>prefix+'-'+crypto.randomUUID().slice(0,8);
const VERSION=(()=>{try{return JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version}catch{return '0.0.0'}})();
// Look Link sequence numbers count tenths of a second since 2026 (and at least +1 per message), so they keep rising across restarts; int32 until 2032.
const SEQ_EPOCH=Date.UTC(2026,0,1),REPLY_STATUS=['applied','queued','ignored','failed'];
const iso=ms=>new Date(ms).toISOString(),text=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').slice(0,n):'';
const sameHost=(a,b)=>{const n=h=>String(h??'').toLowerCase().replace(/^::ffff:/,'').replace(/^\[|\]$/g,'').replace(/^(localhost|::1)$/,'127.0.0.1');return n(a)===n(b)};
const targetHost=t=>{if(t.kind==='osc')return t.host;try{return new URL(t.url).hostname}catch{return ''}};
export const MOVING=['rogue','mh7','beam200','beam7r'];
export const MEDIA_TYPES={'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.gif':'image','.mp4':'video','.webm':'video','.mov':'video','.m4v':'video'};
// Which attributes a cue with only some parts plays on each fixture: what its look entries recorded in those parts, and
// every attribute of those parts on the fixtures its tracks drive. Cached per cue object while the groups stay the same.
const partCache=new WeakMap();
function partKeys(show,cue){const c=partCache.get(cue);if(c?.groups===show.groups)return c.v;const fam=[...new Set(cue.only.flatMap(f=>ATTRIBUTE_FAMILIES[f]??[]))],famSet=new Set(fam),look=new Map();
 for(const e of cue.look??[]){const ks=Object.keys(e.values).filter(k=>famSet.has(k));if(e.values.color!==undefined&&e.values.colorWheel===undefined&&famSet.has('colorWheel'))ks.push('colorWheel','colorWheel2');if(ks.length)look.set(e.id,new Set([...(look.get(e.id)??[]),...ks]))}
 // Track fixtures take the cue's parts only while one of their tracks is running, so a wave leaves the waiting ones to the look.
 const tracks=cue.tracks.map(tr=>({start:tr.start,end:tr.start+tr.duration,ids:new Set(trackFixtures(show,tr))})),v={look,tracks,fam};
 partCache.set(cue,{groups:show.groups,v});return v}
export class Engine{
 constructor({dataDir,showsDir,output,clock=()=>performance.now()/1000,keepAwake=!output&&process.platform==='darwin'}={}){
  this.awakeEnabled=keepAwake;this.awake=null;this.dir=dataDir;this.clock=clock;this.logs=[];this.output=output??new Output(m=>this.log(m));this.show=defaults();const seed=new URL('../show-template.json',import.meta.url);if(fs.existsSync(seed)){this.show=migrate(JSON.parse(fs.readFileSync(seed,'utf8')));validateShow(this.show)}
  if(dataDir){fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'show.json');if(fs.existsSync(file)){const raw=JSON.parse(fs.readFileSync(file,'utf8')),added=!raw.pages;this.show=migrate(raw);validateShow(this.show);if(added)this.save()}else this.save();}
  this.layers=[];this.kills=new Map();this.killVersion=0;this.highlight=false;this.find=null;this.scene=null;this.flashes=new Map();this.bumps=new Map();this.tempo={bpm:null,source:null,taps:[],anchor:null};this.levels=new Map();this.faderOwned=new Set();this.mods=null;this.soundHolds=new Map();this.agents=new Map();this.net={in:[],out:[],count:{in:0,out:0,rejected:0},listener:{listening:false},presets:{}};this.looks=new Map();this.presetBursts=new Map();this.presetAsks=new Map();this.sendHook=null;this.onNetworkChange=null;this.selection={ids:[],group:'backlights',revision:0};this.lampCommands=new Map();this.revision=1;this.playback=null;this.overrides={};this.fx=[];this.master=1;this.blackout=false;this.held=null;this.fading=null;this.transition=null;this.stack=null;this.release=null;this.programmed=null;this.raw=null;this.preview=null;this.previewFrames=null;this.blind=false;this.blindOverrides={};this.blindRelease=null;this.blindStates=null;this.fxPreview=null;this.requests=new Map();this.listeners=new Set();this.tickCount=0;this.dropped=0;this.lastTick=null;this.undo=[];this.undoShow=null;this.frames=render(this.show,null,0);onEffectError(m=>this.log(m));this.log('Engine ready in preview. Physical output is disarmed.');
  // Show safety (docs/SHOW-SAFETY.md): the lock survives a restart; an unclean live-state file becomes an offer to resume.
  this.versions=new Versions(dataDir,()=>this.clock());this.live=new LiveState(dataDir);
  // Show files: savedRevision is the revision last saved to or opened from the current file; any other revision is unsaved.
  this.files=new ShowFiles(dataDir,showsDir);this.savedRevision=this.files.current?.hash===showHash(this.show)?this.revision:-1;const prev=this.live.read();this.locked=!!prev?.locked;
  // An unclean file (a crash) or a deliberate stop while armed with the last look held (held: the rig still shows it, e.g.
  // a restart to take an engine fix mid-show) becomes an offer to resume. A held offer is only good for 30 minutes.
  const live=prev&&(prev.armed||prev.scene||prev.stack||prev.running?.length),fresh=prev&&(!prev.held||Date.now()-Date.parse(prev.at)<30*60e3);
  this.resume=live&&fresh&&(!prev.clean||prev.held)?{...prev,reason:prev.clean?'restart':'crash'}:null;if(this.resume)this.log(this.resume.reason==='crash'?'The engine restarted unexpectedly during a show: offering to resume.':'The engine was restarted while the rig held its look: offering to resume.');
  // The built-in assistant (docs/ASSISTANT.md). Its key lives in <data>/assistant.json, never in the show.
  this.assistant=new Assistant({dir:dataDir,engine:this});
 }
 // A full or read-only disk must not stop a show edit from taking effect: the show in memory is the one playing. The
 // failure is logged once and shown in runtime.showFile.error until a save works again.
 save(){if(!this.dir)return;const f=path.join(this.dir,'show.json');
  try{writeAtomic(f,JSON.stringify(this.show,null,2));if(this.saveError){this.saveError=null;this.log('The show is saving to disk again')}}
  catch(e){if(this.saveError!==e.message)this.log(`The show could NOT be saved to disk (${e.message}). Changes are live but will be lost if the engine stops: free up space or fix the folder, then save again.`);this.saveError=e.message}}
 // While output is armed this Mac must not go to sleep (display, idle or system): caffeinate holds it awake and lets go
 // when output is disarmed or the engine exits. macOS only; nothing runs while disarmed.
 keepAwake(on){
  if(!this.awakeEnabled)return;
  if(!on){if(this.awake){try{this.awake.kill()}catch{}this.awake=null}return}
  if(this.awake)return;this.awake='starting';
  import('node:child_process').then(({spawn})=>{if(!this.output.armed){this.awake=null;return}
   const c=spawn('/usr/bin/caffeinate',['-dims','-w',String(process.pid)],{stdio:'ignore'});c.on('error',()=>{if(this.awake===c)this.awake=null});c.on('exit',()=>{if(this.awake===c)this.awake=null});this.awake=c;this.log('Keeping this Mac awake while output is armed')}).catch(()=>{this.awake=null});
 }
 // Audit log is append-only and asynchronous so a GO never waits on the disk; rotates at ~2 MB.
 log(message){const row={at:new Date().toISOString(),message};this.logs.push(row);if(this.logs.length>120)this.logs.shift();if(!this.dir)return;
  const f=path.join(this.dir,'audit.jsonl'),line=JSON.stringify(row)+'\n';
  // After a disk error the audit file is tried again every 30 s, not on every line.
  if(!this.audit){if(Date.now()<(this.auditRetryAt??0))return;try{this.auditBytes=fs.existsSync(f)?fs.statSync(f).size:0;this.audit=fs.createWriteStream(f,{flags:'a'});this.audit.on('error',()=>{this.audit=null;this.auditRetryAt=Date.now()+30000})}catch{this.audit=null;this.auditRetryAt=Date.now()+30000;return}}
  if(this.auditBytes>2e6){const old=this.audit;this.audit=null;old.end(()=>{try{fs.renameSync(f,f+'.previous')}catch{}});this.auditBytes=0;this.audit=fs.createWriteStream(f,{flags:'a'});this.audit.on('error',()=>{this.audit=null;this.auditRetryAt=Date.now()+30000})}
  this.auditBytes+=line.length;this.audit?.write(line)}
 // High-rate live controls (master presses, fader and knob moves, sound hits, flash let-gos, meter keep-alives) are counted
 // and written as one line a minute. On 2026-11-01 they were most of audit.jsonl: up to 7 000 lines an hour, a line per
 // drum hit. Show events (GO, scenes, cue release, arm, kills, edits, errors) are still logged one by one.
 tally(what,detail){const t=this.tallies??={};const x=t[what]??={n:0,by:{}};x.n++;if(detail)x.by[detail]=(x.by[detail]??0)+1;
  if(!this.tallyTimer){this.tallyTimer=setTimeout(()=>this.flushTally(),60000);this.tallyTimer.unref?.()}}
 flushTally(){clearTimeout(this.tallyTimer);this.tallyTimer=null;const t=this.tallies;this.tallies=null;if(!t)return;
  this.log('Live controls in the last minute: '+Object.entries(t).map(([k,x])=>`${k} ×${x.n}`+(Object.keys(x.by).length?' ('+Object.entries(x.by).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([d,n])=>`${d} ×${n}`).join(', ')+')':'')).join(' · '))}
 elapsed(){return this.playback?this.sourceTime(this.playback,true):0}
 tick(){
  const now=this.clock();if(this.lastTick!==null&&now-this.lastTick>.1)this.dropped++;this.lastTick=now;this.tickCount++;this.tickAt=performance.timeOrigin+performance.now();
  this.follow();
  this.layers=this.layers.filter(l=>{const c=l.cue,done=!c.loop&&!c.hold&&this.sourceTime(l,true)>=c.duration;if(done){this.log(`Cue complete underneath · ${c.name}`);this.mods?.changed()}return !done});
  let t=this.elapsed();let cue=this.playback?.cue;
  if(cue&&t>=cue.duration){if(cue.loop)t%=cue.duration;else if(cue.hold)t=cue.duration-1e-6;else{if(!this.scene)this.held=copy(this.frames).map(f=>({...f,intensity:0}));else if(!this.layers.length)this.toFloor(this.sceneFade(),copy(this.raw??this.frames));this.log(`Cue complete · ${cue.name}`+(this.layers.length?'; the cue underneath takes over':this.scene?`; back to scene ${this.scene.name}`:'; intensity zero, final positions held.'));this.playback=this.layers.pop()??null;if(!this.playback)this.stack=null;cue=this.playback?.cue??null;this.mods?.changed();t=cue?this.sourceTime(this.playback):0}}
  let base=cue?this.composite(this.playback,this.layers):this.held?copy(this.held):this.floor();
  if(this.transition){const tr=this.transition,k=Math.min(1,(now-tr.start)/Math.max(.001,tr.duration));base=blend(tr.from.cue?this.composite(tr.from,tr.from.layers??[]):tr.from.frames,base,k);if(k>=1)this.transition=null}
  this.raw=base;let states=this.applyFx(applyOverrides(this.show,base,this.overrides),this.fx,now);
  // A release blends from captured frames to what is programmed now. Manual fades (fadeFrom) give a fixture its own clock in
  // r.own, so one fixture's change never restarts another's fade.
  if(this.release){const r=this.release,k=Math.min(1,(now-r.start)/Math.max(.001,r.duration)),own=r.own;let busy=k<1;
   states=states.map(s=>{const from=r.frames[s.id];if(!from)return s;const o=own?.[s.id],ko=o?Math.min(1,(now-o.start)/Math.max(.001,o.duration)):k;if(ko<1)busy=true;return blendState(from,s,ko)});if(!busy)this.release=null}
  this.programmed=states;this.frames=finish(this.show,this.highlighted(states),this.master,this.blackout);
  this.previewFrames=this.preview||this.blind||this.fxPreview?this.renderPreview(now):null;
  if(this.fading){const factor=Math.max(0,1-(now-this.fading.start)/Math.max(.001,this.fading.duration));this.frames=this.fading.frames.map(f=>({...f,intensity:this.blackout?0:f.intensity*factor}));if(factor===0){this.held=copy(this.frames);this.fading=null}}
  // Parked fixtures (docs/PARK.md) hold their captured output over cues, programmer, Highlight and master; blackout still wins.
  if(this.show.parked?.length){const pk=this.parkIndex();this.frames=this.frames.map(f=>{const p=pk.get(f.id);return p?{...p,id:f.id,intensity:this.blackout?0:p.intensity}:f})}
  // Kills (docs/KILL.md) come after park: killed fixtures show nothing, except what a held master flash or sound hit lights,
  // so a kill works like an "off" master that hits still punch through (the operator's Backlights off + Drums backlight).
  const killed=this.killedIds();if(killed){const hit=this.flashIds();this.frames=this.frames.map(f=>f.intensity&&killed.has(f.id)&&!hit?.has(f.id)?{...f,intensity:0}:f)}
  this.frames=this.limited(this.frames);
  // Packets are only built while they can be sent; the patch sheet encodes its own readback.
  const packets=this.output.armed?encode(this.show,this.frames,{physical:true}):new Map();
  for(const [id,pulse] of this.lampCommands){
   if(!this.output.armed||now>=pulse.until){this.lampCommands.delete(id);continue}
   const fixture=this.show.fixtures.find(f=>f.id===id);
   const packet=packets.get(this.show.settings.mappings[fixture.universe]);
   const control=PROFILE_DEFS[fixture.profile].lampControl;
   if(packet)packet[fixture.address+control.channel-2]=control[pulse.action];
  }
  this.lastPackets=packets;this.output.send(packets);
  this.watchLooks();
  for(const f of this.listeners)f();
 }
 sourceTime(p,raw=false){const cue=p.cue,t=p.paused?p.offset:p.offset+(this.clock()-p.started)*(p.rate??1);return raw?t:cue.loop?t%cue.duration:Math.min(t,cue.duration-1e-6)}
 // Restart a running cue's clock where it is now, so a pause, a seek or a tempo change never makes it jump.
 rebase(r){r.offset=this.sourceTime(r,true);r.started=this.clock()}
 // Tap tempo (docs/MIDI-AND-SOUND.md): a cue with a bpm plays at live tempo / its bpm, so its tracks, effect speeds,
 // loops and auto-follow waits all scale together. Crossfades stay in real seconds.
 // A cue with bpm follows the live tempo (tempo ÷ bpm); speed is its own rate on top, or alone when it does not follow.
 rateFor(cue){const b=cue.bpm,t=this.tempo.bpm;return (b&&t?t/b:1)*(cue.speed??1)}
 setTempo(bpm,source){
  for(const r of this.running())this.rebase(r);this.tempo.setAt=bpm?new Date().toISOString():null;this.tempo.bpm=bpm?Math.round(Math.max(20,Math.min(400,bpm))*100)/100:null;this.tempo.source=this.tempo.bpm?source:null;
  if(!this.tempo.bpm)this.tempo.taps=[];for(const r of this.running())r.rate=this.rateFor(r.cue);
 }
 tempoBase(){return this.tempo.bpm??this.playback?.cue.bpm??this.running().find(r=>r.cue.bpm)?.cue.bpm??120}
 tapTempo(){
  const now=this.clock(),t=this.tempo;if(t.taps.length&&now-t.taps.at(-1)>2)t.taps=[];t.taps.push(now);if(t.taps.length>5)t.taps.shift();t.anchor=now;t.anchorAt=Date.now();
  // A tap far off the beat (more than 40% from the average so far) starts a new count from the last two taps and changes
  // nothing until the next tap confirms it: one stray tap no longer leaves the cues crawling (58 BPM on 2026-11-01).
  let stray=false;if(t.taps.length>=3){const gaps=t.taps.slice(1).map((x,i)=>x-t.taps[i]),last=gaps.at(-1),avg=gaps.slice(0,-1).reduce((a,b)=>a+b,0)/(gaps.length-1);if(Math.abs(last-avg)>.4*avg){t.taps=t.taps.slice(-2);stray=true}}
  if(t.taps.length>=2&&!stray)this.setTempo(60*(t.taps.length-1)/(t.taps.at(-1)-t.taps[0]),'tap');
 }
 // far: the live tempo is far from the cues' own (under 0.75× or over 1.33×), as when a stray tap left 58 BPM on the
 // 2026-11-01 show and every BPM cue crawled. The desk shows it in amber with the rate; tempo.set {} (↺, Shift+T,
 // the APC40 Metronome button) goes back to each cue's own tempo. anchorAt is wall-clock ms, so the status is steady.
 tempoStatus(){const t=this.tempo,top=this.playback,ref=top?.cue.bpm??this.running().find(r=>r.cue.bpm)?.cue.bpm??null,ratio=t.bpm&&ref?+(t.bpm/ref).toFixed(3):null;
  return {bpm:t.bpm,source:t.source,cue:top?.cue.bpm??null,rate:top?+(top.rate??1).toFixed(4):1,anchorAt:t.anchorAt??null,setAt:t.setAt??null,ratio,far:ratio!==null&&(ratio<.75||ratio>1.34)}}
 // Running cues (docs/CUE-PLAYBACK.md): the newest cue is this.playback; earlier cues keep running underneath in this.layers.
 // A fixture follows the newest running cue that uses it (its look entries or track groups). A cue whose fixtures are all
 // taken by newer cues has nothing left to show and retires, so stepping through full-look cues behaves as before.
 controls(cue){return new Set([...(cue.look??[]).map(e=>e.id),...cue.tracks.flatMap(tr=>trackFixtures(this.show,tr))])}
 // A master with highest precedence (slot.priority) wins its fixtures over every other running cue, however new, and the
 // scene, like a high-priority Hog cuelist. Among several, the newest wins. Programmer, Highlight, park, master and
 // blackout still apply on top.
 byPrecedence(top,layers){
  if(!layers.length||![top,...layers].some(r=>r.master))return [top,layers];const slots=this.show.masters.slots,hi=r=>!!r.master&&!!slots.find(s=>s.id===r.master)?.priority;
  const all=[...layers,top];if(!all.some(hi)||hi(top)&&layers.every(l=>!hi(l)))return [top,layers];
  const order=[...all.filter(r=>!hi(r)),...all.filter(hi)];return [order.at(-1),order.slice(0,-1)];
 }
 // Cues saved with only some parts (cue.only) change just the attributes they recorded in those parts; the rest of each
 // fixture comes from the full cues, masters and scene below. Among them the newest wins, highest precedence last;
 // a full cue newer than a part cue keeps its fixtures.
 composite(top,layers){
  const all=[...layers,top];if(!all.some(r=>r.cue.only))return this.compositeFull(top,layers);
  const full=all.filter(r=>!r.cue.only),parts=all.filter(r=>r.cue.only),slots=this.show.masters.slots,hi=r=>!!r.master&&!!slots.find(s=>s.id===r.master)?.priority;
  const states=full.length?this.compositeFull(full.at(-1),full.slice(0,-1)):this.scene?this.floor():compose(this.show,null,0),index=new Map(states.map((s,i)=>[s.id,i]));
  // A part cue plays over the full cues older than it: a newer full cue (e.g. a still closing look) takes its fixtures back.
  const fullAge=new Map();all.forEach((r,i)=>{if(!r.cue.only)for(const id of r.controls??this.controls(r.cue))fullAge.set(id,hi(r)?Infinity:i)});
  for(const r of [...parts.filter(r=>!hi(r)),...parts.filter(hi)]){const own=new Map(compose(this.show,r.cue,this.sourceTime(r)).map(s=>[s.id,s])),k=this.levelOf(r),age=hi(r)?Infinity:all.indexOf(r);
   const pk=partKeys(this.show,r.cue),t=this.sourceTime(r),act=new Set();for(const tr of pk.tracks)if(t>=tr.start&&t<tr.end)for(const id of tr.ids)act.add(id);
   const keyed=new Map(pk.look);for(const id of act)keyed.set(id,new Set([...(keyed.get(id)??[]),...pk.fam]));
   for(const [id,keys] of keyed){const i=index.get(id),st=own.get(id);if(i===undefined||!st||(fullAge.get(id)??-1)>age)continue;const next={...states[i]};for(const key of keys){if(st[key]===undefined)delete next[key];else next[key]=key==='intensity'?st[key]*k:st[key]}states[i]=next}}
  return states;
 }
 levelOf(r){return !r.master||!this.levels.size||this.flashes.get(r.master)===r.cue.id||this.bumped(r.cue.id)?1:this.levels.get(r.master)??1}
 // A held flash bumps the cue it holds, whoever started it (bumps: slot → cue ID).
 bumped(cue){for(const c of this.bumps.values())if(c===cue)return true;return false}
 compositeFull(top,layers){
  [top,layers]=this.byPrecedence(top,layers);
  const states=compose(this.show,top.cue,this.sourceTime(top)),floor=this.scene&&this.floor(),dim=r=>this.levelOf(r);
  if(!layers.length&&!floor&&dim(top)===1)return states;
  const taken=new Set(top.controls??this.controls(top.cue)),index=new Map(states.map((st,i)=>[st.id,i]));
  // A master's fader level scales only the fixtures its own cue shows.
  const topLevel=dim(top);if(topLevel<1)for(const id of taken){const i=index.get(id);if(i!==undefined)states[i]={...states[i],intensity:states[i].intensity*topLevel}}
  for(let i=layers.length-1;i>=0;i--){const l=layers[i],ids=[...(l.controls??this.controls(l.cue))].filter(id=>!taken.has(id)&&index.has(id));if(!ids.length)continue;
   const own=new Map(compose(this.show,l.cue,this.sourceTime(l)).map(st=>[st.id,st])),k=dim(l);for(const id of ids){const st=own.get(id);states[index.get(id)]=k<1?{...st,intensity:st.intensity*k}:st;taken.add(id)}}
  // Fixtures no running cue uses show the active scene instead of resting dark.
  if(floor)for(const st of floor)if(!taken.has(st.id)&&index.has(st.id))states[index.get(st.id)]=st;
  return states;
 }
 pruneLayers(){
  // A cue with only some parts never takes a fixture over, so it never retires the look underneath.
  const taken=new Set(this.playback?.cue.only?[]:this.playback?.controls??[]),keep=[];
  // A cue held by a master (its key or fader) is never retired by being covered: it stays underneath, ready to show again.
  for(let i=this.layers.length-1;i>=0;i--){const l=this.layers[i],own=!!l.master||[...l.controls].some(id=>!taken.has(id));if(own&&keep.length<7)keep.unshift(l);else this.log(`Cue retired · ${l.cue.name} (every fixture taken by newer cues)`);if(!l.cue.only)for(const id of l.controls)taken.add(id)}
  this.layers=keep;
 }
 running(){return [...this.layers,this.playback].filter(Boolean)}
 runningCue(id){const list=this.running(),r=id===undefined?this.playback:list.find(l=>l.cue.id===id);if(!r)throw Error(id===undefined?'No cue is running':'Cue '+id+' is not running');return r}
 runningStatus(){const top=this.playback,slots=this.show.masters.slots;return this.running().map(l=>({id:l.cue.id,name:l.cue.name,top:l===top,...(l.master?{master:l.master,...(slots.find(s=>s.id===l.master)?.priority?{priority:true}:{})}:{}),paused:l.paused,elapsed:+this.sourceTime(l).toFixed(2),duration:l.cue.duration,loop:!!l.cue.loop,hold:!!l.cue.hold,fixtures:l.controls.size,page:l.page??null,entry:l.entry??null})).reverse()}
 // Highlight (Hog-style): the selected fixtures show full, open white, beams open; position, zoom and focus unchanged.
 // Applied after the programmer so it is never recorded, saved or sent to look reports; master and blackout still apply.
 // Find mode (docs/FIND-MODE.md): Highlight on one fixture at a time from a list, Hog Next/Back style. Transient.
 findStart({group,ids,at=0}){
  const enabled=this.show.fixtures.filter(f=>f.enabled),known=new Set(enabled.map(f=>f.id)),g=group&&group!=='all'?this.show.groups.find(x=>x.id===group):null;
  if(group&&group!=='all'&&!g)throw Error('Unknown group '+group);if(ids)this.ensureIds(ids);
  const cur=this.selection.ids.length>1?this.selection.ids:null,list=(ids??g?.fixtures??cur??enabled.map(f=>f.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))).filter(id=>known.has(id));
  if(!list.length)throw Error('Nothing to find: no enabled fixtures in that list');
  this.find={ids:list,group:g?.id??(ids||cur?this.selection.group??null:null),index:0};this.highlight=true;this.findGo(at);this.log(`Find on · ${list.length} fixtures`);
 }
 findGo(i){const f=this.find,n=f.ids.length;f.index=((i%n)+n)%n;this.selection={ids:[f.ids[f.index]],group:f.group,revision:this.selection.revision+1};this.highlight=true}
 findStatus(){const f=this.find;if(!f)return {active:false};const id=f.ids[f.index],x=fixtureIndex(this.show).get(id);
  return {active:true,index:f.index,total:f.ids.length,id,name:x?.name??id,profile:x?.profile??null,patch:x?.address?`${x.universe}:${x.address}`:null,group:f.group}}
 killedIds(){if(!this.kills.size)return null;const key=this.revision+':'+this.killVersion;if(this.killCache?.key===key)return this.killCache.ids;const ids=new Set();
  for(const k of this.kills.values()){if(k.group){for(const id of this.show.groups.find(g=>g.id===k.group)?.fixtures??[])ids.add(id)}else{const m=this.show.masters.slots.find(s=>s.id===k.slot),cue=m?.cue&&this.show.cues.find(c=>c.id===m.cue);if(cue)for(const id of this.controls(cue))ids.add(id)}}
  this.killCache={key,ids};return ids}
 flashIds(){if(!this.flashes.size&&!this.bumps.size)return null;const ids=new Set(),slots=this.show.masters.slots;for(const id of [...this.flashes.keys(),...this.bumps.keys()]){const m=slots.find(s=>s.id===id),cue=m?.cue&&this.show.cues.find(c=>c.id===m.cue);if(cue)for(const f of this.controls(cue))ids.add(f)}return ids}
 killStatus(){const slots=this.show.masters.slots;return [...this.kills.values()].map(k=>{if(k.group)return {group:k.group,name:this.show.groups.find(g=>g.id===k.group)?.name??k.group};const i=slots.findIndex(s=>s.id===k.slot),m=slots[i];return {slot:k.slot,master:i+1,name:m?.label??this.show.cues.find(c=>c.id===m?.cue)?.name??k.slot}})}
 // Intensity limits (show.limits, limit.set): fixture → the lowest max of its limited groups, built once per show change.
 // Applied last, after the grand master, park and kills, so nothing can push a capped group past its limit.
 limitIndex(){const list=this.show.limits??[];if(this.limitCache?.list===list&&this.limitCache.groups===this.show.groups)return this.limitCache.map;const map=new Map();
  for(const l of list)for(const id of this.show.groups.find(g=>g.id===l.group)?.fixtures??[])map.set(id,Math.min(map.get(id)??1,l.max));this.limitCache={list,groups:this.show.groups,map};return map}
 limited(frames){const lim=this.limitIndex();if(!lim.size)return frames;return frames.map(f=>{const m=lim.get(f.id);return m!==undefined&&f.intensity>m?{...f,intensity:m}:f})}
 parkIndex(){const list=this.show.parked;if(this.parkCache?.list!==list)this.parkCache={list,map:new Map(list.map(p=>[p.id,p.values]))};return this.parkCache.map}
 // Park: capture what each fixture shows right now (after master) and hold it; unpark lets playback take it back.
 park(args){
  const ids=args.ids??(args.group==='all'?this.show.fixtures.map(f=>f.id):args.group?this.show.groups.find(g=>g.id===args.group)?.fixtures:this.selection.ids);
  if(!ids)throw Error('Unknown group '+args.group);if(!ids.length)throw Error('Nothing to park: give ids or group, or select fixtures');this.ensureIds(ids);
  const set=new Set(ids),now=new Map(this.frames.map(f=>[f.id,f]));
  this.update(s=>{const kept=(s.parked??[]).filter(p=>!set.has(p.id));s.parked=args.parked===false?kept:[...kept,...ids.filter(id=>now.has(id)).map(id=>{const {id:_,...values}=now.get(id);return {id,values:copy(values)}})]});
  this.log(`${args.parked===false?'Unparked':'Parked'} ${ids.length} fixture${ids.length===1?'':'s'}`);
 }
 highlighted(states){
  if(!this.highlight||!this.selection.ids.length)return states;const ids=new Set(this.selection.ids);
  return states.map(st=>{if(!ids.has(st.id))return st;const {colorWheel,colorWheel2,...rest}=st;return {...rest,intensity:1,color:[1,1,1],white:0,gobo:0,goboShake:0,prism:0,prismRotation:0,frost:0,opticalMode:'beam'}});
 }
 // Scenes (docs/MASTERS-AND-SCENES.md): one saved look stays on underneath every cue. Fixtures no running cue uses show it,
 // and releasing or stopping the last cue fades back to it instead of to dark. Its states are composed once per show revision.
 floor(){
  const sc=this.scene;if(!sc)return compose(this.show,null,0);
  if(sc.rev!==this.revision){const saved=this.show.scenes.find(x=>x.id===sc.id);if(!saved){this.scene=null;return compose(this.show,null,0)}
   this.scene={id:saved.id,name:saved.name,rev:this.revision,states:compose(this.show,{id:'scene',name:saved.name,duration:1,loop:true,tracks:[],look:saved.look},0)}}
  return copy(this.scene.states);
 }
 sceneFade(){return this.show.playback.sceneFade??2}
 // Nothing left running: crossfade from what was showing to the floor (the scene, or dark).
 toFloor(fade,frames){this.held=null;this.fading=null;this.transition=fade>0?{start:this.clock(),duration:fade,from:{frames}}:null}
 dropScene(fade){
  if(!this.scene)return;const from=copy(this.raw??this.frames);this.log(`Scene released · ${this.scene.name}`);this.scene=null;
  if(!this.playback)this.held=from.map(f=>({...f,intensity:0}));this.fading=null;this.transition=fade>0?{start:this.clock(),duration:fade,from:{frames:from}}:null;
 }
 releaseCue(r,fade=1.5,quiet=false){
  if(fade>0)this.transition={start:this.clock(),duration:fade,from:this.playback?{...this.playback,layers:[...this.layers]}:{frames:copy(this.raw??this.frames)}};
  if(r===this.playback){this.playback=this.layers.pop()??null;if(!this.playback){if(!this.scene)this.held=copy(this.raw??this.frames).map(f=>({...f,intensity:0}));if(fade>0)this.transition.from={frames:copy(this.raw??this.frames)}}}
  else this.layers=this.layers.filter(l=>l!==r);
  for(const [slot,cue] of this.flashes)if(cue===r.cue.id)this.flashes.delete(slot);
  if(quiet)return this.tally('flash let go',r.cue.name);
  this.log(`Released · ${r.cue.name}`+(this.playback?` · ${this.playback.cue.name} carries on`:this.scene?` · back to scene ${this.scene.name}`:' · nothing else running, intensity to zero with positions held'));
 }
 // Masters (docs/MASTERS-AND-SCENES.md): a slot holds a cue and an action. Keyboard, mouse, MCP and OSC all press it here.
 // Cues start on top of whatever runs, keeping the programmer and the page stack. A flash only lets go of a cue it started.
 masterTrigger(id,down){
  // A let-go always drops this slot's bump first, even for a slot cleared, re-assigned or removed while held, so a bump
  // can never stay behind holding a shared cue at full.
  if(!down)this.bumps.delete(id);
  const slots=this.show.masters.slots,slot=slots.find(x=>x.id===id);if(!slot)throw Error('Unknown master '+id);
  if(!slot.cue){if(down)throw Error(`Master ${slots.indexOf(slot)+1} has no cue`);return}
  const cue=this.show.cues.find(c=>c.id===slot.cue),run=this.running().find(l=>l.cue.id===slot.cue),fade=slot.fade??0;
  const start=(keep=false)=>{this.startCue(cue,{fade,keep});this.playback.master=slot.id};
  if(slot.midi)this.mods?.midi?.note(slot.midi,down);
  if(!down){this.bumps.delete(slot.id);if(slot.action==='flash'&&this.flashes.get(slot.id)===slot.cue){this.flashes.delete(slot.id);if(run)this.releaseCue(run,fade,true)}return}
  // A held flash is the master at full and on top, whatever its fader says (like a Hog flash button). Over its cue
  // already running it bumps that cue to full and to the top until let go: its own fader's cue, or the same cue held by
  // another master or the cue list. Before 2026-11-01 a flash over another master's cue did nothing at all: with Back
  // Light up on m2 (kick), m3 (lead, follow) and m5 (tom), kicks showed nothing while the lead rode it at a low level.
  if(slot.action==='flash'){if(!run){start(true);this.flashes.set(slot.id,cue.id)}else if(this.flashes.get(slot.id)!==cue.id){this.bumps.set(slot.id,cue.id);this.bringToTop(run)}}
  // Pressed with its fader at zero, a master starts at full instead of running invisibly and holding its lights at zero.
  else if(slot.action==='toggle'){if(run)this.releaseCue(run,fade);else{if(this.levels.get(slot.id)===0)this.levels.delete(slot.id);start()}}
  else if(slot.action==='go'){if(this.levels.get(slot.id)===0)this.levels.delete(slot.id);start()}
  else if(slot.action==='pause'){if(run){this.rebase(run);run.paused=!run.paused;this.log(`${run.paused?'Paused':'Resumed'} · ${run.cue.name}`)}}
  else if(slot.action==='release'&&run)this.releaseCue(run,fade);
 }
 // Put a running cue on top without restarting it, so it wins every fixture it uses.
 bringToTop(run){if(run===this.playback)return;this.layers=this.layers.filter(l=>l!==run);if(this.playback)this.layers.push(this.playback);this.playback=run}
 mastersStatus(){const running=new Set(this.running().map(l=>l.cue.id));return {held:[...[...this.flashes].filter(([,cue])=>running.has(cue)).map(([slot])=>slot),...this.bumps.keys()],levels:Object.fromEntries(this.levels)}}
 // masters.status: every slot as the desk shows it, plus cues shared by several masters. While one master holds a shared
 // cue at full, a flash on another can only bump it to where it already is, so the operator sees nothing (2026-11-01).
 mastersReport(){
  const slots=this.show.masters.slots,by=new Map(),running=new Set(this.running().map(r=>r.cue.id)),held=new Set(this.mastersStatus().held),name=id=>this.show.cues.find(c=>c.id===id)?.name??id;
  for(const m of slots)if(m.cue)by.set(m.cue,[...(by.get(m.cue)??[]),m.id]);const num=id=>slots.findIndex(x=>x.id===id)+1;
  const shared=[...by].filter(([,ids])=>ids.length>1).map(([cue,ids])=>({cue,name:name(cue),slots:ids,numbers:ids.map(num),warning:`${name(cue)} is on masters ${ids.map(num).join(', ')}: while one of them holds it up at full, a flash on another shows no change. Give each its own cue (masters.own).`}));
  return {slots:slots.map((m,i)=>({id:m.id,number:i+1,key:m.key??null,label:m.label??null,cue:m.cue??null,cueName:m.cue?name(m.cue):null,action:m.action,fade:m.fade??0,priority:!!m.priority,soloKill:!!m.soloKill,
   sound:m.sound?{mode:m.sound.mode??'hit',channel:m.sound.channel,enabled:m.sound.enabled!==false}:null,level:this.levels.get(m.id)??1,held:held.has(m.id),running:!!m.cue&&running.has(m.cue),sharedWith:m.cue?by.get(m.cue).filter(x=>x!==m.id):[]})),shared};
 }
 // A master's level (its fader) scales the cue that master started. Like a Hog fader, raising it from zero starts the
 // cue and bringing it back to zero releases it, but only if the fader started it.
 masterLevel(id,level,go=true){
  const slot=this.show.masters.slots.find(x=>x.id===id);if(!slot)throw Error('Unknown master '+id);
  if(level>=1)this.levels.delete(id);else this.levels.set(id,level);if(!go||!slot.cue)return;
  const run=this.running().find(l=>l.cue.id===slot.cue);
  if(level>0&&!run){this.startCue(this.show.cues.find(c=>c.id===slot.cue),{fade:slot.fade??0});this.playback.master=slot.id;this.faderOwned.add(id)}
  // Fader to zero releases whatever this master started, by its key, pad or fader (Hog-style): never a cue started elsewhere.
  else if(level===0&&run&&(this.faderOwned.has(id)||run.master===id)){this.faderOwned.delete(id);this.releaseCue(run,slot.fade??0)}
 }
 // A sound hit (sound module) presses the master and lets go after its hold; another hit during the hold extends it.
 soundHit(id){this.tally('sound hit',id);
  const slot=this.show.masters.slots.find(x=>x.id===id);if(!slot?.cue)return;const hold=slot.sound?.holdMs??80,held=this.soundHolds.get(id);
  if(slot.sound?.mode==='step'){try{this.stepMaster(id)}catch{}return}
  if(held)clearTimeout(held);else this.masterTrigger(id,true);
  const timer=setTimeout(()=>{this.soundHolds.delete(id);try{this.masterTrigger(id,false);this.safeTick();this.mods?.changed()}catch(e){this.log('Sound trigger: '+e.message)}},hold);timer.unref?.();this.soundHolds.set(id,timer);
 }
 // An edited cue that is running: its copy becomes the saved cue, keeping its clock, so the change shows on the rig without
 // a re-GO (2026-11-01: a running cue kept its old values until GO). A Note step chase keeps its position.
 retake(r,cue){this.rebase(r);const next=copy(cue);next.tracks.forEach((tr,i)=>{const old=r.cue.tracks[i];if(tr.effect==='step'&&old?.effect==='step')for(const k of ['step','stepAt','stepFade'])if(old.params[k]!==undefined)tr.params[k]=old.params[k]});
  r.cue=next;r.rate=this.rateFor(next);r.controls=this.controls(next)}
 // Note step (docs/MIDI-AND-SOUND.md): advance every step track of the master's running cue. The crossfade is 40% of
 // the time since the last step, at most 0.3 s, so slow playing glides and fast playing snaps. Only the running copy changes.
 stepMaster(id){
  const slot=this.show.masters.slots.find(x=>x.id===id),run=slot?.cue&&this.running().find(l=>l.cue.id===slot.cue);if(!run)throw Error(`Master ${id}'s cue is not running`);
  const now=this.sourceTime(run);
  for(const tr of run.cue.tracks)if(tr.effect==='step'||tr.effect==='code'){const p=tr.params,t=now-tr.start;p.stepFade=p.step===undefined?.15:Math.min(.3,Math.max(.03,.4*(t-(p.stepAt??t))));p.step=(p.step??-1)+1;p.stepAt=t}
 }
 // Start a cue, crossfading from whatever is showing. Outgoing cues keep running during the fade. A flash (keep) is
 // temporary, so it never retires the cues it covers: letting go shows them again.
 startCue(cue,{fade=0,keep=false}={}){
  if(fade>0)this.transition={start:this.clock(),duration:fade,from:this.playback?{...this.playback,layers:[...this.layers]}:{frames:copy(this.raw??this.frames)}};else this.transition=null;
  const c=copy(cue);if(this.playback&&this.playback.cue.id!==cue.id)this.layers.push(this.playback);this.layers=this.layers.filter(l=>l.cue.id!==cue.id);
  this.playback={cue:c,started:this.clock(),offset:0,paused:false,rate:this.rateFor(c),controls:this.controls(c)};if(keep)this.layers=this.layers.slice(-7);else this.pruneLayers();this.held=null;this.fading=null;
 }
 // Preview playback: same renderer as live, master applied, no overrides or blackout, never encoded.
 // Blind adds its own programmer buffer on top: over the preview cue, or over the live look when nothing is previewed.
 renderPreview(now){
  const p=this.preview;let states;
  if(p){const cue=p.cue,raw=now-p.started,t=cue.loop||!cue.hold?raw%cue.duration:Math.min(raw,cue.duration-1e-6);
   states=compose(this.show,cue,t);if(p.from){const k=Math.min(1,raw/Math.max(.001,p.fade));states=blend(p.from,states,k);if(k>=1)p.from=null}}
  else states=copy(this.programmed??this.raw??compose(this.show,null,0));
  if(this.blind){states=applyOverrides(this.show,states,this.blindOverrides);const r=this.blindRelease;if(r){const k=Math.min(1,(now-r.start)/Math.max(.001,r.duration));states=states.map(s=>r.frames[s.id]?blendState(r.frames[s.id],s,k):s);if(k>=1)this.blindRelease=null}this.blindStates=states}
  if(this.fxPreview)states=this.applyFx(states,[this.fxPreview],now);
  return this.limited(finish(this.show,states,this.master,false));
 }
 previewStatus(){const p=this.preview;if(!p)return null;const raw=this.clock()-p.started;return {id:p.cue.id,name:p.cue.name,saved:p.saved,page:p.page??null,entry:p.entry??null,duration:p.cue.duration,loop:p.cue.loop,elapsed:p.cue.loop||!p.cue.hold?raw%p.cue.duration:Math.min(raw,p.cue.duration),fade:p.fade,fading:!!p.from}}
 // Read-only patch sheet: what is patched where, how it is routed, and the bytes being built for it now.
 patchReport(){
  const s=this.show,out=this.output.status(),packets=encode(s,this.frames,{physical:true});
  const fixtures=s.fixtures.map(f=>{
   const def=PROFILE_DEFS[f.profile]??{},channels=def.channels??0,artnet=s.settings.mappings[f.universe],patched=f.universe>0&&f.address>0&&channels>0;
   const state=!f.enabled?'disabled':!f.verified||f.profile==='unknown'?'unverified':artnet===undefined?'unrouted':out.armed?'output':'ready';
   const buf=artnet===undefined?null:packets.get(artnet);
   return {id:f.id,name:f.name,profile:f.profile,profileName:def.name??f.profile,channels,universe:f.universe,address:f.address,end:patched?f.address+channels-1:null,artnet:artnet??null,enabled:f.enabled,verified:f.verified,state,
    groups:s.groups.filter(g=>g.fixtures.includes(f.id)).map(g=>g.id),intensity:this.frames.find(x=>x.id===f.id)?.intensity??0,dmx:buf&&patched&&f.enabled?[...buf.subarray(f.address-1,f.address-1+channels)]:null};
  });
  const hogs=[...new Set([...fixtures.filter(f=>f.universe>0).map(f=>f.universe),...Object.keys(s.settings.mappings).map(Number)])].sort((a,b)=>a-b);
  const universes=hogs.map(u=>{const list=fixtures.filter(f=>f.universe===u&&f.end);return {hog:u,artnet:s.settings.mappings[u]??null,fixtures:list.length,enabled:list.filter(f=>f.enabled).length,channelsUsed:list.filter(f=>f.enabled).reduce((n,f)=>n+f.channels,0),ranges:list.map(f=>({id:f.id,profile:f.profile,from:f.address,to:f.end,enabled:f.enabled}))}});
  const issues=[...fixtures.filter(f=>f.state==='unrouted').map(f=>`${f.id}: Hog universe ${f.universe} has no Art-Net route — set one in Connection & diagnostics`),
   ...universes.filter(u=>u.artnet!==null&&!u.enabled).map(u=>`Hog universe ${u.hog} is routed to Art-Net ${u.artnet} but has no enabled fixtures`)];
  return {network:{source:s.settings.source,target:s.settings.target,port:6454,armed:out.armed,packets:out.packets,lastSent:out.lastSent,lastError:out.lastError,receiver:out.receiver},universes,fixtures,issues,
   note:'dmx = bytes the engine builds for each fixture this frame (lamp pulses excluded). They are sent only while output is armed; ArtDMX has no acknowledgment, so a send is not proof the fixture responded.'};
 }
 activePage(){return this.stack&&this.show.pages.find(p=>p.id===this.stack.page)}
 stackIndex(page){const i=page.cues.findIndex(e=>e.id===this.stack.entry);return i>=0?i:this.stack.index}
 goEntry(page,index,fade){
  const entry=page.cues[index],cue=this.show.cues.find(c=>c.id===entry.cue);if(!cue)throw Error('Unknown cue '+entry.cue);
  this.startCue(cue,{fade:fade??entry.fade});this.playback.page=page.id;this.playback.entry=entry.id;this.stack={page:page.id,entry:entry.id,index};
  this.fireSends(page,entry,index,cue,fade??entry.fade);this.live.schedule(()=>this.liveSnapshot());
 }
 // Every GO (UI, MCP, OSC, auto-follow) tells announce targets and runs the entry's sends. Never blocks: the server's sendHook is async.
 // Preset sends go before the look; a target gets one look per GO (explicit look send, or its look mode cue/change).
 fireSends(page,entry,index,cue,fade=entry.fade){
  for(const x of entry.send??[])if(x.message==='midi'){if(this.mods?.midi)this.mods.midi.note(x,true,200);else this.log('MIDI send skipped: the MIDI module is off')}
  const targets=this.show.targets.filter(t=>t.enabled!==false);if(!targets.length)return;
  const info=this.cueInfo(page,entry,index,cue),sends=(entry.send??[]).filter(x=>x.message!=='midi').map(x=>({x,t:targets.find(t=>t.id===x.target)})).filter(s=>s.t),looked=new Set();
  for(const t of targets.filter(t=>t.announce))this.emitCue(t,info,'announce');
  for(const {x,t} of sends.filter(s=>s.x.message==='preset'))this.emitPreset(t,x,info);
  for(const {x,t} of sends){
   if(x.message==='look'){if(!looked.has(t.id)){looked.add(t.id);this.cueLook(t,cue,info,fade)}}
   else if(x.message==='cue')this.emitCue(t,info,'cue');
   else if(x.message==='osc'){const m=this.envelope(t,'message');this.emit(t,t.kind==='osc'?{osc:{address:x.address,args:x.args??[]}}:{http:{...m,...info,address:x.address,args:x.args??[]}},'osc',m)}}
  for(const t of targets)if(!looked.has(t.id)&&['cue','change'].includes(t.look?.mode))this.cueLook(t,cue,info,fade);
 }
 cueInfo(page,entry,index,cue){return {page:{id:page.id,name:page.name},cue:{entry:entry.id,id:cue.id,name:entry.label??cue.name,number:index+1}}}
 emitCue(t,info,label){const m=this.envelope(t,'cue');this.emit(t,t.kind==='osc'?{osc:{address:'/stagelight/cue/live',args:[info.page.id,info.page.name,info.cue.number,info.cue.name,info.cue.entry]}}:{http:{...m,...info}},label,m)}
 emitPreset(t,x,info){const m={...this.envelope(t,'preset'),preset:x.preset,...(x.fade===undefined?{}:{fade:x.fade}),page:info?.page??null,cue:info?.cue??null};
  this.emit(t,t.kind==='osc'?{osc:[['/stagelight/preset',[x.preset,{t:'f',v:x.fade??-1},{t:'i',v:m.seq}]]]}:{http:m},'preset',m)}
 // label is what the log shows; msg (an enveloped message) lets replies and /stagelight/feedback find the row by id or seq.
 emit(target,packet,label,msg){
  const list=Array.isArray(packet.osc)?packet.osc:null,summary=list?(list.length>1?`${list[1][0]}/* · ${list.length} messages`:list[0][0]+' '+list[0][1].map(a=>a&&typeof a==='object'?a.v:a).join(' ')):packet.osc?packet.osc.address+' '+packet.osc.args.map(a=>a&&typeof a==='object'?a.v:a).join(' '):[packet.http.type,packet.http.reason,packet.http.preset].filter(Boolean).join(' · ');
  const row={at:new Date().toISOString(),target:target.name,targetId:target.id,kind:target.kind,label,summary,...(msg?{id:msg.id,seq:msg.seq}:{})};this.net.count.out++;
  if(!this.sendHook){row.result='no network transport';this.netOut(row);return}
  const t0=performance.now();setImmediate(()=>this.sendHook(target,packet).then(reply=>{row.result='sent';row.ms=+(performance.now()-t0).toFixed(2);this.takeReply(target,row,reply)},e=>{row.result='failed: '+e.message}).finally(()=>this.netOut(row)))}
 // An HTTP target may answer {ok, status, summary, presets}: the summary is shown with the send; presets fill the pickers.
 takeReply(target,row,reply){
  if(!reply||typeof reply!=='object'||Array.isArray(reply))return;const r={};
  if(typeof reply.ok==='boolean')r.ok=reply.ok;if(REPLY_STATUS.includes(reply.status))r.status=reply.status;if(typeof reply.summary==='string'&&reply.summary.trim())r.summary=text(reply.summary,200);
  if(Object.keys(r).length)row.reply=r;if(Array.isArray(reply.presets))this.storePresets(target,reply.presets,'http');
 }
 netOut(row){this.net.out.unshift(row);this.net.out.length=Math.min(this.net.out.length,40)}
 netIn(row){this.net.count.in++;if(!row.ok)this.net.count.rejected++;this.net.in.unshift(row);this.net.in.length=Math.min(this.net.in.length,40)}
 // ── Look Link (protocol stagelight.look/1, docs/LOOK-LINK.md) ──
 lookState(key){let st=this.looks.get(key);if(!st){st={seq:0,at:this.clock(),sent:null,prev:null,changedAt:-Infinity,pending:false,settle:null};this.looks.set(key,st)}return st}
 // Every JSON message to a target carries this; consume:false peeks (look.report).
 envelope(t,type,{test=false,consume=true}={}){
  const st=this.lookState(t?.id??''),seq=Math.max(st.seq+1,Math.floor((Date.now()-SEQ_EPOCH)/100));if(consume)st.seq=seq;
  return {protocol:LOOK_PROTOCOL,app:'StageLight',version:VERSION,type,id:'msg_'+crypto.randomUUID().replaceAll('-','').slice(0,8),seq,at:new Date().toISOString(),target:t?.id??null,test};
 }
 targetById(ref){const t=this.show.targets.find(t=>t.id===ref);if(!t)throw Error('Unknown target '+ref);return t}
 // A target's zones in its order (none chosen = every zone, in show order).
 targetZones(t,ids){const all=this.show.zones??[],pick=ids??t?.look?.zones;if(!pick?.length)return all;return pick.map(id=>{const z=all.find(z=>z.id===id);if(!z)throw Error('Unknown zone '+id);return z})}
 // A cue's end state as GO will leave it: the cue (sampled like the 0.3.0 summary) under the current manual changes, master and blackout.
 cueEndStates(cue){return finish(this.show,applyOverrides(this.show,compose(this.show,cue,Math.min(cue.duration*.5,2)),this.overrides),this.master,this.blackout)}
 // Zones and overall figures from a cue's end state or the live frames (what the stage shows now). Overall covers the zones sent, or every fixture without zones.
 lookData(t,{cue=null,zones,members}={}){
  const states=cue?this.cueEndStates(cue):this.frames,list=this.targetZones(t,zones),m=members??!!t?.look?.members;
  const ids=list.length?[...new Set(list.flatMap(z=>zoneFixtures(this.show,z)))]:this.show.fixtures.map(f=>f.id);
  return {states,overall:measure(this.show,states,ids)??{level:0,lit:0,fixtures:0,color:'#000000',kelvin:null,saturation:0},zones:list.map(z=>({id:z.id,name:z.name,role:z.role,...measure(this.show,states,zoneFixtures(this.show,z),{chroma:true,members:m})}))};
 }
 timing(fade,startedMs=Date.now()){return {fade:+(+fade).toFixed(3),startedAt:iso(startedMs),settlesAt:iso(startedMs+fade*1000)}}
 liveTiming(){const f=this.transition??this.fading;if(!f)return this.timing(0);return this.timing(f.duration,Date.now()-(this.clock()-f.start)*1000)}
 liveInfo(){const page=this.activePage();if(page&&this.playback){const i=this.stackIndex(page),e=page.cues[i],c=e&&this.show.cues.find(x=>x.id===e.cue);if(c)return this.cueInfo(page,e,i,c)}const p=this.playback?.cue;return p?{page:null,cue:{entry:null,id:p.id,name:p.name,number:null}}:null}
 lookMessage(t,data,{reason,info=null,timing,test=false,requestId,consume=true}){
  const settles=Date.parse(timing.settlesAt)>Date.now();
  return {...this.envelope(t,'look',{test,consume}),reason,...(requestId?{requestId}:{}),page:info?.page??null,cue:info?.cue??null,timing,state:reason!=='settled'&&timing.fade>0&&settles?'fading':'settled',
   output:{armed:this.output.armed,blackout:this.blackout,master:this.master},...data.overall,zones:data.zones,groups:this.show.groups.map(g=>({id:g.id,name:g.name,...measure(this.show,data.states,g.fixtures)})).filter(g=>g.lit)};
 }
 // The OSC burst for a look (§3.6): begin, the 0.3.0 /stagelight/look, one /look/zone per zone, end.
 lookOSC(m){const f=v=>({t:'f',v}),i=v=>({t:'i',v}),pageName=m.test?'test':m.page?.name??'',cueName=m.cue?.name??'';
  return [['/stagelight/look/begin',[i(m.seq),m.reason,pageName,cueName,f(m.timing.fade),i(m.zones.length),i(m.output.armed?1:0)]],
   ['/stagelight/look',[pageName,cueName,i(m.kelvin??0),f(m.level),m.color,f(m.saturation)]],
   ...m.zones.map(z=>['/stagelight/look/zone',[i(m.seq),z.id,z.role,z.name,i(z.kelvin??0),f(z.duv??0),f(z.level),z.color,f(z.saturation),i(z.white?1:0),i(z.lit),i(z.fixtures),i(z.colorUnknown)]]),
   ['/stagelight/look/end',[i(m.seq)]]]}
 sendLook(t,msg,label){this.emit(t,t.kind==='osc'?{osc:this.lookOSC(msg)}:{http:msg},label,msg);const st=this.lookState(t.id);st.at=this.clock();st.sent=lookSnap(msg);st.prev??=st.sent}
 cueLook(t,cue,info,fade){
  this.sendLook(t,this.lookMessage(t,this.lookData(t,{cue}),{reason:'cue',info,timing:this.timing(fade)}),'look');
  const st=this.lookState(t.id);st.pending=false;st.settle=t.look?.mode==='change'&&fade>0?{until:this.clock()+fade,cue,info,fade,startedMs:Date.now(),playback:this.playback,master:this.master,blackout:this.blackout}:null;
 }
 liveLook(t,reason,extra={}){return this.lookMessage(t,this.lookData(t),{reason,info:this.liveInfo(),timing:this.liveTiming(),...extra})}
 // Change mode and heartbeats, checked from the engine tick (at most every 50 ms). A GO's fade is announced once; while it runs,
 // changes are not re-sent unless playback, master or blackout change; when it ends a settled look follows.
 watchLooks(){
  const now=this.clock();if(now-(this.lastWatch??-Infinity)<.04)return;this.lastWatch=now;
  for(const t of this.show.targets){const mode=t.look?.mode??'off',hb=t.look?.heartbeat??0;if(t.enabled===false||mode==='off')continue;
   try{const st=this.lookState(t.id);
    if(st.settle){const s=st.settle;
     if(s.playback!==this.playback||s.master!==this.master||s.blackout!==this.blackout)st.settle=null;
     else if(now>=s.until){st.settle=null;this.sendLook(t,this.lookMessage(t,this.lookData(t,{cue:s.cue}),{reason:'settled',info:s.info,timing:this.timing(s.fade,s.startedMs)}),'settled');st.prev=st.sent;st.changedAt=now;continue}
     else continue}
    if(mode==='change'){const cur=lookSnap(this.lookData(t));
     if(!st.sent){st.sent=st.prev=cur;continue}
     if(lookDiffers(cur,st.prev,STILL))st.changedAt=now;st.prev=cur;
     const big=lookDiffers(cur,st.sent,CHANGE),quiet=now-st.changedAt>=.25,free=now-st.at>=.25;
     if(big&&free){this.sendLook(t,this.liveLook(t,'change'),'change');st.pending=true;continue}
     if(big)st.pending=true;
     if(st.pending&&quiet&&free){st.pending=false;if(lookDiffers(cur,st.sent,STILL)){this.sendLook(t,this.liveLook(t,'change'),'change');continue}}}
    if(hb>0&&now-st.at>=hb)this.sendLook(t,this.liveLook(t,'heartbeat'),'heartbeat');
   }catch(e){if(this.lookError!==e.message){this.lookError=e.message;this.log('Look Link: '+e.message)}}}
 }
 // 0.3.0 compatibility: the look summary of a cue's end state, plus its zones.
 lookSummary(cue){const d=this.lookData(null,{cue});return {...d.overall,zones:d.zones,groups:this.show.groups.map(g=>({id:g.id,name:g.name,...measure(this.show,d.states,g.fixtures)})).filter(g=>g.lit)}}
 /** look.report: exactly what a target would be sent, without sending or using a sequence number. */
 lookReport(args){
  const t=args.target?this.targetById(args.target):null;let cue=null,info=null,fade=0;
  if(args.page!==undefined||args.entry!==undefined){const page=this.show.pages.find(p=>p.id===args.page),i=page?.cues.findIndex(e=>e.id===args.entry)??-1;if(i<0)throw Error('Give a page and one of its cue list entries');const e=page.cues[i];cue=this.show.cues.find(c=>c.id===e.cue);info=this.cueInfo(page,e,i,cue);fade=e.fade}
  else if(args.cue){cue=this.show.cues.find(c=>c.id===args.cue);if(!cue)throw Error('Unknown cue '+args.cue);info={page:null,cue:{entry:null,id:cue.id,name:cue.name,number:null}}}
  const msg=this.lookMessage(t,this.lookData(t,{cue,zones:args.zones,members:args.members}),{reason:cue?'cue':'request',info:cue?info:this.liveInfo(),timing:cue?this.timing(fade):this.liveTiming(),consume:false});
  return {target:t?.id??null,kind:t?.kind??null,mode:t?.look?.mode??'off',message:msg,osc:this.lookOSC(msg).map(([address,args])=>({address,types:','+args.map(a=>a&&typeof a==='object'?a.t:'s').join(''),args:args.map(a=>a&&typeof a==='object'?a.v:a)})),
   note:'Nominal colour from what each fixture is told to output and can make; not metered. seq and id are previews: a real send uses the next sequence number.'};
 }
 /** /stagelight/look/get without a target: the OSC burst for every zone, for the sender. */
 lookReply(requestId){return this.lookOSC(this.liveLook(null,'request',requestId?{requestId}:{}))}
 // ── Preset lists published by target apps (kept in memory for the pickers) ──
 storePresets(t,list,via){
  const presets=list.filter(p=>p&&typeof p.id==='string'&&p.id.trim()).slice(0,200).map(p=>({id:text(p.id,100),name:text(p.name,100)||text(p.id,100),...(typeof p.description==='string'&&p.description?{description:text(p.description,300)}:{})}));
  this.net.presets[t.id]={at:new Date().toISOString(),via,presets};return presets.length;
 }
 askPresets(t){this.presetAsks.set(t.id,this.clock());const m=this.envelope(t,'presets.request');
  this.emit(t,t.kind==='osc'?{osc:{address:'/stagelight/presets/request',args:[{t:'i',v:this.net.listener.port??this.show.settings.osc?.port??1461}]}}:{http:m},'presets',m)}
 // OSC /stagelight/presets/begin|item|end from an app, filed under the target it belongs to (explicit id, else host, port, then who was asked last).
 receivePresets(p,from){
  const key=from.address+':'+from.port;let b=this.presetBursts.get(key);
  if(p.phase==='begin'){this.presetBursts.set(key,{target:p.target,items:[]});return `presets begin · ${p.count??'?'} expected`}
  if(!b){b={items:[]};this.presetBursts.set(key,b)}
  if(p.phase==='item'){if(b.items.length<200)b.items.push(p.item);return 'preset '+p.item.id}
  this.presetBursts.delete(key);let t;
  if(b.target){const r=b.target.toLowerCase();t=this.show.targets.find(t=>t.id.toLowerCase()===r||t.name.toLowerCase()===r);if(!t)throw Error('Unknown target '+b.target)}
  else{const hosts=this.show.targets.filter(t=>sameHost(targetHost(t),from.address)),byPort=hosts.filter(t=>t.kind==='osc'&&t.port===from.port),asked=hosts.filter(t=>this.clock()-(this.presetAsks.get(t.id)??-Infinity)<30).sort((a,b)=>this.presetAsks.get(b.id)-this.presetAsks.get(a.id));
   t=hosts.length===1?hosts[0]:byPort.length===1?byPort[0]:asked[0];
   if(!t)throw Error(hosts.length?`Several targets use ${from.address}; send the target id as /stagelight/presets/begin i:count s:targetId`:`No target has host ${from.address}`)}
  return `presets · ${this.storePresets(t,b.items,'osc')} for ${t.name}`;
 }
 // /stagelight/feedback: an app's decision about one of our messages, matched by message id (or seq for OSC targets).
 feedback({id,status,summary},from){
  const host=r=>{const t=this.show.targets.find(t=>t.id===r.targetId);return t&&sameHost(targetHost(t),from)};
  const row=this.net.out.find(r=>r.id===id)??this.net.out.find(r=>String(r.seq)===id&&host(r))??this.net.out.find(r=>String(r.seq)===id);
  if(row)row.feedback={status,summary,at:new Date().toISOString()};this.log(`Feedback ${status}${row?' · '+row.target:''}${summary?' · '+summary:''}`);
  return `feedback · ${status}${row?' · '+row.target+' '+row.label:' · message not in the recent log'}`;
 }
 visualizerStatus(){const v=this.show.visualizer??{hiddenGroups:[],hiddenFixtures:[]},hidden=hiddenFixtureIds(this.show);return {hiddenGroups:v.hiddenGroups,hiddenFixtures:v.hiddenFixtures,hidden:[...hidden],drawn:this.show.fixtures.length-hidden.size,total:this.show.fixtures.length}}
 networkStatus(){const o=this.show.settings.osc??{bind:'loopback',allow:[]};return {listener:{...o,...this.net.listener},addresses:OSC_ADDRESSES.map(([address,args,does])=>({address,args,does})),triggers:this.show.triggers,targets:this.show.targets,zones:this.show.zones.map(z=>({...z,members:zoneFixtures(this.show,z).filter(id=>this.show.fixtures.find(f=>f.id===id)?.enabled)})),presets:this.net.presets,looks:Object.fromEntries(this.show.targets.map(t=>{const st=this.looks.get(t.id);return [t.id,{mode:t.look?.mode??'off',seq:st?.seq??0,settling:!!st?.settle,lastSentAgo:st?+(this.clock()-st.at).toFixed(2):null}]})),count:this.net.count,inbound:this.net.in,outbound:this.net.out}}
 // Auto-follow: an entry marked follow:auto fires the next entry after its wait.
 follow(){
  const page=this.activePage();if(!page)return;
  const i=this.stackIndex(page),entry=page.cues[i];if(!entry||entry.follow!=='auto'||i+1>=page.cues.length)return;
  // Time the entry's own running cue: a master cue may be on top of it.
  const run=this.running().find(l=>l.page===page.id&&l.entry===entry.id);if(!run||run.paused)return;
  const late=this.sourceTime(run,true)-(entry.wait??run.cue.duration);if(late<0)return;
  this.goEntry(page,i+1);this.log(`Auto-follow · ${page.name} → ${page.cues[i+1].label??page.cues[i+1].cue}`);
  // The next entry starts when the wait ran out, not on the tick that noticed, so a chain of auto entries stays on the
  // show clock (beat-locked to a song) instead of each adding up to a frame of lag. Longer stalls are not caught up.
  if(late<.5){this.playback.started-=late/(this.playback.rate??1);if(this.transition)this.transition.start-=late/(run.rate??1)}
 }
 stackStatus(){
  const page=this.activePage();if(!page)return null;const i=this.stackIndex(page),entry=page.cues[i],next=page.cues[i+1];
  const wait=entry&&this.playback?entry.wait??this.playback.cue.duration:null;
  return {page:page.id,pageName:page.name,entry:entry?.id??null,index:i,count:page.cues.length,next:next?{entry:next.id,cue:next.cue}:null,follow:entry?.follow==='auto'&&next&&wait!==null?{wait,remaining:Math.max(0,wait-this.elapsed())}:null};
 }
 addMedia(file,name,{move=false}={}){
  if(!this.dir)throw Error('Media needs a data folder');
  const ext=path.extname(file).toLowerCase(),kind=MEDIA_TYPES[ext];if(!kind)throw Error('Unsupported media type '+(ext||'(none)'));
  if(!path.isAbsolute(file))throw Error('Use an absolute file path');
  const stat=fs.statSync(file);if(!stat.isFile())throw Error('Not a file');if(stat.size>500e6)throw Error('Media file exceeds 500 MB');
  const id=shortId('media'),dir=path.join(this.dir,'media'),target=path.join(dir,id+ext);fs.mkdirSync(dir,{recursive:true});
  if(move)fs.renameSync(file,target);else fs.copyFileSync(file,target);
  try{this.update(s=>s.media.push({id,name,kind,src:'/media/'+id+ext}))}catch(e){fs.rmSync(target,{force:true});throw e}
  return id;
 }
 // Agents count as connected while their MCP server keeps saying hello (every 10 s).
 connectedAgents(){const now=this.clock();for(const [k,a] of this.agents)if(now-a.lastSeen>30)this.agents.delete(k);return [...this.agents.values()].map(a=>({client:a.client,version:a.version,connectedFor:Math.round(now-a.connectedAt)}))}
 runtime(){return {agents:this.connectedAgents(),assistant:this.assistant.live(),showFile:this.showFileStatus(),selection:copy(this.selection),lampCommands:Object.fromEntries([...this.lampCommands].map(([id,p])=>[id,{action:p.action,remaining:Math.max(0,p.until-this.clock())}])),revision:this.revision,running:this.runningStatus(),highlight:this.highlight,find:this.findStatus(),parked:(this.show.parked??[]).map(p=>p.id),kills:this.killStatus(),tempo:this.tempoStatus(),programmerUndo:{available:this.undo.filter(u=>u.blind===this.blind).length},showUndo:this.undoShow?.revision===this.revision?{label:this.undoShow.label}:null,effectErrors:effectErrors(),engineError:this.engineError&&Date.now()-Date.parse(this.engineError.at)<30000?this.engineError:null,locked:this.locked,resume:this.resumeStatus(),health:this.health(),...(this.desk?{desk:this.desk}:{}),...(this.mods?.live()??{}),scene:this.scene?{id:this.scene.id,name:this.scene.name}:null,masters:this.mastersStatus(),playback:this.playback?{id:this.playback.cue.id,name:this.playback.cue.name,duration:this.playback.cue.duration,loop:this.playback.cue.loop,hold:!!this.playback.cue.hold,paused:this.playback.paused,elapsed:Math.min(this.elapsed()% (this.playback.cue.loop?this.playback.cue.duration:Infinity),this.playback.cue.duration)}:null,stack:this.stackStatus(),net:{in:this.net.count.in,out:this.net.count.out,rejected:this.net.count.rejected,listening:!!this.net.listener.listening,last:this.net.in[0]?.address??null},preview:this.previewStatus(),fx:this.fx.map(x=>this.fxSummary(x)),fxPreview:this.fxSummary(this.fxPreview),blind:{enabled:this.blind,fixtures:Object.keys(this.blindOverrides),overrides:this.blindOverrides,release:this.blindRelease?{fixtures:Object.keys(this.blindRelease.frames),progress:Math.min(1,(this.clock()-this.blindRelease.start)/Math.max(.001,this.blindRelease.duration))}:null},previewFrames:this.previewFrames,transition:this.transition?{from:this.transition.from.cue?.id??null,duration:this.transition.duration,progress:Math.min(1,(this.clock()-this.transition.start)/Math.max(.001,this.transition.duration))}:null,release:this.release?{fixtures:Object.keys(this.release.frames),progress:Math.min(1,(this.clock()-this.release.start)/Math.max(.001,this.release.duration))}:null,master:this.master,blackout:this.blackout,overrides:this.overrides,frames:this.frames,output:this.output.status(),tickCount:this.tickCount,at:this.tickAt??null,...(this.wallSource?{wall:this.wallSource}:{}),slowFrames:this.dropped,logs:this.logs.slice(-15)}}
 // Strobe flashes are drawn by the 30 Hz tick: a flash or a gap shorter than two frames lands unevenly and looks blurred
 // (2026-11-01). Keep at most 5 Hz at 50% duty. Faster settings are flagged in the pre-show check and runtime.health,
 // never changed; rate includes the live tempo and the cue's own speed.
 strobeIssues(cue,rate=this.rateFor(cue)){const out=[];for(const tr of cue.tracks??[])if(tr.effect==='strobe'){const f=(tr.params.frequency??3)*rate,d=tr.params.duty??.4,min=Math.min(d,1-d)/f;
  if(min<2/30-1e-9)out.push(`${cue.name}: strobe at ${+f.toFixed(1)} Hz and ${Math.round(d*100)}% duty flashes for ${Math.round(min*1000)} ms, under two 30 Hz frames, so it looks uneven. Keep it at 5 Hz or less at 50% duty.`)}return out}
 // What is wrong right now, worst first, for the desk's banner and agents (runtime.health): [{id, level error|warn, message}].
 // Empty when all is well. Cheap enough for the 10 Hz stream: flags only, no scans of the show.
 health(){const out=[],o=this.output.status?.()??{};
  if(o.armed&&o.failing)out.push({id:'output',level:'error',message:`Art-Net is not getting out: ${o.lastError??'unknown error'}. Output stays armed and keeps retrying: check the lighting network adapter.`});
  if(this.engineError&&this.tickFails)out.push({id:'engine',level:'error',message:`Engine frames are failing since ${this.engineError.at}: ${this.engineError.message}. The rig holds its last look; Stop or release the newest cue.`});
  for(const r of this.running())for(const m of this.strobeIssues(r.cue,r.rate??1))out.push({id:'strobe',level:'warn',message:m});
  out.push(...(this.mods?.health()??[]));return out.sort((a,b)=>(a.level==='error'?0:1)-(b.level==='error'?0:1))}
 snapshot(){return {show:copy(this.show),runtime:this.runtime()}}
 // status {only, ids}: one part of the show or runtime at a time, so an agent never has to take the whole show to read a cue.
 status({only,ids}={}){
  if(!only&&!ids)return this.snapshot();const want=new Set(only??['fixtures','frames']),pick=ids&&new Set(ids),some=list=>pick&&Array.isArray(list)&&list.every(x=>x&&typeof x==='object'&&'id' in x)?list.filter(x=>pick.has(x.id)):list,out={},show={};
  for(const k of want){if(k==='runtime'){const {frames,previewFrames,...rest}=this.runtime();out.runtime=rest}else if(k==='frames')out.frames=some(this.frames);else if(this.show[k]!==undefined)show[k]=copy(some(this.show[k]))}
  return {...(Object.keys(show).length?{show}:{}),...out};
 }
 // overview: the show at a glance for an agent. IDs and counts, never per-fixture values.
 overview(){
  const s=this.show,index=fixtureIndex(s),r=this.runtime(),profiles=new Map();for(const f of s.fixtures){const p=profiles.get(f.profile)??{profile:f.profile,name:PROFILE_DEFS[f.profile]?.name??f.profile,moving:!!PROFILE_DEFS[f.profile]?.moving,attributes:PROFILE_DEFS[f.profile]?.attributes??[],ids:[]};p.ids.push(f.id);profiles.set(f.profile,p)}
  const count=list=>Object.entries(list.reduce((m,x)=>{m[x]=(m[x]??0)+1;return m},{})).map(([k,n])=>n>1?`${k} ×${n}`:k);
  const cue=c=>({id:c.id,name:c.name,duration:c.duration,...(c.loop?{loop:true}:{}),...(c.hold?{hold:true}:{}),...(c.bpm?{bpm:c.bpm}:{}),...(c.only?{only:c.only}:{}),...(c.look?.length?{look:c.look.length}:{}),...(c.tracks.length?{effects:count(c.tracks.map(t=>t.effect)),on:[...new Set(c.tracks.map(t=>t.group??`${t.fixtures.length} fixtures`))].slice(0,12)}:{})});
  const lit=this.frames.filter(f=>f.intensity>.01).length,out=this.output.status();
  return {show:{name:s.name??null,revision:this.revision,file:this.showFileStatus()},
   live:{output:{armed:out.armed,failing:!!out.failing,target:s.settings.target},locked:this.locked,blackout:this.blackout,master:this.master,tempo:this.tempo.bpm,lit,scene:r.scene,running:r.running,stack:r.stack&&{page:r.stack.page,entry:r.stack.entry,index:r.stack.index,next:r.stack.next},selection:{group:this.selection.group,ids:this.selection.ids.length>40?`${this.selection.ids.length} fixtures`:this.selection.ids},programmer:{fixtures:Object.keys(this.overrides),effects:this.fx.map(x=>({id:x.id,name:x.name,effect:x.effect,layer:x.layer,fixtures:x.fixtures.length}))},blind:this.blind,highlight:this.highlight,parked:r.parked,kills:r.kills,effectErrors:r.effectErrors,engineError:r.engineError},
   fixtures:{total:s.fixtures.length,enabled:s.fixtures.filter(f=>f.enabled).length,unverified:s.fixtures.filter(f=>f.enabled&&!f.verified).map(f=>f.id),types:[...profiles.values()]},
   groups:s.groups.map(g=>({id:g.id,name:g.name,...(g.children?.length?{children:g.children,count:g.fixtures.length}:g.fixtures.length>16?{count:g.fixtures.length,first:g.fixtures[0],last:g.fixtures.at(-1)}:{fixtures:g.fixtures}),types:[...new Set(g.fixtures.map(id=>index.get(id)?.profile))]})),
   cues:s.cues.map(cue),pages:s.pages.map(p=>({id:p.id,name:p.name,cues:p.cues.map(e=>({entry:e.id,cue:e.cue,...(e.label?{label:e.label}:{}),fade:e.fade,...(e.follow==='auto'?{follow:'auto',...(e.wait!==undefined?{wait:e.wait}:{})}:{})}))})),
   scenes:s.scenes.map(x=>({id:x.id,name:x.name,fixtures:x.look.length})),
   masters:s.masters.slots.map((m,i)=>({slot:m.id,number:i+1,m})).filter(x=>x.m.cue).map(({slot,number,m})=>({slot,number,...(m.key?{key:m.key}:{}),cue:m.cue,action:m.action,...(m.label?{label:m.label}:{}),...(m.priority?{priority:true}:{}),...(m.sound?{sound:{mode:m.sound.mode??'hit',on:m.sound.enabled!==false}}:{}),...(this.levels.has(m.id)?{level:this.levels.get(m.id)}:{})})),
   effects:{builtIn:Object.keys(EFFECT_PRESETS),custom:s.presets.map(p=>({id:p.id,name:p.name,effect:p.effect,layer:p.layer??EFFECTS[p.effect].layer,...(p.effect==='code'?{args:p.params.args??{}}:{})}))},
   palettes:s.palettes.map(p=>({id:p.id,name:p.name,color:p.color})),positions:s.points.map(p=>({id:p.id,name:p.name,fixtures:Object.keys(p.positions).length})),beamPresets:(s.beamPresets??[]).map(p=>({id:p.id,name:p.name,for:p.profiles})),
   next:'status {only:[part], ids?} reads one part in full (cues, groups, fixtures, frames, runtime...). schema {only:["effects","presets","code"]} lists effects and how to write a code effect. Build looks with fixture.set / palette.apply / fx.apply and save them with cue.record; check before going live with preview.cue or blind.set.'};
 }
 // A compact read of the whole show for planning (agents and the built-in assistant): far smaller than status.
 showSummary(){
  const s=this.show,idx=fixtureIndex(s),on=s.fixtures.filter(f=>f.enabled),count=list=>list.reduce((m,k)=>(m[k]=(m[k]??0)+1,m),{});
  return {name:s.name,
   fixtures:{total:s.fixtures.length,enabled:on.length,profiles:count(on.map(f=>f.profile)),movingProfiles:MOVING},
   groups:s.groups.map(g=>({id:g.id,name:g.name,count:g.fixtures.length,profiles:[...new Set(g.fixtures.map(id=>idx.get(id)?.profile).filter(Boolean))]})),
   zones:(s.zones??[]).map(z=>({id:z.id,name:z.name,role:z.role,groups:z.groups??[]})),
   palettes:s.palettes.map(p=>({id:p.id,name:p.name,color:p.color})),
   positions:(s.points??[]).map(p=>({id:p.id,name:p.name,fixtures:Object.keys(p.positions??{}).length})),
   effects:Object.fromEntries(Object.entries(EFFECTS).map(([k,v])=>[k,{name:v.name,layer:v.layer??null,description:v.description}])),
   presets:Object.entries(this.allPresets()).map(([id,p])=>({id,name:p.name,effect:p.effect,category:p.category,custom:p.custom})),
   cues:s.cues.map(c=>({id:c.id,name:c.name,duration:c.duration,loop:c.loop,...(c.hold?{hold:true}:{}),...(c.bpm?{bpm:c.bpm}:{}),tracks:c.tracks.length,effects:[...new Set(c.tracks.map(t=>t.effect))],groups:[...new Set(c.tracks.map(t=>t.group).filter(Boolean))],look:c.look?.length??0})),
   pages:s.pages.map(p=>({id:p.id,name:p.name,cues:p.cues.map(e=>({id:e.id,cue:e.cue,...(e.label?{label:e.label}:{}),fade:e.fade,follow:e.follow}))})),
   scenes:(s.scenes??[]).map(x=>({id:x.id,name:x.name,fixtures:x.look.length})),
   masters:{assigned:(s.masters?.slots??[]).map((m,i)=>({n:i+1,id:m.id,key:m.key??null,cue:m.cue??null,action:m.action,label:m.label??null})).filter(m=>m.cue),slots:s.masters?.slots?.length??0},
   live:{armed:!!this.output.armed,master:this.master,blackout:this.blackout,blind:!!this.blind,highlight:this.highlight,locked:this.locked,scene:this.scene?{id:this.scene.id,name:this.scene.name}:null,running:this.runningStatus(),fx:this.fx.map(f=>this.fxSummary(f)),selection:{group:this.selection.group,count:this.selection.ids.length},tempo:this.tempo.bpm,lit:this.frames.filter(f=>f.intensity>.01).length}};
 }
 assistantCommand(name,args){
  const a=this.assistant;
  switch(name){
   case 'assistant.status':return a.status();
   case 'assistant.configure':{
    if(args.instructions!==undefined){if(this.locked)throw Error('The performance lock is on: unlock it to change the show.');this.update(s=>{s.settings.assistant={...s.settings.assistant,instructions:args.instructions}})}
    return a.configure(args);}
   case 'assistant.models':return a.models(args.provider);
   case 'assistant.send':return a.send(args.message);
   case 'assistant.stop':return a.stop();
   case 'assistant.clear':return a.clear();
  }
 }
 showFileStatus(){const c=this.files.current;return {name:c?.name??null,savedAt:c?.at??null,dirty:this.revision!==this.savedRevision,autosave:this.files.autosave,...(this.saveError?{error:this.saveError}:{})}}
 // Autosave (docs/SHOW-FILES.md): the open show file is written while it has unsaved changes, once its edits have been
 // quiet for 10 s and at most every 2 minutes, and when the performance lock goes on. On 2026-11-01 the show file stayed
 // unsaved from 06:35 for the rest of the service. <data>/show.json and the versions are still written on every edit.
 autosaveNow(why='autosave'){const c=this.files.current;if(!c||!this.files.autosave||this.revision===this.savedRevision||!this.files.folder)return false;
  try{const saved=this.files.write(c.name,this.show);this.files.track(saved.name,this.show);this.savedRevision=this.revision;this.lastAutosave=this.clock();this.log(`Show ${why==='lock'?'saved for the show':'autosaved'} · ${saved.name}`);return true}catch(e){if(this.autosaveError!==e.message){this.autosaveError=e.message;this.log('Autosave failed: '+e.message)}return false}}
 autosaveTick(){if(this.revision!==this.editedRevision){this.editedRevision=this.revision;this.editedAt=this.clock();return}if(this.clock()-(this.editedAt??0)>=10&&this.clock()-(this.lastAutosave??-Infinity)>=120)this.autosaveNow()}
 // Opening and importing replace the whole show; this Mac's network settings stay and the old show is kept as a version.
 replaceShow(raw,reason){const next=migrate(copy(raw));next.settings=copy(this.show.settings);validateShow(next);if(this.dir&&reason==='before-import')writeAtomic(path.join(this.dir,'show-before-import-'+Date.now()+'.json'),JSON.stringify(this.show,null,2));this.versions.snapshot(this.show,reason);this.resetLive();this.update(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,next)});this.undoShow=null}
 // The show object is replaced, never changed in place, so the one before an edit is kept by reference for show.undo.
 update(fn){const next=copy(this.show),prev=this.show;fn(next);if(next.groups?.some(g=>g.children))syncGroups(next);validateShow(next);this.show=next;this.revision++;this.undoShow={show:prev,revision:this.revision,label:this.editing??'edit'};this.save();this.versions.edited(this.show)}
 appendEntry(s,pageId,cue,fade=2,after){const page=s.pages.find(p=>p.id===pageId);if(!page)throw Error('Unknown page');const id=shortId('entry'),at=after?page.cues.findIndex(e=>e.id===after):-1;page.cues.splice(at<0?page.cues.length:at+1,0,{id,cue,fade,follow:'manual'});return id}
 // What is seen right now (blind view while blind), with master removed, as look entries. Highlight is never recorded.
 // Cues record only what they light or what was changed (docs/MASTERS-AND-SCENES.md): a fixture at zero that nobody touched
 // stays out, so playing the cue never blacks out the rest of the rig. keep = extra IDs to keep (e.g. the cue's own). Scenes and
 // all:true still record every fixture.
 activeLook(look,keep=[]){const src=this.blind?this.blindOverrides:this.overrides,touched=new Set([...Object.keys(src),...(this.blind?[]:this.fx.flatMap(x=>x.fixtures)),...keep]);return look.filter(e=>e.values.intensity>.001||touched.has(e.id))}
 // withoutFx: fixtures a programmer effect is running on are recorded as they are underneath it, so the effect can be saved
 // as an effect on the cue instead of as one frozen frame of it.
 snapshotLook({withoutFx=false}={}){let seen=this.blind?this.previewFrames:this.highlight&&this.programmed?this.limited(finish(this.show,this.programmed,this.master,this.blackout)):this.frames;
  if(withoutFx&&!this.blind&&this.fx.length&&this.raw){const ids=new Set(this.fx.flatMap(x=>x.fixtures)),under=new Map(finish(this.show,applyOverrides(this.show,this.raw,this.overrides),this.master,this.blackout).map(s=>[s.id,s]));seen=seen.map(f=>ids.has(f.id)&&under.has(f.id)?under.get(f.id):f)}
  return seen.filter(f=>this.show.fixtures.some(x=>x.id===f.id&&x.enabled)).map(({id,...values})=>({id,values:{...values,intensity:this.master>0?Math.min(1,values.intensity/this.master):0,color:'#'+values.color.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}}))}
 // Programmer effects: one per fixture per layer, layered on top of cue + overrides.
 applyFx(states,list,now){
  if(!list.length)return states;const byId=new Map(states.map(s=>[s.id,s])),fixtures=fixtureIndex(this.show);
  for(const fx of list){const t=now-fx.started;if(fx.effect==='code'){codeEffect(this.show,fx.fixtures,fx.params,t,id=>byId.get(id),(id,st)=>byId.set(id,st),{duration:fx.duration,bpm:this.tempo.bpm??120,label:fx.name});continue}fx.fixtures.forEach((id,i)=>{const f=fixtures.get(id),st=byId.get(id);if(f&&st)byId.set(id,layerEffect(st,f,i,fx.fixtures.length,fx.effect,fx.params,t,this.show,fx.layer,1,fx.duration))})}
  return states.map(s=>byId.get(s.id));
 }
 // Built-in presets plus the show's custom ones; custom presets get their category from the effect's layer.
 allPresets(){
  const cat={intensity:'intensity',color:'color',position:'movement'};
  return {...Object.fromEntries(Object.entries(EFFECT_PRESETS).map(([k,v])=>[k,{...v,custom:false}])),...Object.fromEntries(this.show.presets.map(p=>{const layer=p.layer??EFFECTS[p.effect].layer;return [p.id,{duration:20,loop:true,...copy(p),category:cat[layer],movers:layer==='position',custom:true}]}))};
 }
 presetById(id){const p=this.allPresets()[id];if(!p)throw Error('Unknown effect preset '+id);return p}
 resolveFx(args){
  const preset=args.preset?this.presetById(args.preset):null,effect=args.effect??preset?.effect;if(!effect)throw Error('Give a preset or an effect');
  const layer=args.layer??preset?.layer??EFFECTS[effect].layer;if(!layer)throw Error(EFFECTS[effect].name+' cannot be layered on a look');
  this.ensureIds(args.fixtures);let fixtures=[...new Set(args.fixtures)].filter(id=>this.show.fixtures.find(f=>f.id===id).enabled);
  if(layer==='position'){fixtures=fixtures.filter(id=>MOVING.includes(this.show.fixtures.find(f=>f.id===id).profile));if(!fixtures.length)throw Error('Movement effects need moving heads in the selection')}
  if(!fixtures.length)throw Error('Select patched fixtures for this effect');
  const params={...(preset?.params??{}),...copy(args.params??{})};validateEffectParams(effect,params,preset?.name??EFFECTS[effect].name);for(const id of fixtures)validateWheelAttributes(this.show.fixtures.find(f=>f.id===id),params);
  return {fixtures,effect,layer,params,preset:args.preset??null,name:preset?.name??EFFECTS[effect].name,duration:preset?.duration??20};
 }
 // Manual fade: these fixtures blend from what they show now to their new values over fade seconds, each on its own clock.
 fadeFrom(ids,fade){
  const blind=this.blind,key=blind?'blindRelease':'release',cur=this[key],states=blind?this.blindStates:this.programmed??this.frames;
  if(!(fade>0)||!states){if(cur)for(const id of ids){delete cur.frames[id];if(cur.own)delete cur.own[id]}return}
  const want=new Set(ids),now=this.clock(),r=cur??{start:now,duration:0,frames:{}};r.own??={};for(const s of states)if(want.has(s.id)){r.frames[s.id]=copy(s);r.own[s.id]={start:now,duration:fade}}this[key]=r;
 }
 // override.undo: the programmer (or the blind buffer) as it was before each change; a burst of changes is one step.
 pushUndo(){const now=this.clock(),top=this.undo.at(-1);if(top&&top.blind===this.blind&&now-top.at<.4){top.at=now;return}
  this.undo.push({at:now,blind:this.blind,overrides:copy(this.blind?this.blindOverrides:this.overrides),fx:this.blind?null:this.fx.map(x=>({...x}))});if(this.undo.length>30)this.undo.shift()}
 undoProgrammer(fade=.3){
  const same=u=>JSON.stringify(u.overrides)===JSON.stringify(this.blind?this.blindOverrides:this.overrides)&&(u.fx===null||JSON.stringify(u.fx.map(x=>[x.id,x.fixtures]))===JSON.stringify(this.fx.map(x=>[x.id,x.fixtures])));
  let u=null;for(let i=this.undo.length-1;i>=0;i--){const x=this.undo[i];if(x.blind!==this.blind)continue;this.undo.splice(i,1);if(!same(x)){u=x;break}}
  if(!u)throw Error('Nothing to undo in the programmer');
  const buffer=this.blind?this.blindOverrides:this.overrides,ids=[...new Set([...Object.keys(buffer),...Object.keys(u.overrides),...(u.fx?[...this.fx,...u.fx].flatMap(x=>x.fixtures):[])])].filter(id=>fixtureIndex(this.show).has(id));
  this.fadeFrom(ids,fade);if(this.blind)this.blindOverrides=u.overrides;else{this.overrides=u.overrides;this.fx=u.fx;this.fading=null}
  for(const id of Object.keys(this.blind?this.blindOverrides:this.overrides))if(!fixtureIndex(this.show).has(id))delete (this.blind?this.blindOverrides:this.overrides)[id];
 }
 // look.copy: pair targets with sources in order and copy what each target's type has.
 copyLook(args){
  const idsOf=(x,label)=>{if(!!x.group===!!x.ids)throw Error(`look.copy ${label}: give a group or ids`);if(x.ids){this.ensureIds(x.ids);return x.ids}const g=this.show.groups.find(g=>g.id===x.group);if(!g)throw Error('Unknown group '+x.group);return g.fixtures};
  const from=idsOf(args.from,'from'),to=idsOf(args.to,'to'),index=fixtureIndex(this.show),src=new Map(((this.blind?this.blindStates??this.previewFrames:this.programmed)??this.frames).map(s=>[s.id,s]));
  const keys=(args.parts??['intensity','color','beam']).flatMap(p=>ATTRIBUTE_FAMILIES[p]).filter(k=>k!=='colorWheel'&&k!=='colorWheel2'),hex=c=>'#'+c.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''),sets=new Map(),skipped=[];
  to.forEach((id,j)=>{const t=index.get(id),sid=from[j%from.length],s=src.get(sid),sp=index.get(sid)?.profile,def=PROFILE_DEFS[t.profile]??{},has=new Set(def.attributes??[]);if(id===sid||!s||!t.enabled){skipped.push(id);return}
   const values={};for(const k of keys){if(s[k]===undefined)continue;if(k==='opticalMode'?!def.opticalModes:k==='prismRotation'?!has.has('prism'):!has.has(k))continue;if((k==='gobo'||k==='prism'||k==='goboShake'||k==='prismRotation')&&sp!==t.profile)continue;values[k]=k==='color'?hex(s.color):s[k]}
   if(!Object.keys(values).length){skipped.push(id);return}const key=JSON.stringify(values);if(!sets.has(key))sets.set(key,{ids:[],values});sets.get(key).ids.push(id)});
  if(!sets.size)throw Error('Nothing to copy: the target fixtures have none of those attributes');
  return {sets:[...sets.values()],copied:to.length-skipped.length,skipped};
 }
 // effect.test: run a code effect on real fixtures at a few moments and describe what it would do. Touches nothing.
 effectTest(args){
  const p=args.params,g=args.group&&args.group!=='all'?this.show.groups.find(x=>x.id===args.group):null;if(args.group&&args.group!=='all'&&!g)throw Error('Unknown group '+args.group);if(args.fixtures)this.ensureIds(args.fixtures);
  const enabled=new Set(this.show.fixtures.filter(f=>f.enabled).map(f=>f.id)),ids=(args.fixtures??g?.fixtures??(args.group==='all'?[...enabled]:this.selection.ids)).filter(id=>enabled.has(id));
  if(!ids.length)throw Error('Give a group or fixtures to test on (nothing is selected)');
  try{checkCodeEffect(p)}catch(e){return {ok:false,error:e.message,fixtures:ids.length}}
  const index=fixtureIndex(this.show),duration=args.duration??20,times=(args.times??[0,.25,.5,1,2,3.5,5,8]).filter(t=>t<=duration),live=new Map((this.programmed??this.frames).map(s=>[s.id,s]));
  const hex=c=>'#'+c.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''),round=v=>typeof v==='number'?+v.toFixed(3):v,sets=new Set(),frames=[];let everLit=false;
  for(const t of times){const states=new Map(ids.map(id=>[id,args.live?live.get(id)??baseState(index.get(id)):baseState(index.get(id))])),before=new Map(states);
   if(!codeEffect(this.show,ids,p,t,id=>states.get(id),(id,st)=>states.set(id,st),{duration,bpm:this.tempo.bpm??120,label:'effect.test'})){const e=effectErrors().find(x=>x.effect==='effect.test');clearEffectErrors('effect.test');return {ok:false,error:`Code effect: ${e?.line?`Line ${e.line}: `:''}${e?.message??'it failed'} (at t = ${t} s on ${ids.length} fixtures)`,fixtures:ids.length}}
   const list=ids.map(id=>states.get(id)),levels=list.map(s=>s.intensity),lit=levels.filter(v=>v>.01).length;if(lit)everLit=true;
   for(const id of ids){const a=before.get(id),b=states.get(id);for(const k of Object.keys(b))if(JSON.stringify(a[k])!==JSON.stringify(b[k]))sets.add(k)}
   frames.push({t,lit,intensity:{min:round(Math.min(...levels)),max:round(Math.max(...levels))},fixtures:list.slice(0,6).map(s=>({id:s.id,intensity:round(s.intensity),color:hex(s.color),...Object.fromEntries([...sets].filter(k=>!['intensity','color'].includes(k)).map(k=>[k,round(s[k])]))}))})}
  const warnings=[],movers=ids.filter(id=>MOVING.includes(index.get(id).profile)).length;
  if(!everLit)warnings.push(args.live?'Nothing is lit in any sampled frame: the live look on these fixtures is dark and the code does not raise intensity.':'Nothing is lit in any sampled frame. On dark fixtures the code must return intensity (base.intensity is 0 here); pass live:true to test it over the live look instead.');
  if((sets.has('pan')||sets.has('tilt'))&&!movers)warnings.push('The code moves pan/tilt but none of these fixtures is a moving head.');
  if(!sets.size)warnings.push('The code changed nothing on these fixtures at the sampled times.');
  const ms=codeTiming(p.code);if(ms!==null&&ms>CODE_LIMITS.frameMs/3)warnings.push(`One frame takes ${ms} ms: keep it well under ${CODE_LIMITS.frameMs} ms or the effect will be skipped under load.`);
  return {ok:true,fixtures:ids.length,movingHeads:movers,sets:[...sets],ms,budgetMs:CODE_LIMITS.frameMs,frames,warnings,note:'Sampled values before master, blackout and each fixture\'s own limits. Nothing was sent or saved.'};
 }
 // Wall video link (docs/WALL-VIDEO.md): server.mjs attaches the link as this.wall. Not show data: the light offset is
 // kept per computer in <data>/wall-video.json, and nothing here changes lighting or output.
 wallCommand(name,args){const w=this.wall;
  if(!w)return name==='wall.video.status'?{listening:false,connected:false,feed:'off',note:'The wall video link is not running in this engine (LIGHTS_WALL_PORT=off, or a test engine).'}:(()=>{throw Error('The wall video link is not running in this engine')})();
  if(name==='wall.video.offset'){const before=w.manual;w.setManual(args.ms);if(w.manual!==before)this.log(`Wall video light offset ${w.manual>0?'+':''}${w.manual} ms`)}
  if(name==='wall.video.probe'){w.setProbe(args);this.log(`Wall video sync probe ${w.probe.enabled?'on':'off'}`)}
  return w.status()}
 outputStatus(){const s=this.show.settings,o=this.output.status();return {armed:o.armed,sending:o.armed&&!o.failing,failing:!!o.failing,recovering:!!o.recovering,sendErrors:o.sendErrors??0,source:s.source,target:s.target,port:s.port??6454,mappings:copy(s.mappings),packets:o.packets,lastSent:o.lastSent,lastError:o.lastError,armedAt:o.armedAt??null,receiver:o.receiver,interfaces:o.interfaces,lastCheck:this.lastCheck??null,note:o.armed&&o.failing?'Armed, but packets are not getting out ('+(o.lastError??'unknown error')+'). Output stays armed and retries every second: check the lighting network cable and adapter.':o.armed?'Sending Art-Net. ArtDMX has no acknowledgment, so watch the rig.':'Output is disarmed: nothing is sent to the rig. Arm output (output.arm) to send Art-Net.'}}
 fxSummary(fx){if(!fx)return fx;const {code,...params}=fx.params;return {id:fx.id,name:fx.name,preset:fx.preset,effect:fx.effect,layer:fx.layer,fixtures:fx.fixtures,params}}
 upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i<0)list.push(copy(item));else list[i]=copy(item)}
 ensureIds(ids){for(const id of ids)if(!this.show.fixtures.some(f=>f.id===id))throw Error('Unknown fixture '+id)}
 async disarm(){this.lampCommands.clear();this.flashes.clear();this.bumps.clear();const dark=copy(this.frames).map(f=>({...f,intensity:0}));this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.fading=null;this.transition=null;this.release=null;this.stack=null;this.held=copy(dark);this.frames=copy(dark);if(this.output.armed){for(let i=0;i<5;i++){this.output.send(encode(this.show,dark,{physical:true}));await new Promise(r=>setTimeout(r,34))}this.output.close();}this.playback=null;this.overrides={};this.fx=[];this.fading=null;this.held=copy(this.frames).map(f=>({...f,intensity:0}));this.frames=copy(this.held);
  // The scene survives a disarm (the rig still gets its blackout above): the preview shows it again and re-arming sends it.
  if(this.scene)this.held=null;this.log('Physical output stopped. Hog channel handback remains manual.')}
 // lean: skip building the full runtime in the reply (show-control triggers do not need it).
 async command(name,args={},{lean=false}={}){
  if(!Object.hasOwn(COMMANDS,name))throw Error('Unknown command '+name);const def=COMMANDS[name];validate(def.schema,args);
  // Sound trigger tuning (channel, band, sensitivity, hold, gap) is a live adjustment like a fader, so it stays open.
  const soundTuning=name==='masters.assign'&&Object.keys(args).every(k=>['slot','sound','clearSound'].includes(k));
  if(this.locked&&SHOW_EDITS.has(name)&&!soundTuning)throw Error('The performance lock is on: unlock it to change the show.');
  if(name==='show.summary')return this.showSummary();
  if(name.startsWith('assistant.'))return this.assistantCommand(name,args);
  if(name==='show.versions')return {versions:this.versions.list()};if(name==='masters.status')return this.mastersReport();if(name==='show.files')return {folder:this.files.folder,current:this.showFileStatus(),files:this.files.list(args.query)};if(name==='show.check')return this.showCheck(args);if(name==='modules.status')return this.modulesStatus();if(name==='sound.inputs')return {inputs:this.show.audioInputs??[]};
  if(['sound.status','midi.status'].includes(name)){const m=this.mods?.[name.split('.')[0]];if(!m)throw Error(this.moduleOff(name.split('.')[0]));return m.status()}
  if(name==='agent.hello'){const known=this.agents.get(args.session);this.agents.set(args.session,{session:args.session,client:args.client,version:args.version??'',connectedAt:known?.connectedAt??this.clock(),lastSeen:this.clock()});if(!known)this.log(`Agent connected · ${args.client}${args.version?' '+args.version:''}`);return {ok:true}}
  if(name==='status')return this.status(args);if(name==='overview')return this.overview();if(name==='visualizer.status')return this.visualizerStatus();if(name==='patch.report')return this.patchReport();if(name==='network.status')return this.networkStatus();if(name==='look.report')return this.lookReport(args);
  if(name.startsWith('wall.'))return this.wallCommand(name,args);
  if(name==='output.status')return this.outputStatus();if(name==='output.check'){const c={...this.show.settings,...Object.fromEntries(Object.entries(args).filter(([,v])=>v))};this.lastCheck=await(this.output.check?this.output.check(c):checkConnection(c));this.log(`Connection check · ${c.target} · ${this.lastCheck.ok?'all good':this.lastCheck.steps.filter(x=>!x.ok).map(x=>x.id).join(', ')+' failed'}`);return this.lastCheck}
  if(name==='target.presets'){const t=this.targetById(args.id);if(args.refresh)this.askPresets(t);return {target:t.id,requested:!!args.refresh,...(this.net.presets[t.id]??{at:null,presets:[]})}}
 if(name==='schema'){const all={version:1,commands:COMMANDS,profiles:PROFILE_DEFS,effects:EFFECTS,presets:this.allPresets(),code:CODE_DOC,icons:ICONS,media:BUILTIN_MEDIA};return args.only?{version:1,...Object.fromEntries(args.only.map(k=>[k,all[k]]))}:all}if(name==='effect.test')return this.effectTest(args);let created;
  if(this.output.armed&&['show.import','show.open','fixture.patch','output.configure','cue.seek','effect.preview'].includes(name))throw Error('Disarm physical output before this operation.');
  if(PROGRAMMER.has(name)&&!this.inner)this.pushUndo();this.editing=name;
  // A version is written before a delete (at most one per 10 s; an earlier one already predates this delete).
  if(name.endsWith('.delete')&&SHOW_EDITS.has(name)&&name!=='fixture.delete'&&this.clock()-(this.deleteSnap??-Infinity)>10){this.deleteSnap=this.clock();try{this.versions.snapshot(this.show,'before-delete')}catch(e){this.log('No version could be written before this delete: '+e.message)}}
  switch(name){
   case 'kill.set':{if(!!args.group===!!args.slot)throw Error('Give a group or a master slot to kill');const key=args.group?'group:'+args.group:'slot:'+args.slot,slots=this.show.masters.slots,g=args.group&&this.show.groups.find(x=>x.id===args.group),m=args.slot&&slots.find(x=>x.id===args.slot);
    if(args.group&&!g)throw Error('Unknown group '+args.group);if(args.slot&&!m)throw Error('Unknown master '+args.slot);if(m&&!m.cue)throw Error(`Master ${slots.indexOf(m)+1} has no cue to kill`);
    const on=args.killed??!this.kills.has(key);if(on)this.kills.set(key,g?{group:g.id}:{slot:m.id});else this.kills.delete(key);this.killVersion++;this.log(`${on?'Killed':'Back'} · ${g?g.name:`master ${slots.indexOf(m)+1}`}`);created={killed:on};break}
   case 'kill.clear':this.kills.clear();this.killVersion++;break;
   case 'park.set':this.park(args);break;
   case 'find.start':this.findStart(args);break;
   case 'find.step':if(!this.find)this.findStart({});this.findGo(this.find.index+(args.direction==='back'?-1:1));break;
   case 'find.stop':if(this.find){const {ids,group}=this.find;this.find=null;this.highlight=false;this.selection={ids,group,revision:this.selection.revision+1};this.log('Find off')}break;
   case 'selection.set':{
    this.ensureIds(args.ids);if(args.group&&args.group!=='all'&&!this.show.groups.some(g=>g.id===args.group))throw Error('Unknown selection group');
    // Without an explicit group the old one stays only while every ID is still in it, so clearing the selection (or
    // picking outside the group) drops it and the UI's fixture buttons go back to the whole rig.
    const ids=[...new Set(args.ids)],prev=this.selection.group,members=prev==='all'?null:this.show.groups.find(g=>g.id===prev)?.fixtures;
    const keep=prev&&ids.length&&(prev==='all'||members&&ids.every(id=>members.includes(id)));
    this.selection={ids,group:args.group??(keep?prev:null),revision:this.selection.revision+1};if(this.find&&!(ids.length===1&&this.find.ids.includes(ids[0])))this.find=null;else if(this.find)this.find.index=this.find.ids.indexOf(ids[0]);break;
   }
   case 'selection.group':{
    const ids=args.group==='all'?this.show.fixtures.filter(f=>f.enabled).map(f=>f.id):this.show.groups.find(g=>g.id===args.group)?.fixtures;
    if(!ids)throw Error('Unknown selection group');this.selection={ids:[...ids],group:args.group,revision:this.selection.revision+1};break;
   }
   case 'look.capture':{const look=args.all?this.snapshotLook():this.activeLook(this.snapshotLook());if(!look.length)throw Error('Nothing is lit or changed to record');this.update(s=>{this.upsert(s.cues,{id:args.id,name:args.name,duration:30,loop:true,tracks:[],look});if(args.page)created={cue:args.id,entry:this.appendEntry(s,args.page,args.id,args.fade)}});created??={cue:args.id};break;}
   // A running copy takes the edit at once (look, tracks, tempo, speed), rebased so it never jumps; a preview of it too.
   case 'cue.save':this.update(s=>this.upsert(s.cues,args.cue));for(const r of this.running())if(r.cue.id===args.cue.id)this.retake(r,args.cue);if(this.preview?.saved&&this.preview.cue.id===args.cue.id)this.preview.cue=copy(args.cue);break;
   case 'cue.delete':this.update(s=>{s.cues=s.cues.filter(c=>c.id!==args.id);for(const p of s.pages)p.cues=p.cues.filter(e=>e.cue!==args.id);for(const m of s.masters.slots)if(m.cue===args.id)delete m.cue});break;
   case 'cue.play':{
    if(args.requestId&&this.requests.has(args.requestId))return {ok:true,duplicate:true,runtime:this.runtime()};
    const cue=this.show.cues.find(c=>c.id===args.id);if(!cue)throw Error('Unknown cue');
    this.overrides={};this.fx=[];this.release=null;this.stack=null;this.startCue(cue,{fade:args.fade??0});
    if(args.requestId){this.requests.set(args.requestId,this.clock());if(this.requests.size>1000)this.requests.delete(this.requests.keys().next().value)}break;}
   case 'cue.pause':{const r=args.id===undefined?this.playback:this.runningCue(args.id);if(r&&r.paused!==args.paused){this.rebase(r);r.paused=args.paused;this.log(`${args.paused?'Paused':'Resumed'} · ${r.cue.name}`)}break}
   // A cue's own releaseFade (seconds) is how long Stop takes to settle it back, e.g. a movement cue gliding home.
   case 'cue.release':{const r=this.runningCue(args.id);this.releaseCue(r,args.fade??r?.cue.releaseFade??1.5);break}
   case 'highlight.set':this.highlight=args.enabled;if(!args.enabled)this.find=null;this.log(`Highlight ${args.enabled?'on':'off'}`);break;
   case 'cue.seek':if(this.playback){this.playback.offset=Math.min(args.seconds,this.playback.cue.duration);this.playback.started=this.clock()}break;
   case 'cue.stop':{const lit=copy(this.programmed??this.raw??this.frames);this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.transition=null;this.release=null;this.stack=null;this.flashes.clear();this.bumps.clear();
    if(this.scene)this.toFloor(args.fade??1.5,lit);else this.fading={start:this.clock(),duration:args.fade??1.5,frames:copy(this.frames)};break}
   case 'scene.capture':{const old=this.show.scenes.find(x=>x.id===args.id),color=args.color??old?.color,look=this.snapshotLook();this.update(s=>this.upsert(s.scenes,{id:args.id,name:args.name,...(color?{color}:{}),look}));created={scene:args.id};break}
   case 'scene.save':this.update(s=>this.upsert(s.scenes,args.scene));break;
   case 'scene.delete':if(!this.show.scenes.some(x=>x.id===args.id))throw Error('Unknown scene');if(this.scene?.id===args.id)this.dropScene(this.sceneFade());this.update(s=>{s.scenes=s.scenes.filter(x=>x.id!==args.id)});break;
   case 'scene.go':{const sc=this.show.scenes.find(x=>x.id===args.id);if(!sc)throw Error('Unknown scene');const fade=args.fade??this.sceneFade(),from=copy(this.raw??this.frames);
    this.scene={id:sc.id,name:sc.name,rev:-1};this.held=null;this.fading=null;this.transition=fade>0?{start:this.clock(),duration:fade,from:{frames:from}}:null;break}
   case 'scene.release':this.dropScene(args.fade??this.sceneFade());break;
   case 'masters.step':this.stepMaster(args.slot);break;
   case 'masters.trigger':this.masterTrigger(args.slot,args.down);break;
   case 'masters.assign':{if(args.cue&&!this.show.cues.some(c=>c.id===args.cue))throw Error('Unknown cue '+args.cue);
    this.update(s=>{const m=masterSlot(s,args.slot);if(args.clear){delete m.cue;delete m.label}if(args.cue)m.cue=args.cue;if(args.action)m.action=args.action;if(args.fade!==undefined)m.fade=args.fade;if(args.label!==undefined){if(args.label)m.label=args.label;else delete m.label}
     if(args.color)m.color=args.color;if(args.clearColor)delete m.color;if(args.priority!==undefined){if(args.priority)m.priority=true;else delete m.priority}if(args.soloKill!==undefined){if(args.soloKill)m.soloKill=true;else delete m.soloKill}if(args.sound)m.sound=args.sound;if(args.clearSound)delete m.sound;if(args.midi)m.midi=args.midi;if(args.clearMidi)delete m.midi});
    if(args.clear||args.cue){this.flashes.delete(args.slot);this.bumps.delete(args.slot)}if(args.sound||args.clearSound||args.clear)await this.mods?.sound?.configure();break}
   case 'masters.level':this.masterLevel(args.slot,args.level,args.go??true);break;
   case 'limit.set':{const g=this.show.groups.find(x=>x.id===args.group);if(!g)throw Error('Unknown group '+args.group);const max=args.max??1;
    this.update(s=>{const rest=(s.limits??[]).filter(l=>l.group!==g.id);s.limits=max<1?[...rest,{group:g.id,max}]:rest});this.log(max<1?`Intensity limit · ${g.name} at most ${Math.round(max*100)}%`:`Intensity limit removed · ${g.name}`);created={limits:this.show.limits};break}
   case 'masters.own':{const slots=this.show.masters.slots,m=masterSlot(this.show,args.slot),n=slots.indexOf(m)+1;if(!m.cue)throw Error(`Master ${n} has no cue`);const src=this.show.cues.find(c=>c.id===m.cue),id=args.id??`${src.id}-${m.id}`.slice(0,64);
    if(this.show.cues.some(c=>c.id===id))throw Error(`A cue ${id} already exists: give another id`);
    this.update(s=>{s.cues.push({...copy(src),id,name:(args.name??`${src.name} · M${n}`).slice(0,100)});masterSlot(s,args.slot).cue=id});this.flashes.delete(args.slot);this.bumps.delete(args.slot);this.log(`Master ${n} has its own cue · ${id}`);created={cue:id};break}
   case 'masters.sound':{const m=this.show.masters.slots.find(x=>x.id===args.slot);if(!m)throw Error('Unknown master '+args.slot);if(!m.sound)throw Error(`Master ${this.show.masters.slots.indexOf(m)+1} has no sound trigger: give it one in its editor first`);
    const on=args.enabled??m.sound.enabled===false;this.update(s=>{masterSlot(s,args.slot).sound.enabled=on});if(!on&&this.soundHolds.has(args.slot)){clearTimeout(this.soundHolds.get(args.slot));this.soundHolds.delete(args.slot);this.masterTrigger(args.slot,false)}
    Promise.resolve(this.mods?.sound?.configure()).catch(e=>this.log('Sound: '+e.message));this.log(`Master ${this.show.masters.slots.findIndex(x=>x.id===args.slot)+1} sound trigger ${on?'on':'off'}`);created={slot:args.slot,sound:on};break}
   case 'tempo.tap':this.tapTempo();break;
   case 'tempo.set':this.setTempo(args.bpm??null,'set');break;
   case 'tempo.scale':this.setTempo(this.tempoBase()*args.factor,this.tempo.source??'set');break;
   case 'tempo.nudge':this.setTempo(this.tempoBase()+args.delta,this.tempo.source??'set');break;
   case 'show.autosave':this.files.autosave=args.enabled;this.files.persist();this.log(`Show autosave ${args.enabled?'on':'off'}`);if(args.enabled)this.autosaveNow();created={autosave:args.enabled};break;
   case 'performance.lock':if(args.enabled&&!this.locked){this.versions.snapshot(this.show,'performance-lock');this.autosaveNow('lock')}this.locked=args.enabled;this.log(`Performance lock ${args.enabled?'on':'off'}`);break;
   case 'show.restore':{if(this.output.armed)throw Error('Disarm output before restoring a show version.');const next=migrate(this.versions.read(args.id));next.settings=copy(this.show.settings);validateShow(next);
    this.versions.snapshot(this.show,'before-restore');this.resetLive();this.update(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,next)});this.undoShow=null;this.log('Show restored from version '+args.id);break}
   // One action back to the same look: everything is restored first and output armed last, so the first packet out is the
   // whole look and there is no dark gap. Still needs the arm confirmation when it re-arms.
   case 'resume.apply':{const r=this.resume;if(!r)throw Error('Nothing to resume');if(r.armed&&!this.output.armed&&args.confirmation!=='ENABLE_PHYSICAL_OUTPUT')throw Error('Resuming re-arms output: pass confirmation ENABLE_PHYSICAL_OUTPUT');this.resume=null;
    if(r.tempo)this.setTempo(r.tempo,'resume');if(typeof r.master==='number')this.master=r.master;
    const sc=r.scene&&this.show.scenes.find(s=>s.id===r.scene);if(sc)this.scene={id:sc.id,name:sc.name,rev:-1};this.held=null;this.fading=null;this.transition=null;this.release=null;
    const back=this.restoreLive(r);if(r.armed&&!this.output.armed)await this.output.arm(this.show.settings);
    this.log(`Resumed after ${r.reason==='restart'?'a restart':'an unexpected restart'}`+(sc?' · scene '+sc.name:'')+` · ${back.cues} cue${back.cues===1?'':'s'}`+(back.missing.length?` · ${back.missing.length} no longer in the show`:''));created={cues:back.cues,missing:back.missing};break}
   case 'resume.dismiss':this.resume=null;this.live.write(this.liveSnapshot());break;
   case 'sound.inputs.set':this.update(s=>{const m=new Map(args.replace?[]:(s.audioInputs??[]).map(a=>[a.channel,a.name]));for(const a of args.inputs){const n=a.name.trim();if(n)m.set(a.channel,n);else m.delete(a.channel)}s.audioInputs=[...m].sort((a,b)=>a[0]-b[0]).map(([channel,name])=>({channel,name}))});break;
   // A device change is logged with both names, so a trigger that went deaf can be traced to the moment its input moved.
   case 'modules.set':{const before=this.show.settings.modules?.sound?.device??null;this.update(s=>{const m=s.settings.modules??={};if(args.sound)m.sound={...m.sound,...args.sound};if(args.midi)m.midi={...m.midi,...args.midi}});const after=this.show.settings.modules?.sound?.device??null;if(after!==before)this.log(`Sound input device · ${before??'none'} → ${after??'none'}`);await this.syncModules();break}
   // Re-import the module files from disk and restart the helper: sound triggers and the APC40 drop for about a second.
   case 'modules.reload':{if(!this.mods)throw Error('No module is on: nothing to reload');await this.mods.close();this.mods=null;this.modsVersion=(this.modsVersion??0)+1;await this.syncModules();
    this.log(`Modules reloaded from disk (version ${this.modsVersion}): sound triggers and the APC40 were away for a moment`);created={version:this.modsVersion};break}
   case 'sound.meter':case 'sound.test':case 'midi.test':case 'controller.test':{const which=name.startsWith('sound')?'sound':'midi',mod=this.mods?.[which];if(!mod)throw Error(this.moduleOff(which));created=await mod.command(name,args);break}
   case 'controller.save':this.update(s=>{const list=s.controllers??=[];let c=list.find(x=>x.id===args.id);if(!c)list.push(c={id:args.id,model:args.model??'apc40mk2',map:{}});Object.assign(c.map,args.map??{});for(const k of ['name','deskNumbers','deskColors'])if(args[k])c[k]=args[k]});this.mods?.changed(true);break;
   case 'controller.reset':this.update(s=>{s.controllers=(s.controllers??[]).filter(c=>c.id!==args.id)});this.mods?.changed(true);break;
   case 'masters.key':{if(!args.clear&&!args.key)throw Error('Give a key, or clear:true');this.update(s=>setMasterKey(s,args.slot,args.clear?null:args.key,args.conflict));break}
   case 'masters.save':this.update(s=>{if(args.slots)s.masters.slots=args.slots;if(args.desk)s.masters.desk=args.desk});for(const id of [...this.flashes.keys()])if(!this.show.masters.slots.some(m=>m.id===id&&m.cue===this.flashes.get(id)))this.flashes.delete(id);for(const [id,cue] of [...this.bumps])if(!this.show.masters.slots.some(m=>m.id===id&&m.cue===cue))this.bumps.delete(id);break;
   case 'effect.preview':{
    const cue={id:'ad-hoc',name:'Unsaved effect',duration:args.duration??20,loop:true,tracks:[{group:args.group,effect:args.effect,start:0,duration:args.duration??20,params:args.params,fadeIn:.5,fadeOut:.5}]};
    const probe=copy(this.show);probe.cues.push(cue);validateShow(probe);this.overrides={};this.fx=[];this.release=null;this.stack=null;this.startCue(cue);break;}
   case 'effect.save':if(!this.show.groups.some(g=>g.id===args.group))throw Error('Unknown group');validateEffectParams(args.effect,args.params,args.name);this.update(s=>this.upsert(s.effects,args));break;
   case 'fixture.lamp':{
    if(!this.output.armed)throw Error('Lamp commands require armed physical output.');
    this.ensureIds(args.ids);
    for(const id of args.ids){const f=this.show.fixtures.find(f=>f.id===id);
     if(!PROFILE_DEFS[f.profile]?.lampControl||!f.enabled||!f.verified)throw Error('Lamp commands require an enabled lamp-control profile (MH7, 200W Beam or 7R).');
     if(this.show.settings.mappings[f.universe]===undefined)throw Error('Missing Art-Net route for Hog universe '+f.universe);
     if(this.lampCommands.has(id)&&this.lampCommands.get(id).until>this.clock())throw Error('Lamp command already in progress for '+id);
    }
    for(const id of args.ids)this.lampCommands.set(id,{action:args.action,until:this.clock()+5});
    this.log(`Fixture lamp ${args.action} requested · ${args.ids.join(', ')} · physical state unconfirmed`);break;
   }
   case 'fixture.set':this.ensureIds(args.ids);for(const id of args.ids)validateWheelAttributes(this.show.fixtures.find(f=>f.id===id),args.values);for(const id of args.ids)if(this.show.fixtures.find(f=>f.id===id).profile==='beam200'&&args.values.prism>1)throw Error('200W Beam supports one 3-face prism (0 or 1).');for(const id of args.ids){if(this.show.fixtures.find(f=>f.id===id).profile==='beam7r'&&(args.values.prism>1||args.values.gobo>14))throw Error('7R supports one 8-face prism and static gobos 0–14');if(this.show.fixtures.find(f=>f.id===id).profile==='mh7'&&(args.values.prism===3||args.values.gobo>12))throw Error('MH7 supports one prism at a time and static gobos 0–12');}const buffer=this.blind?this.blindOverrides:this.overrides;for(const id of args.ids){const next={...(buffer[id]??{})};if(args.values.color!==undefined){delete next.colorWheel;delete next.colorWheel2;}buffer[id]={...next,...copy(args.values)}}this.fadeFrom(args.ids,args.fade??this.show.playback.manualFade??0);if(!this.blind)this.fading=null;break;
   case 'fixture.color.save':
   case 'fixture.colors.save':{
    let entries=name==='fixture.color.save'?[{id:args.id,value:args.value,...(args.secondary===undefined?{}:{secondary:args.secondary})}]:args.entries;
    this.ensureIds(entries.map(e=>e.id));if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Duplicate fixture in wheel color selection');
    for(const entry of entries){const f=this.show.fixtures.find(f=>f.id===entry.id);validateWheelAttributes(f,{colorWheel:entry.value,...(entry.secondary===undefined?{}:{colorWheel2:entry.secondary})});}
    if(args.scope==='profile'){
     const profiles=entries.map(e=>this.show.fixtures.find(f=>f.id===e.id).profile);if(new Set(profiles).size!==profiles.length)throw Error('Provide one source wheel value per fixture profile');
     entries=entries.flatMap(e=>this.show.fixtures.filter(f=>f.profile===this.show.fixtures.find(f=>f.id===e.id).profile).map(f=>({...e,id:f.id})));
    }
    this.update(s=>{for(const entry of entries){const fixture=s.fixtures.find(f=>f.id===entry.id),slot={name:args.name,color:args.color,value:entry.value,...(entry.secondary===undefined?{}:{secondary:entry.secondary})};fixture.colorSlots=(fixture.colorSlots??[]).filter(c=>c.value!==slot.value||(c.secondary??0)!==(slot.secondary??0));fixture.colorSlots.push(slot)}if(name==='fixture.colors.save')this.upsert(s.palettes,{id:'wheel-'+args.color.slice(1).toLowerCase(),name:args.name,color:args.color})});break;
   }
   case 'fixture.clear':this.ensureIds(args.ids);for(const id of args.ids)delete (this.blind?this.blindOverrides:this.overrides)[id];break;
   case 'fixture.place':this.ensureIds([args.id]);this.update(s=>{const f=s.fixtures.find(f=>f.id===args.id);f.position=copy(args.position);if(args.aim)f.aim=copy(args.aim)});break;
   case 'calibration.hold':{
    this.ensureIds([args.id]);if(!['rogue','mh7','beam200','beam7r'].includes(this.show.fixtures.find(f=>f.id===args.id).profile))throw Error('Select a verified moving head');
    if(this.playback&&!this.playback.paused){this.playback.offset=this.elapsed();this.playback.paused=true;}
    const f=this.frames.find(f=>f.id===args.id);this.overrides[args.id]={...(this.overrides[args.id]??{}),pan:f.pan,tilt:f.tilt};break;
   }
   case 'calibration.align':{
    this.ensureIds([args.id]);const frame=this.frames.find(f=>f.id===args.id);
    if(this.playback&&!this.playback.paused)throw Error('Hold the actual pose before aligning');
    if(Math.abs(frame.pan-args.actual[0])>1/65535||Math.abs(frame.tilt-args.actual[1])>1/65535)throw Error('Actual position changed. Hold and align again.');
    this.update(s=>{const f=s.fixtures.find(f=>f.id===args.id);if(!['rogue','mh7','beam200','beam7r'].includes(f.profile))throw Error('Select a verified moving head');const {id,...alignment}=args;f.calibration.alignment={...copy(alignment),savedAt:new Date().toISOString()}});break;
   }
   case 'show.import':{
    if(!args.show||typeof args.show!=='object')throw Error('Invalid show');
    this.replaceShow(args.show,'before-import');this.files.track(null);break;
   }
   case 'show.save':{
    const c=this.files.current,name=args.name===undefined?c?.name:this.files.name(args.name);if(!name)throw Error('This show has no file yet: give it a name (Save As).');
    const same=c&&name.toLowerCase()===c.name.toLowerCase(),existing=this.files.find(name);
    if(existing&&!same&&!args.overwrite)throw Error(`A show named "${existing.name}" is already in ${this.files.folder}. Pass overwrite:true to replace it.`);
    const saved=this.files.write(existing?.name??name,this.show);this.files.track(saved.name,this.show);this.savedRevision=this.revision;created={file:saved};this.log('Show saved · '+saved.name);break;
   }
   case 'show.open':{
    if(this.revision!==this.savedRevision&&!args.discard)throw Error(`The current show has unsaved changes${this.files.current?' to "'+this.files.current.name+'"':''}. Save it first, or pass discard:true (it is kept in show.versions).`);
    const f=this.files.read(args.name);this.replaceShow(f.show,'before-open');this.files.track(f.name,this.show,f.modified);this.savedRevision=this.revision;created={file:{name:f.name,file:f.file}};this.log('Show opened · '+f.name);break;
   }
   case 'show.folder.set':created={folder:this.files.setFolder(args.path)};this.log('Shows folder · '+created.folder);break;
   case 'show.reveal':{const p=args.name?this.files.read(args.name).file:this.files.current&&this.files.find(this.files.current.name)?.file;const target=p??this.files.dir();fs.mkdirSync(this.files.dir(),{recursive:true});(this.revealHook??reveal)(target,!!p);break}
   case 'fixture.patch':this.update(s=>this.upsert(s.fixtures,args.fixture));break;
   case 'group.save':{if(!args.fixtures&&!args.children)throw Error('Give fixtures, or children for a parent group');if(args.fixtures)this.ensureIds(args.fixtures);if(args.children)for(const c of args.children)if(!this.show.groups.some(g=>g.id===c))throw Error('Unknown group '+c);if(args.children&&!args.fixtures)args={...args,fixtures:[]};const old=this.show.groups.find(g=>g.id===args.id)?.color;this.update(s=>this.upsert(s.groups,{...args,...(args.color??old?{color:args.color??old}:{})}));break}
   case 'palette.save':if(new Set(args.profiles?.map(x=>x.profile)).size!==(args.profiles?.length??0))throw Error('A palette lists each profile once');this.update(s=>this.upsert(s.palettes,args));break;
   case 'palette.apply':{const p=this.show.palettes.find(p=>p.id===args.id);if(!p)throw Error('Unknown palette');this.ensureIds(args.ids);const index=fixtureIndex(this.show),buffer=this.blind?this.blindOverrides:this.overrides,sets=new Map();
    for(const id of args.ids){const e=p.profiles?.find(x=>x.profile===index.get(id).profile)??p,ov=buffer[id],emit=e.white!==undefined||e.amber!==undefined||e.mint!==undefined;
     const values={color:e.color,...(e.color.toLowerCase()==='#ffffff'?{white:0}:{}),...(emit?{...(e.white!==undefined?{white:e.white}:{}),amber:e.amber??0,mint:e.mint??0}:ov&&(ov.amber!==undefined||ov.mint!==undefined)?{amber:ov.white??0,mint:ov.white??0}:{})},key=JSON.stringify(values);
     if(!sets.has(key))sets.set(key,{ids:[],values});sets.get(key).ids.push(id)}
    this.inner=true;try{for(const s of sets.values())await this.command('fixture.set',s,{lean:true})}finally{this.inner=false}break;}
   case 'point.save':this.ensureIds(args.fixtures);this.update(s=>this.upsert(s.points,{id:args.id,name:args.name,positions:Object.fromEntries(args.fixtures.map(id=>{const f=(this.blind?this.previewFrames:this.frames).find(f=>f.id===id);return [id,{pan:f.pan,tilt:f.tilt}]}))}));break;
   case 'point.recall':{const p=this.show.points.find(p=>p.id===args.id);if(!p)throw Error('Unknown position');if(args.ids)this.ensureIds(args.ids);const ids=Object.keys(p.positions).filter(id=>!args.ids||args.ids.includes(id));if(!ids.length)throw Error('No selected fixture has a pose in this position');const buffer=this.blind?this.blindOverrides:this.overrides;for(const id of ids){buffer[id]={...(buffer[id]??{}),...p.positions[id]};if(!this.blind&&this.release&&!(args.fade??this.show.playback.manualFade??0))delete this.release.frames[id]}this.fadeFrom(ids,args.fade??this.show.playback.manualFade??0);if(this.blind)break;this.fading=null;break;}
   case 'point.delete':if(this.show.cues.some(c=>c.tracks.some(t=>t.params.pointA===args.id||t.params.pointB===args.id||t.params.points?.includes(args.id))))throw Error('A cue uses this position');this.update(s=>{s.points=s.points.filter(p=>p.id!==args.id)});break;
   case 'group.edit':{
    const g=this.show.groups.find(g=>g.id===args.id);if(!g)throw Error('Unknown group');if(args.add)this.ensureIds(args.add);
    if((args.add||args.remove)&&(args.children??g.children)?.length)throw Error(`${g.name} is a parent group: add or remove fixtures in its child groups`);
    for(const c of args.children??[])if(!this.show.groups.some(x=>x.id===c))throw Error('Unknown group '+c);
    const drop=new Set(args.remove??[]),fixtures=[...g.fixtures,...(args.add??[]).filter(id=>!g.fixtures.includes(id))].filter((id,i,all)=>!drop.has(id)&&all.indexOf(id)===i);
    if(!fixtures.length)throw Error('A group needs at least one fixture; delete it instead');
    const color=args.color===undefined?g.color:args.color||undefined;const children=args.children===undefined?g.children:args.children.length?args.children:undefined;this.update(s=>this.upsert(s.groups,{id:g.id,name:args.name??g.name,fixtures,...(children?{children}:{}),...(color?{color}:{})}));break;}
   case 'fixture.delete':{
    if(this.output.armed)throw Error('Turn output off before removing fixtures');this.ensureIds(args.ids);const gone=new Set(args.ids);
    const emptied=new Set(this.show.groups.filter(g=>!g.children?.length&&g.fixtures.every(id=>gone.has(id))).map(g=>g.id));
    const users=[...this.show.cues.filter(c=>c.tracks.some(t=>emptied.has(t.group))).map(c=>'cue '+c.name),...this.show.effects.filter(e=>emptied.has(e.group)).map(e=>'effect '+e.name),...(this.show.zones??[]).filter(z=>z.groups?.some(g=>emptied.has(g))).map(z=>'zone '+z.name)];
    if(users.length)throw Error(`That would empty a group used by ${users.slice(0,4).join(', ')}${users.length>4?'…':''}`);
    this.versions.snapshot(this.show,'before-delete');
    this.update(s=>{
     s.fixtures=s.fixtures.filter(f=>!gone.has(f.id));
     s.groups=s.groups.filter(g=>!emptied.has(g.id));for(const g of s.groups){g.fixtures=g.fixtures.filter(id=>!gone.has(id));if(g.children){g.children=g.children.filter(c=>!emptied.has(c));if(!g.children.length)delete g.children}}
     s.groups=s.groups.filter(g=>g.fixtures.length||g.children?.length);
     for(const c of [...s.cues,...(s.scenes??[])]){if(c.look)c.look=c.look.filter(e=>!gone.has(e.id));if(c.tracks)c.tracks=c.tracks.map(t=>t.fixtures?{...t,fixtures:t.fixtures.filter(id=>!gone.has(id))}:t).filter(t=>!t.fixtures||t.fixtures.length)}
     for(const p of s.points??[])for(const id of gone)delete p.positions?.[id];
     if(s.parked)s.parked=s.parked.filter(p=>!gone.has(p.id));if(s.limits)s.limits=s.limits.filter(l=>s.groups.some(g=>g.id===l.group));
     if(s.visualizer){s.visualizer.hiddenFixtures=(s.visualizer.hiddenFixtures??[]).filter(id=>!gone.has(id));s.visualizer.hiddenGroups=(s.visualizer.hiddenGroups??[]).filter(g=>!emptied.has(g))}
    });
    this.selection={ids:this.selection.ids.filter(id=>!gone.has(id)),group:emptied.has(this.selection.group)?null:this.selection.group,revision:this.selection.revision+1};for(const id of gone)delete this.overrides[id];
    this.log(`Removed ${gone.size} fixture${gone.size===1?'':'s'}${emptied.size?' and group'+(emptied.size===1?' ':'s ')+[...emptied].join(', '):''}`);break}
   case 'group.nest':{const g=this.show.groups.find(x=>x.id===args.id),p=args.parent&&this.show.groups.find(x=>x.id===args.parent);if(!g)throw Error('Unknown group');if(args.parent&&!p)throw Error('Unknown group '+args.parent);
    if(p&&!p.children?.length)throw Error(`${p.name} holds fixtures, not groups: make a parent group first (group.save with children)`);
    if(p&&(p.id===g.id||groupDescendants(this.show,g.id).has(p.id)))throw Error(`${p.name} is inside ${g.name}: a group cannot go inside itself`);
    this.update(s=>{for(const x of s.groups)if(x.children?.includes(g.id)&&x.id!==p?.id){x.children=x.children.filter(c=>c!==g.id);if(!x.children.length)delete x.children}
     if(p){const t=s.groups.find(x=>x.id===p.id);t.children=t.children?.includes(g.id)?t.children:[...(t.children??[]),g.id]}});break}
   case 'group.delete':if(this.show.effects.some(e=>e.group===args.id))throw Error('A saved effect uses this group');this.update(s=>{s.groups=s.groups.filter(g=>g.id!==args.id);if(s.limits)s.limits=s.limits.filter(l=>l.group!==args.id);for(const x of s.groups)if(x.children?.includes(args.id)){x.children=x.children.filter(c=>c!==args.id);if(!x.children.length)delete x.children}if(s.visualizer)s.visualizer.hiddenGroups=s.visualizer.hiddenGroups.filter(g=>g!==args.id)});break;
   case 'beam.save':this.update(s=>{s.beamPresets??=[];this.upsert(s.beamPresets,args.preset)});break;
   case 'beam.capture':{this.ensureIds(args.ids);const index=fixtureIndex(this.show),first=(this.blind?this.previewFrames:this.frames).find(f=>f.id===args.ids[0]);if(!first)throw Error('No live frame for '+args.ids[0]);
    const attrs=PROFILE_DEFS[index.get(args.ids[0]).profile].attributes??[],keys=Object.keys(BEAM_VALUES.properties).filter(k=>attrs.includes(k)||(k==='prismRotation'&&attrs.includes('prism'))||(k==='opticalMode'&&PROFILE_DEFS[index.get(args.ids[0]).profile].opticalModes));
    const values=Object.fromEntries(keys.filter(k=>first[k]!==undefined).map(k=>[k,first[k]]));if(!Object.keys(values).length)throw Error('This fixture has no beam attributes to save');
    const preset={id:args.id,name:args.name,values,profiles:[...new Set(args.ids.map(id=>index.get(id).profile))]};validate(BEAM_PRESET,preset);this.update(s=>{s.beamPresets??=[];this.upsert(s.beamPresets,preset)});created={preset};break;}
   case 'beam.apply':{const p=(this.show.beamPresets??[]).find(p=>p.id===args.id);if(!p)throw Error('Unknown beam preset');this.ensureIds(args.ids);const index=fixtureIndex(this.show),ids=args.ids.filter(id=>!p.profiles||p.profiles.includes(index.get(id).profile));
    if(!ids.length)throw Error(`${p.name} is for ${p.profiles.join(', ')}: none of these fixtures`);this.inner=true;try{await this.command('fixture.set',{ids,values:copy(p.values)},{lean:true})}finally{this.inner=false}created={applied:ids,skipped:args.ids.filter(id=>!ids.includes(id))};break;}
   case 'beam.delete':this.update(s=>{s.beamPresets=(s.beamPresets??[]).filter(p=>p.id!==args.id)});break;
   case 'palette.delete':this.update(s=>{s.palettes=s.palettes.filter(p=>p.id!==args.id)});break;
   case 'page.save':this.update(s=>this.upsert(s.pages,args.page));break;
   case 'page.delete':this.update(s=>{s.pages=s.pages.filter(p=>p.id!==args.id)});if(this.stack?.page===args.id)this.stack=null;break;
   case 'page.go':{
    if(args.requestId&&this.requests.has(args.requestId))return {ok:true,duplicate:true,runtime:this.runtime()};
    const page=this.show.pages.find(p=>p.id===args.id);if(!page)throw Error('Unknown page');if(!page.cues.length)throw Error('This page has no cues yet');
    let index;if(args.entry){index=page.cues.findIndex(e=>e.id===args.entry);if(index<0)throw Error('Unknown cue list entry')}
    else if(this.stack?.page===page.id&&this.playback){index=this.stackIndex(page)+1;if(index>=page.cues.length)throw Error('End of cue list')}else index=0;
    this.goEntry(page,index,args.fade);
    if(args.requestId){this.requests.set(args.requestId,this.clock());if(this.requests.size>1000)this.requests.delete(this.requests.keys().next().value)}break;}
   case 'preview.cue':{
    const given=['id','cue'].filter(k=>args[k]!==undefined).length+(args.page!==undefined||args.entry!==undefined?1:0);if(given!==1)throw Error('Preview needs exactly one of: id, page+entry, or cue');
    let cue,page,entry,saved=true,fade=args.fade;
    if(args.cue){const probe=copy(this.show),test={...copy(args.cue),id:'preview-probe-'+crypto.randomUUID().slice(0,6)};probe.cues.push(test);validateShow(probe);cue=copy(args.cue);saved=false}
    else if(args.id){cue=this.show.cues.find(c=>c.id===args.id);if(!cue)throw Error('Unknown cue')}
    else{const p=this.show.pages.find(p=>p.id===args.page);if(!p)throw Error('Unknown page');const e=p.cues.find(e=>e.id===args.entry);if(!e)throw Error('Unknown cue list entry');cue=this.show.cues.find(c=>c.id===e.cue);page=p.id;entry=e.id;fade??=e.fade}
    fade??=0;this.preview={cue:copy(cue),started:this.clock(),saved,page,entry,fade,from:fade>0?copy(this.raw??this.frames):null};break;}
   case 'preview.stop':this.preview=null;break;
   case 'fx.preview':{const next=this.resolveFx(args),old=this.fxPreview,same=old&&old.effect===next.effect&&old.fixtures.join()===next.fixtures.join();this.fxPreview={...next,id:'preview',started:same?old.started:this.clock()};break;}
   case 'network.configure':{const cfg={bind:args.bind,port:args.port??this.show.settings.osc?.port??1461,allow:args.allow??this.show.settings.osc?.allow??[]};this.update(s=>{s.settings.osc=cfg});this.onNetworkChange?.(cfg);break;}
   case 'trigger.save':this.update(s=>this.upsert(s.triggers,args.trigger));break;
   case 'trigger.delete':this.update(s=>{s.triggers=s.triggers.filter(t=>t.id!==args.id)});break;
   case 'trigger.fire':{const t=this.show.triggers.find(t=>t.id===args.id);if(!t)throw Error('Unknown trigger');if(args.requestId&&this.requests.has(args.requestId))return {ok:true,duplicate:true,runtime:this.runtime()};
    if(args.requestId){this.requests.set(args.requestId,this.clock());if(this.requests.size>1000)this.requests.delete(this.requests.keys().next().value)}
    const r=await this.command(t.command,copy(t.args??{}),{lean:true});created={trigger:t.id,command:t.command,...(r.created?{result:r.created}:{})};break;}
   case 'target.save':this.update(s=>this.upsert(s.targets,args.target));break;
   case 'target.delete':this.update(s=>{s.targets=s.targets.filter(t=>t.id!==args.id);for(const p of s.pages)for(const e of p.cues)if(e.send){e.send=e.send.filter(x=>x.target!==args.id);if(!e.send.length)delete e.send}});this.looks.delete(args.id);delete this.net.presets[args.id];break;
   case 'zone.save':this.update(s=>this.upsert(s.zones,args.zone));break;
   case 'zone.delete':if(!this.show.zones.some(z=>z.id===args.id))throw Error('Unknown zone');this.update(s=>{s.zones=s.zones.filter(z=>z.id!==args.id);for(const t of s.targets)if(t.look?.zones){t.look.zones=t.look.zones.filter(z=>z!==args.id);if(!t.look.zones.length)delete t.look.zones}});break;
   case 'look.send':{const t=this.targetById(args.target),msg=this.liveLook(t,'request',args.requestId?{requestId:args.requestId}:{});this.sendLook(t,msg,'request');created={message:msg.id,seq:msg.seq};break;}
   case 'target.test':{const t=this.targetById(args.id);
    if((args.message??'ping')==='ping'){const m=this.envelope(t,'hello',{test:true});this.emit(t,t.kind==='osc'?{osc:{address:'/stagelight/hello',args:['StageLight','test']}}:{http:m},'test',m)}
    else this.sendLook(t,this.liveLook(t,'test',{test:true}),'test');break;}
   case 'preset.save':{if(Object.hasOwn(EFFECT_PRESETS,args.preset.id))throw Error('Built-in presets cannot be changed — save under a new id');this.update(s=>this.upsert(s.presets,args.preset));created={preset:args.preset.id};break;}
   case 'preset.delete':{if(Object.hasOwn(EFFECT_PRESETS,args.id))throw Error('Built-in presets cannot be deleted');if(!this.show.presets.some(p=>p.id===args.id))throw Error('Unknown custom preset');this.update(s=>{s.presets=s.presets.filter(p=>p.id!==args.id)});if(this.fxPreview?.preset===args.id)this.fxPreview.preset=null;break;}
   case 'fx.cancel':this.fxPreview=null;break;
   case 'fx.apply':{
    const next=args.fixtures?this.resolveFx(args):this.fxPreview&&{...this.fxPreview};if(!next)throw Error('Nothing to apply — preview an effect, or give fixtures and a preset');
    const prev=this.fx.find(x=>x.layer===next.layer&&x.effect===next.effect&&x.fixtures.join()===next.fixtures.join()),fade=args.fade??this.show.playback.blindFade;
    const frames=Object.fromEntries((this.programmed??[]).filter(s=>next.fixtures.includes(s.id)).map(s=>[s.id,copy(s)]));
    this.fx=this.fx.map(x=>x.layer===next.layer?{...x,fixtures:x.fixtures.filter(id=>!next.fixtures.includes(id))}:x).filter(x=>x.fixtures.length);
    const id=shortId('fx');this.fx.push({...next,id,started:prev?.started??(args.fixtures?this.clock():next.started)});if(!args.fixtures)this.fxPreview=null;
    if(fade>0&&!prev)this.release={start:this.clock(),duration:fade,frames:{...(this.release?.frames??{}),...frames}};this.fading=null;created={fx:id};break;}
   case 'fx.stop':{
    const ids=args.ids??[...new Set(this.fx.flatMap(x=>x.fixtures))];this.ensureIds(ids);const fade=args.fade??this.show.playback.clearFade,frames=Object.fromEntries((this.programmed??[]).filter(s=>ids.includes(s.id)).map(s=>[s.id,copy(s)]));
    this.fx=this.fx.map(x=>({...x,fixtures:x.fixtures.filter(id=>!ids.includes(id))})).filter(x=>x.fixtures.length);
    if(fade>0&&Object.keys(frames).length)this.release={start:this.clock(),duration:fade,frames:{...(this.release?.frames??{}),...frames}};break;}
   case 'cue.record':{
    // Update merges the programmer (or blind buffer) into a cue; a new id saves a copy of the base cue plus the changes.
    const src=this.blind?this.blindOverrides:this.overrides,fx=this.blind?[]:this.fx,ids=Object.keys(src),mode=args.mode??'merge',existing=this.show.cues.find(c=>c.id===args.id);
    if(args.from&&!this.show.cues.some(c=>c.id===args.from))throw Error('Unknown cue '+args.from);
    const base=existing??(args.from?this.show.cues.find(c=>c.id===args.from):this.playback?.cue&&this.show.cues.find(c=>c.id===this.playback.cue.id));
    let cue;const fam=args.only&&args.only.length<4?new Set(args.only.flatMap(f=>ATTRIBUTE_FAMILIES[f])):null,pick=v=>fam?Object.fromEntries(Object.entries(v).filter(([k])=>fam.has(k))):v,kept=l=>l.map(e=>({...e,values:pick(e.values)})).filter(e=>Object.keys(e.values).length);
    // changes:true saves a new cue holding only the programmer's changes, played over whatever runs underneath (cue.only).
    if(args.changes&&!existing){const look=kept(ids.map(id=>({id,values:copy(src[id])})));if(!look.length&&!fx.length)throw Error('No changes to record — adjust fixtures or add an effect first');
     cue={id:args.id,name:args.name??'Changes',duration:30,loop:true,look,tracks:fx.map(f=>({fixtures:[...f.fixtures],layer:f.layer,effect:f.effect,start:0,duration:30,params:copy(f.params),fadeIn:0,fadeOut:0})),only:args.only??Object.keys(ATTRIBUTE_FAMILIES)}}
    else if(mode==='replace'||!base){const own=existing?[...(existing.look??[]).map(e=>e.id),...existing.tracks.flatMap(t=>trackFixtures(this.show,t))]:[],snap=this.snapshotLook({withoutFx:true}),look=args.all?snap:this.activeLook(snap,own);if(!look.length)throw Error('Nothing is lit or changed to record');cue={...(existing?copy(existing):{id:args.id,name:args.name??'Recorded look',duration:30,loop:true}),tracks:[],look:kept(look),...(fam?{only:args.only}:{})};if(!cue.look.length)throw Error('Nothing in those parts to record');
     // Programmer effects running on the look are saved as effects on the cue, not as the frame they happened to be at.
     cue.tracks=fx.map(f=>({fixtures:[...f.fixtures],layer:f.layer,effect:f.effect,start:0,duration:cue.duration,params:copy(f.params),fadeIn:0,fadeOut:0}))}
    else{
     if(!ids.length&&!fx.length)throw Error('No changes to record — adjust fixtures or add an effect first');
     cue=copy(base);if(!existing){cue.id=args.id;cue.name=args.name??base.name+' · copy'}cue.look??=[];
     for(const id of ids){const values=pick(copy(src[id]));if(!Object.keys(values).length)continue;let e=cue.look.find(x=>x.id===id&&x.over);if(!e){e={id,values:{},over:true};cue.look.push(e)}if(values.color!==undefined&&values.colorWheel===undefined){delete e.values.colorWheel;delete e.values.colorWheel2}Object.assign(e.values,values)}
     for(const f of fx){cue.tracks=cue.tracks.filter(t=>!(t.layer===f.layer&&t.fixtures?.every(id=>f.fixtures.includes(id))));cue.tracks.push({fixtures:[...f.fixtures],layer:f.layer,effect:f.effect,start:0,duration:cue.duration,params:copy(f.params),fadeIn:0,fadeOut:0})}
    }
    if(args.name&&existing)cue.name=args.name;
    let entry;this.update(s=>{this.upsert(s.cues,cue);if(args.page)entry=this.appendEntry(s,args.page,cue.id,args.fade??0,args.after)});created={cue:cue.id,updated:!!existing,mode,...(entry?{entry}:{})};
    const clearProgrammer=()=>{if(this.blind)this.blindOverrides={};else{for(const id of ids)delete this.overrides[id];this.fx=[];this.release=null}};
    if(this.playback?.cue.id===cue.id){this.playback.cue=copy(cue);clearProgrammer()}
    else if(args.go&&entry){const page=this.show.pages.find(p=>p.id===args.page);this.goEntry(page,page.cues.findIndex(e=>e.id===entry),0);clearProgrammer()}
    break;}
   case 'look.copy':{const c=this.copyLook(args);this.inner=true;try{for(const set of c.sets)await this.command('fixture.set',{...set,...(args.fade===undefined?{}:{fade:args.fade})},{lean:true})}finally{this.inner=false}created={copied:c.copied,skipped:c.skipped};break}
   case 'override.undo':this.undoProgrammer(args.fade);created={remaining:this.undo.filter(u=>u.blind===this.blind).length};break;
   case 'show.undo':{const u=this.undoShow;if(!u||u.revision!==this.revision)throw Error('Nothing to undo: no edit since the show was opened, or its media is gone. Older states are in show.versions.');const label=u.label,prev=u.show,redo=label.startsWith('undo of ');this.editing=redo?label.slice(8):'undo of '+label;this.update(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,copy(prev))});
    for(const id of [...this.flashes.keys()])if(!this.show.masters.slots.some(m=>m.id===id&&m.cue===this.flashes.get(id)))this.flashes.delete(id);if(this.stack&&!this.show.pages.some(p=>p.id===this.stack.page))this.stack=null;this.selection={ids:this.selection.ids.filter(id=>fixtureIndex(this.show).has(id)),group:this.show.groups.some(g=>g.id===this.selection.group)||this.selection.group==='all'?this.selection.group:null,revision:this.selection.revision+1};for(const id of Object.keys(this.overrides))if(!fixtureIndex(this.show).has(id))delete this.overrides[id];
    created=redo?{redone:label.slice(8)}:{undone:label};this.log((redo?'Redid · ':'Undid · ')+(redo?label.slice(8):label));break}
   case 'blind.set':this.blind=args.enabled;this.blindRelease=null;break;
   case 'settings.set':this.update(s=>Object.assign(s.playback,args));break;
   case 'blind.apply':{
    // Blind changes join the live programmer, fading from what is live now (same blend as a release).
    const ids=Object.keys(this.blindOverrides);if(!ids.length)throw Error('No blind changes to apply');const fade=args.fade??this.show.playback.blindFade;
    const frames=Object.fromEntries((this.programmed??[]).filter(s=>ids.includes(s.id)).map(s=>[s.id,copy(s)]));
    for(const id of ids)this.overrides[id]={...(this.overrides[id]??{}),...this.blindOverrides[id]};this.blindOverrides={};this.fading=null;
    if(fade>0)this.release={start:this.clock(),duration:fade,frames:{...(this.release?.frames??{}),...frames}};break;}
   case 'preview.go_live':{
    const p=this.preview;if(!p)throw Error('Nothing in preview');if(!p.saved)throw Error('Save this cue before sending it live');
    if(args.requestId&&this.requests.has(args.requestId))return {ok:true,duplicate:true,runtime:this.runtime()};
    if(p.page){const page=this.show.pages.find(x=>x.id===p.page),index=page?.cues.findIndex(e=>e.id===p.entry)??-1;if(index<0)throw Error('Previewed entry no longer exists');this.goEntry(page,index,args.fade)}
    else{const cue=this.show.cues.find(c=>c.id===p.cue.id);if(!cue)throw Error('Previewed cue no longer exists');this.overrides={};this.fx=[];this.release=null;this.stack=null;this.startCue(cue,{fade:args.fade??2})}
    if(args.requestId){this.requests.set(args.requestId,this.clock());if(this.requests.size>1000)this.requests.delete(this.requests.keys().next().value)}
    this.preview=null;break;}
   case 'page.release':{const page=this.show.pages.find(p=>p.id===args.id);if(!page)throw Error('Unknown page');const on=new Set(page.cues.map(e=>e.cue)),list=this.running().filter(r=>on.has(r.cue.id)&&!this.flashes.has(r.master));
    for(const r of list)this.releaseCue(r,args.fade??1.5);if(this.stack?.page===page.id)this.stack=null;created={released:list.map(r=>r.cue.id)};break;}
   case 'page.back':{const page=this.activePage();if(!page)throw Error('No active cue list');const index=this.stackIndex(page)-1;if(index<0)throw Error('Already at the first cue');this.goEntry(page,index,args.fade);break;}
   case 'override.release':{
    if(this.blind){const ids=(args.ids??Object.keys(this.blindOverrides)).filter(id=>this.blindOverrides[id]);this.ensureIds(ids);const fade=args.fade??this.show.playback.blindFade,frames=Object.fromEntries((this.blindStates??[]).filter(s=>ids.includes(s.id)).map(s=>[s.id,copy(s)]));for(const id of ids)delete this.blindOverrides[id];if(fade>0&&Object.keys(frames).length)this.blindRelease={start:this.clock(),duration:fade,frames:{...(this.blindRelease?.frames??{}),...frames}};break}
    const fxIds=new Set(this.fx.flatMap(x=>x.fixtures)),ids=args.ids??[...new Set([...Object.keys(this.overrides),...fxIds])];this.ensureIds(ids);const fade=args.fade??this.show.playback.clearFade,frames=Object.fromEntries((this.programmed??[]).filter(s=>ids.includes(s.id)&&(this.overrides[s.id]||fxIds.has(s.id))).map(s=>[s.id,copy(s)]));
    for(const id of ids)delete this.overrides[id];this.fx=this.fx.map(x=>({...x,fixtures:x.fixtures.filter(id=>!ids.includes(id))})).filter(x=>x.fixtures.length);
    if(fade>0&&Object.keys(frames).length)this.release={start:this.clock(),duration:fade,frames:{...(this.release?.frames??{}),...frames}};break;}
   case 'effect.apply':{
    const preset=this.presetById(args.preset),group=this.show.groups.find(g=>g.id===args.group);if(!group)throw Error('Unknown group');
    if(preset.movers&&!group.fixtures.some(id=>MOVING.includes(this.show.fixtures.find(f=>f.id===id)?.profile)))throw Error(preset.name+' needs moving heads in the group');
    const params={...preset.params};for(const k of ['color','secondary','speed','brightness'])if(args[k]!==undefined)params[k]=args[k];
    const duration=args.duration??preset.duration,id=args.id??shortId('cue'),fades=preset.effect==='fade'?0:.7;
    const cue={id,name:args.name??`${preset.name} · ${group.name}`,description:preset.description??`${preset.name} preset on ${group.name}.`,duration,loop:preset.loop,...(preset.hold?{hold:true}:{}),tracks:[{group:group.id,effect:preset.effect,start:0,duration,params,fadeIn:fades,fadeOut:preset.loop?fades:0}]};
    this.update(s=>{this.upsert(s.cues,cue);created={cue:id};if(args.page)created.entry=this.appendEntry(s,args.page,id,args.fade)});break;}
   case 'media.import':created={media:this.addMedia(args.path,args.name)};break;
   case 'media.delete':{const m=this.show.media.find(m=>m.id===args.id);if(!m)throw Error(BUILTIN_MEDIA.some(b=>b.id===args.id)?'Built-in media cannot be deleted':'Unknown media');this.update(s=>{s.media=s.media.filter(x=>x.id!==args.id);if(s.ledWall.media===args.id)s.ledWall.media='off'});if(this.dir)fs.rmSync(path.join(this.dir,'media',path.basename(m.src)),{force:true});this.undoShow=null;break;}
   case 'visualizer.hide':{if(!args.groups&&!args.fixtures)throw Error('Name groups and/or fixtures to hide or show');for(const g of args.groups??[])if(!this.show.groups.some(x=>x.id===g))throw Error('Unknown group '+g);this.ensureIds(args.fixtures??[]);
    this.update(s=>{const v=s.visualizer??={hiddenGroups:[],hiddenFixtures:[]},apply=(list,items)=>args.hidden?[...new Set([...list,...items])]:list.filter(x=>!items.includes(x));
     if(args.groups)v.hiddenGroups=apply(v.hiddenGroups,args.groups);if(args.fixtures)v.hiddenFixtures=apply(v.hiddenFixtures,args.fixtures);
     if(!args.hidden&&args.groups){const members=new Set(args.groups.flatMap(g=>s.groups.find(x=>x.id===g).fixtures));v.hiddenFixtures=v.hiddenFixtures.filter(id=>!members.has(id))}});
    created={visualizer:this.visualizerStatus()};break;}
   case 'ledwall.set':this.update(s=>Object.assign(s.ledWall,args));break;
   case 'master.set':this.master=args.value;break;
   case 'blackout.set':this.blackout=args.enabled;break;
   case 'output.configure':validateNetwork(args);this.update(s=>Object.assign(s.settings,args));break;
   // keepLook sends the look as it is (cues, masters, manual changes): after a restart or a network fault the operator gets
   // the same look back in one action, with no stop-and-replay gap. Without it, arming with anything running is refused.
   case 'output.arm':if(!args.keepLook&&(this.playback||this.layers.length||Object.keys(this.overrides).length||this.fx.length||this.fading||this.transition||this.release))throw Error('Stop preview and clear overrides before arming, or arm with keepLook:true to send the running cues, masters and manual changes as they are (what the preview shows).');
    await this.output.arm(this.show.settings);if(args.keepLook&&this.running().length)this.log(`Armed with the current look · ${this.running().map(r=>r.cue.name).join(', ')}`);break;
   case 'output.disarm':await this.disarm();break;
  }
  if(QUIET.has(name))this.tally(name,args.slot??(args.ids?.length===1?args.ids[0]:args.ids?args.ids.length+' fixtures':undefined));else this.log(`${name}${args.id?' · '+args.id:''}${args.slot?' · '+args.slot:''}${args.cue?.name?' · '+args.cue.name:''}${args.page?.name?' · '+args.page.name:''}`);this.safeTick();this.keepAwake(this.output.armed);this.live.schedule(()=>this.liveSnapshot());this.mods?.changed();return {ok:true,...(created?{created}:{}),...(lean?{}:{runtime:this.runtime()})};
 }
// Modules (docs/MIDI-AND-SOUND.md) are imported only while one is on; when none is, nothing of them exists.
 async syncModules(){
  const m=this.show.settings.modules??{},on=!!(m.sound?.enabled||m.midi?.enabled);
  if(on&&!this.mods){const v=this.modsVersion?'?v='+this.modsVersion:'',{Modules}=await import('./modules/index.mjs'+v);this.mods=new Modules(this,v)}
  if(this.mods){if(on)await this.mods.apply(m);else{await this.mods.close();this.mods=null;this.log('Modules off')}}
 }
 moduleOff(name){return `The ${name==='sound'?'sound':'MIDI'} module is off: turn it on with modules.set {${name}:{enabled:true}}.`}
 modulesStatus(){const m=this.show.settings.modules??{};return {version:this.modsVersion??0,sound:{enabled:!!m.sound?.enabled,device:m.sound?.device??null,inputs:this.show.audioInputs??[],...(this.mods?.sound?.summary()??{})},midi:{enabled:!!m.midi?.enabled,virtualPort:m.midi?.virtualPort!==false,...(this.mods?.midi?.summary()??{})},helper:this.mods?.io?.summary()??{running:false}}}
 // What is live, for a resume after a crash or restart (docs/SHOW-SAFETY.md): every running cue with its position, master
 // levels, the programmer and its effects, kills and blackout as well as the scene, page, master, tempo and lock.
 liveSnapshot(){const st=this.stack;return {clean:false,at:new Date().toISOString(),armed:!!this.output.armed,scene:this.scene?.id??null,stack:st?{page:st.page,entry:st.entry}:null,master:this.master,tempo:this.tempo.bpm,locked:this.locked,
  // A cue a held flash started (a key or a sound hit) is a moment, not part of the look: resumed, nothing would let go of
  // it. A follow trigger's cue comes back with the sound itself.
  running:this.running().filter(r=>!(r.master&&(this.flashes.get(r.master)===r.cue.id||this.followSlot(r.master)))).map(r=>({cue:r.cue.id,...(r.master?{master:r.master}:{}),...(r.page?{page:r.page,entry:r.entry}:{}),at:+this.sourceTime(r,true).toFixed(3),...(r.paused?{paused:true}:{})})),
  levels:Object.fromEntries([...this.levels].filter(([id])=>!this.followSlot(id))),faderOwned:[...this.faderOwned].filter(id=>!this.followSlot(id)),overrides:this.overrides,fx:this.fx.map(({started,...x})=>x),kills:[...this.kills.values()],blackout:this.blackout}}
 followSlot(id){const s=this.show.masters.slots.find(m=>m.id===id)?.sound;return s?.mode==='follow'&&s.enabled!==false}
 // Put back what liveSnapshot saved, without firing any cue's sends (no MIDI note to ProPresenter, no Look Link): the
 // show already did them. Cues start where they were, oldest first, so the look matches what the rig held.
 restoreLive(r){
  const index=fixtureIndex(this.show),cues=new Map(this.show.cues.map(c=>[c.id,c])),missing=[];
  const list=r.running??(r.stack?[{cue:this.show.pages.find(p=>p.id===r.stack.page)?.cues.find(e=>e.id===r.stack.entry)?.cue,page:r.stack.page,entry:r.stack.entry,at:0}]:[]);
  for(const x of list){const cue=cues.get(x.cue);if(x.master&&this.followSlot(x.master))continue;if(!cue){if(x.cue)missing.push(x.cue);continue}this.startCue(cue,{keep:true});const p=this.playback;p.offset=Math.max(0,x.at??0);p.started=this.clock();p.paused=!!x.paused;if(x.master)p.master=x.master;if(x.page){p.page=x.page;p.entry=x.entry}}
  const pg=r.stack&&this.show.pages.find(p=>p.id===r.stack.page),i=pg?pg.cues.findIndex(e=>e.id===r.stack.entry):-1;if(i>=0)this.stack={page:pg.id,entry:r.stack.entry,index:i};
  const slots=new Set(this.show.masters.slots.map(m=>m.id));this.levels=new Map(Object.entries(r.levels??{}).filter(([id])=>slots.has(id)&&!this.followSlot(id)));this.faderOwned=new Set((r.faderOwned??[]).filter(id=>slots.has(id)&&!this.followSlot(id)));
  this.overrides=Object.fromEntries(Object.entries(r.overrides??{}).filter(([id])=>index.has(id)));
  this.fx=(r.fx??[]).map(x=>({...x,fixtures:x.fixtures.filter(id=>index.has(id)),started:this.clock()})).filter(x=>x.fixtures.length&&EFFECTS[x.effect]);
  for(const k of r.kills??[])if(k.group?this.show.groups.some(g=>g.id===k.group):slots.has(k.slot))this.kills.set(k.group?'group:'+k.group:'slot:'+k.slot,k);this.killVersion++;
  this.blackout=!!r.blackout;return {cues:list.length-missing.length,missing};
 }
 resumeStatus(){const r=this.resume;if(!r)return null;const pg=r.stack&&this.show.pages.find(p=>p.id===r.stack.page),i=pg?pg.cues.findIndex(e=>e.id===r.stack.entry):-1,e=i>=0?pg.cues[i]:null;
  return {at:r.at,reason:r.reason??'crash',armed:!!r.armed,scene:this.show.scenes.find(s=>s.id===r.scene)?.name??null,page:pg?.name??null,cue:e?{number:i+1,name:e.label??this.show.cues.find(c=>c.id===e.cue)?.name??e.cue}:null,master:r.master,tempo:r.tempo??null,
   running:(r.running??[]).map(x=>this.show.cues.find(c=>c.id===x.cue)?.name??x.cue),overrides:Object.keys(r.overrides??{}).length,effects:(r.fx??[]).length,kills:(r.kills??[]).length,blackout:!!r.blackout}}
 resetLive(){this.selection={ids:[],group:'all',revision:this.selection.revision+1};this.preview=null;this.blind=false;this.blindOverrides={};this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.held=null;this.fading=null;this.transition=null;this.release=null;this.stack=null;this.blackout=false;this.scene=null;this.flashes.clear();this.bumps.clear();this.levels.clear();this.faderOwned.clear();this.undo=[]}
 // Pre-show check: one list of what to look at before doors. Sends no DMX.
 async showCheck({network=true}={}){
  const rows=[],add=(id,label,state,detail)=>rows.push({id,label,state,detail}),out=this.outputStatus(),rep=this.patchReport();
  if(network){const c=await(this.output.check?this.output.check(this.show.settings):checkConnection(this.show.settings));this.lastCheck=c;add('network','Art-Net path to '+this.show.settings.target,c.ok?'pass':'fail',c.ok?'Source, subnet, ping and ArtPoll all answered':(c.steps.find(x=>!x.ok)?.label??'The check failed')+' Open Settings → Art-Net output for every step.')}
  add('output','Output',out.failing?'fail':out.armed?'pass':'warn',out.failing?`Armed, but sends are failing: ${out.lastError??'unknown error'}`:out.armed?'Armed and sending':'Off: arm it before the show');
  if(this.engineError&&this.tickFails)add('engine','Engine','fail',`Frames are failing (${this.engineError.count}×) since ${this.engineError.at}: ${this.engineError.message}`);
  const unrouted=rep.fixtures.filter(f=>f.state==='unrouted').length,unverified=rep.fixtures.filter(f=>f.enabled&&f.state==='unverified').length,enabled=rep.fixtures.filter(f=>f.enabled).length;
  add('routing','Universes routed',unrouted?'fail':'pass',unrouted?`${unrouted} fixtures are on a universe with no Art-Net route`:`${rep.universes.filter(u=>u.artnet!==null).length} universes routed`);
  add('fixtures','Fixtures',unverified?'warn':'pass',`${enabled} enabled`+(unverified?` · ${unverified} unverified (preview only, never sent)`:''));
  const v=this.versions.list()[0],diskErr=this.versions.error??this.live.error??this.files.error;add('saved','Show saved',!this.dir?'warn':diskErr?'fail':'pass',!this.dir?'No data folder: nothing is saved':diskErr?`A safety copy could not be written: ${diskErr}`:v?`Latest version ${v.at}`:'Saved; no version yet');
  add('lock','Performance lock',this.locked?'pass':'warn',this.locked?'On':'Off: lock the show before it starts');
  if(this.awakeEnabled)add('awake','Mac kept awake',this.output.armed?(this.awake&&this.awake!=='starting'?'pass':'warn'):'pass',this.output.armed?(this.awake&&this.awake!=='starting'?'Sleep is held off while output is armed':'Could not hold sleep off: set this Mac to never sleep in System Settings'):'Held awake automatically once output is armed');
  add('saving','Saving to disk',this.saveError?'fail':'pass',this.saveError?`Edits are not reaching the disk: ${this.saveError}`:'Show edits are written to disk');
  const strobes=this.show.cues.flatMap(c=>this.strobeIssues(c,(c.speed??1)));add('strobe','Strobe rates',strobes.length?'warn':'pass',strobes.length?strobes.join(' '):'Every strobe flashes for at least two frames');
  const lim=this.show.limits??[];add('limits','Intensity limits',lim.length?'pass':'warn',lim.length?lim.map(l=>`${this.show.groups.find(g=>g.id===l.group)?.name??l.group} at most ${Math.round(l.max*100)}% (${this.show.groups.find(g=>g.id===l.group)?.fixtures.length??0} fixtures)`).join(' · '):'None: no group is capped (limit.set)');
  const shared=this.mastersReport().shared;add('masters','Masters sharing a cue',shared.length?'warn':'pass',shared.length?shared.map(x=>x.warning).join(' '):'Every master has its own cue');
  add('timing','Engine timing',this.dropped>10?'warn':'pass',this.dropped?`${this.dropped} slow frames since start`:'No slow frames');
  if(this.mods)rows.push(...this.mods.checks());
  const rig=this.show.pages.find(p=>/rig/i.test(p.id+' '+p.name)&&p.cues.length);add('rig','Rig check',rig?'pass':'warn',rig?`Page “${rig.name}” is ready to run`:'No rig check page with a cue');
  return {ok:!rows.some(r=>r.state==='fail'),rows,at:new Date().toISOString()};
 }
 // A frame that cannot be built must never take the rig down (docs/SHOW-SAFETY.md). Output stays armed and the last good
 // frame keeps going out; if the fault lasts, the newest things running are let go one at a time (previews, programmer
 // effects, then cues from the newest down, then the programmer) until frames build again. Logged once per fault, not per frame.
 safeTick(){
  try{this.tick();this.tickFails=0;if(this.afterTick)try{this.afterTick()}catch{}return true}
  catch(e){
   const n=this.tickFails=(this.tickFails??0)+1,now=Date.now(),prev=this.engineError;this.engineError={message:String(e?.message??e),at:new Date().toISOString(),count:(prev?.count??0)+1};
   if(prev?.message!==this.engineError.message||now-(this.engineErrorLogged??0)>10000){this.engineErrorLogged=now;this.log('Engine error: '+this.engineError.message+' · output keeps the last good frame')}
   try{if(this.output.armed&&this.lastPackets)this.output.send(this.lastPackets)}catch{}
   if(n%3===0){let dropped=null;
    if(this.preview||this.fxPreview||this.blind){this.preview=null;this.fxPreview=null;this.blind=false;this.blindOverrides={};this.blindRelease=null;dropped='the preview'}
    else if(this.fx.length){this.fx=[];dropped='programmer effects'}
    else if(this.playback){dropped='cue '+this.playback.cue.name;for(const [slot,cue] of this.flashes)if(cue===this.playback.cue.id)this.flashes.delete(slot);this.playback=this.layers.pop()??null;this.transition=null;if(!this.playback){this.stack=null;if(!this.scene)this.held=(this.frames??[]).map(f=>({...f,intensity:0}))}}
    else if(Object.keys(this.overrides).length||this.release){this.overrides={};this.release=null;dropped='the programmer'}
    else if(this.transition||this.fading){this.transition=null;this.fading=null;dropped='the running fade'}
    else if(this.scene){dropped='scene '+this.scene.name;this.scene=null}
    if(dropped)this.log(`Engine error persists: stopped ${dropped} to recover`)}
   return false}
 }
 start(){this.live.write(this.liveSnapshot());this.syncModules().catch(e=>this.log('Modules: '+e.message));this.autosaveTimer=setInterval(()=>this.autosaveTick(),5000);this.autosaveTimer.unref?.();this.timer=setInterval(()=>this.safeTick(),1000/30)}
 // Stopping the engine blacks out the rig first, unless show.playback.holdOnStop is false: by default the last packets stand (docs/SHOW-SAFETY.md).
 async close(){clearInterval(this.timer);clearInterval(this.autosaveTimer);this.flushTally();this.keepAwake(false);await this.assistant.close();this.live.close({...this.liveSnapshot(),...(this.show.playback.holdOnStop!==false&&this.output.armed?{held:true}:{})});await this.mods?.close();this.mods=null;if(this.show.playback.holdOnStop!==false&&this.output.armed){this.log('Engine stopped · output left at the last look (keep the last look on stop)');this.output.close()}else await this.disarm();const audit=this.audit;this.audit=null;await new Promise(r=>audit?audit.end(r):r())}
}
