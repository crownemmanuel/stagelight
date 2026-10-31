import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {defaults,migrate,syncGroups,zoneFixtures,fixtureIndex,EFFECTS,PROFILE_DEFS,EFFECT_PRESETS,BUILTIN_MEDIA} from './model.mjs';
import {LOOK_PROTOCOL,measure,lookSnap,lookDiffers,CHANGE,STILL} from './look.mjs';
import crypto from 'node:crypto';
import {ICONS} from '../public/icons.js';
import {outputRGB} from '../public/fixture-colors.js';
import {hiddenFixtureIds} from '../public/visibility.js';
import {OSC_ADDRESSES} from './osc-routes.mjs';
import {COMMANDS,SHOW_EDITS,validate,validateShow,validateWheelAttributes,groupDescendants} from './spec.mjs';
import {Versions,LiveState} from './safety.mjs';
import {render,compose,applyOverrides,finish,blend,blendState,encode,layerEffect,trackFixtures} from './render.mjs';
import {Output,validateNetwork,checkConnection} from './output.mjs';
const copy=x=>structuredClone(x);
// Master slots and their keys (show.masters). A key is on one slot or one desk shortcut at most.
const DESK_KEYS={highlight:'Highlight',clear:'Clear',blackout:'Blackout',tap:'Tap tempo'};
const keyName=k=>k.split('+').map(p=>p.length===1?p.toUpperCase():p[0].toUpperCase()+p.slice(1)).join('+');
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
export class Engine{
 constructor({dataDir,output,clock=()=>performance.now()/1000}={}){
  this.dir=dataDir;this.clock=clock;this.logs=[];this.output=output??new Output(m=>this.log(m));this.show=defaults();const seed=new URL('../show-template.json',import.meta.url);if(fs.existsSync(seed)){this.show=migrate(JSON.parse(fs.readFileSync(seed,'utf8')));validateShow(this.show)}
  if(dataDir){fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'show.json');if(fs.existsSync(file)){const raw=JSON.parse(fs.readFileSync(file,'utf8')),added=!raw.pages;this.show=migrate(raw);validateShow(this.show);if(added)this.save()}else this.save();}
  this.layers=[];this.highlight=false;this.find=null;this.scene=null;this.flashes=new Map();this.bumps=new Set();this.tempo={bpm:null,source:null,taps:[],anchor:null};this.levels=new Map();this.faderOwned=new Set();this.mods=null;this.soundHolds=new Map();this.agents=new Map();this.net={in:[],out:[],count:{in:0,out:0,rejected:0},listener:{listening:false},presets:{}};this.looks=new Map();this.presetBursts=new Map();this.presetAsks=new Map();this.sendHook=null;this.onNetworkChange=null;this.selection={ids:[],group:'backlights',revision:0};this.lampCommands=new Map();this.revision=1;this.playback=null;this.overrides={};this.fx=[];this.master=.8;this.blackout=false;this.held=null;this.fading=null;this.transition=null;this.stack=null;this.release=null;this.programmed=null;this.raw=null;this.preview=null;this.previewFrames=null;this.blind=false;this.blindOverrides={};this.blindRelease=null;this.blindStates=null;this.fxPreview=null;this.requests=new Map();this.listeners=new Set();this.tickCount=0;this.dropped=0;this.lastTick=null;this.frames=render(this.show,null,0);this.log('Engine ready in preview. Physical output is disarmed.');
  // Show safety (docs/SHOW-SAFETY.md): the lock survives a restart; an unclean live-state file becomes an offer to resume.
  this.versions=new Versions(dataDir,()=>this.clock());this.live=new LiveState(dataDir);const prev=this.live.read();this.locked=!!prev?.locked;
  this.resume=prev&&!prev.clean&&(prev.armed||prev.scene||prev.stack)?prev:null;if(this.resume)this.log('The engine restarted unexpectedly during a show: offering to resume.');
 }
 save(){if(!this.dir)return;const f=path.join(this.dir,'show.json');fs.writeFileSync(f+'.tmp',JSON.stringify(this.show,null,2));fs.renameSync(f+'.tmp',f)}
 // Audit log is append-only and asynchronous so a GO never waits on the disk; rotates at ~2 MB.
 log(message){const row={at:new Date().toISOString(),message};this.logs.push(row);if(this.logs.length>120)this.logs.shift();if(!this.dir)return;
  const f=path.join(this.dir,'audit.jsonl'),line=JSON.stringify(row)+'\n';
  if(!this.audit){this.auditBytes=fs.existsSync(f)?fs.statSync(f).size:0;this.audit=fs.createWriteStream(f,{flags:'a'});this.audit.on('error',()=>{this.audit=null})}
  if(this.auditBytes>2e6){const old=this.audit;this.audit=null;old.end(()=>{try{fs.renameSync(f,f+'.previous')}catch{}});this.auditBytes=0;this.audit=fs.createWriteStream(f,{flags:'a'});this.audit.on('error',()=>{this.audit=null})}
  this.auditBytes+=line.length;this.audit?.write(line)}
 elapsed(){return this.playback?this.sourceTime(this.playback,true):0}
 tick(){
  const now=this.clock();if(this.lastTick!==null&&now-this.lastTick>.1)this.dropped++;this.lastTick=now;this.tickCount++;
  this.follow();
  this.layers=this.layers.filter(l=>{const c=l.cue,done=!c.loop&&!c.hold&&this.sourceTime(l,true)>=c.duration;if(done){this.log(`Cue complete underneath · ${c.name}`);this.mods?.changed()}return !done});
  let t=this.elapsed();let cue=this.playback?.cue;
  if(cue&&t>=cue.duration){if(cue.loop)t%=cue.duration;else if(cue.hold)t=cue.duration-1e-6;else{if(!this.scene)this.held=copy(this.frames).map(f=>({...f,intensity:0}));else if(!this.layers.length)this.toFloor(this.sceneFade(),copy(this.raw??this.frames));this.log(`Cue complete · ${cue.name}`+(this.layers.length?'; the cue underneath takes over':this.scene?`; back to scene ${this.scene.name}`:'; intensity zero, final positions held.'));this.playback=this.layers.pop()??null;if(!this.playback)this.stack=null;cue=this.playback?.cue??null;this.mods?.changed();t=cue?this.sourceTime(this.playback):0}}
  let base=cue?this.composite(this.playback,this.layers):this.held?copy(this.held):this.floor();
  if(this.transition){const tr=this.transition,k=Math.min(1,(now-tr.start)/Math.max(.001,tr.duration));base=blend(tr.from.cue?this.composite(tr.from,tr.from.layers??[]):tr.from.frames,base,k);if(k>=1)this.transition=null}
  this.raw=base;let states=this.applyFx(applyOverrides(this.show,base,this.overrides),this.fx,now);
  if(this.release){const r=this.release,k=Math.min(1,(now-r.start)/Math.max(.001,r.duration));states=states.map(s=>r.frames[s.id]?blendState(r.frames[s.id],s,k):s);if(k>=1)this.release=null}
  this.programmed=states;this.frames=finish(this.show,this.highlighted(states),this.master,this.blackout);
  this.previewFrames=this.preview||this.blind||this.fxPreview?this.renderPreview(now):null;
  if(this.fading){const factor=Math.max(0,1-(now-this.fading.start)/Math.max(.001,this.fading.duration));this.frames=this.fading.frames.map(f=>({...f,intensity:this.blackout?0:f.intensity*factor}));if(factor===0){this.held=copy(this.frames);this.fading=null}}
  // Parked fixtures (docs/PARK.md) hold their captured output over cues, programmer, Highlight and master; blackout still wins.
  if(this.show.parked?.length){const pk=this.parkIndex();this.frames=this.frames.map(f=>{const p=pk.get(f.id);return p?{...p,id:f.id,intensity:this.blackout?0:p.intensity}:f})}
  // Packets are only built while they can be sent; the patch sheet encodes its own readback.
  const packets=this.output.armed?encode(this.show,this.frames,{physical:true}):new Map();
  for(const [id,pulse] of this.lampCommands){
   if(!this.output.armed||now>=pulse.until){this.lampCommands.delete(id);continue}
   const fixture=this.show.fixtures.find(f=>f.id===id);
   const packet=packets.get(this.show.settings.mappings[fixture.universe]);
   const control=PROFILE_DEFS[fixture.profile].lampControl;
   if(packet)packet[fixture.address+control.channel-2]=control[pulse.action];
  }
  this.output.send(packets);
  this.watchLooks();
  for(const f of this.listeners)f();
 }
 sourceTime(p,raw=false){const cue=p.cue,t=p.paused?p.offset:p.offset+(this.clock()-p.started)*(p.rate??1);return raw?t:cue.loop?t%cue.duration:Math.min(t,cue.duration-1e-6)}
 // Restart a running cue's clock where it is now, so a pause, a seek or a tempo change never makes it jump.
 rebase(r){r.offset=this.sourceTime(r,true);r.started=this.clock()}
 // Tap tempo (docs/MIDI-AND-SOUND.md): a cue with a bpm plays at live tempo / its bpm, so its tracks, effect speeds,
 // loops and auto-follow waits all scale together. Crossfades stay in real seconds.
 rateFor(cue){const b=cue.bpm,t=this.tempo.bpm;return b&&t?t/b:1}
 setTempo(bpm,source){
  for(const r of this.running())this.rebase(r);this.tempo.bpm=bpm?Math.round(Math.max(20,Math.min(400,bpm))*100)/100:null;this.tempo.source=this.tempo.bpm?source:null;
  if(!this.tempo.bpm)this.tempo.taps=[];for(const r of this.running())r.rate=this.rateFor(r.cue);
 }
 tempoBase(){return this.tempo.bpm??this.playback?.cue.bpm??this.running().find(r=>r.cue.bpm)?.cue.bpm??120}
 tapTempo(){
  const now=this.clock(),t=this.tempo;if(t.taps.length&&now-t.taps.at(-1)>2)t.taps=[];t.taps.push(now);if(t.taps.length>5)t.taps.shift();t.anchor=now;
  if(t.taps.length>=2)this.setTempo(60*(t.taps.length-1)/(t.taps.at(-1)-t.taps[0]),'tap');
 }
 tempoStatus(){const t=this.tempo,top=this.playback;return {bpm:t.bpm,source:t.source,cue:top?.cue.bpm??null,rate:top?+(top.rate??1).toFixed(4):1,anchorAgo:t.anchor===null?null:+(this.clock()-t.anchor).toFixed(3)}}
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
 composite(top,layers){
  [top,layers]=this.byPrecedence(top,layers);
  const states=compose(this.show,top.cue,this.sourceTime(top)),floor=this.scene&&this.floor(),dim=r=>!r.master||!this.levels.size||this.flashes.get(r.master)===r.cue.id||this.bumps.has(r.master)?1:this.levels.get(r.master)??1;
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
  const taken=new Set(this.playback?.controls??[]),keep=[];
  // A cue held by a master (its key or fader) is never retired by being covered: it stays underneath, ready to show again.
  for(let i=this.layers.length-1;i>=0;i--){const l=this.layers[i],own=!!l.master||[...l.controls].some(id=>!taken.has(id));if(own&&keep.length<7)keep.unshift(l);else this.log(`Cue retired · ${l.cue.name} (every fixture taken by newer cues)`);for(const id of l.controls)taken.add(id)}
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
 releaseCue(r,fade=1.5){
  if(fade>0)this.transition={start:this.clock(),duration:fade,from:this.playback?{...this.playback,layers:[...this.layers]}:{frames:copy(this.raw??this.frames)}};
  if(r===this.playback){this.playback=this.layers.pop()??null;if(!this.playback){if(!this.scene)this.held=copy(this.raw??this.frames).map(f=>({...f,intensity:0}));if(fade>0)this.transition.from={frames:copy(this.raw??this.frames)}}}
  else this.layers=this.layers.filter(l=>l!==r);
  for(const [slot,cue] of this.flashes)if(cue===r.cue.id)this.flashes.delete(slot);
  this.log(`Released · ${r.cue.name}`+(this.playback?` · ${this.playback.cue.name} carries on`:this.scene?` · back to scene ${this.scene.name}`:' · nothing else running, intensity to zero with positions held'));
 }
 // Masters (docs/MASTERS-AND-SCENES.md): a slot holds a cue and an action. Keyboard, mouse, MCP and OSC all press it here.
 // Cues start on top of whatever runs, keeping the programmer and the page stack. A flash only lets go of a cue it started.
 masterTrigger(id,down){
  const slots=this.show.masters.slots,slot=slots.find(x=>x.id===id);if(!slot)throw Error('Unknown master '+id);
  if(!slot.cue){if(down)throw Error(`Master ${slots.indexOf(slot)+1} has no cue`);return}
  const cue=this.show.cues.find(c=>c.id===slot.cue),run=this.running().find(l=>l.cue.id===slot.cue),fade=slot.fade??0;
  const start=(keep=false)=>{this.startCue(cue,{fade,keep});this.playback.master=slot.id};
  if(slot.midi)this.mods?.midi?.note(slot.midi,down);
  if(!down){if(slot.action==='flash'&&this.flashes.get(slot.id)===slot.cue){this.flashes.delete(slot.id);if(run)this.releaseCue(run,fade)}else this.bumps.delete(slot.id);return}
  // A held flash is the master at full and on top, whatever its fader says (like a Hog flash button). Over its own
  // cue that is already running (its fader started it) it bumps it to full and to the top until let go.
  if(slot.action==='flash'){if(!run){start(true);this.flashes.set(slot.id,cue.id)}else if(run.master===slot.id){this.bumps.add(slot.id);this.bringToTop(run)}}
  else if(slot.action==='toggle'){if(run)this.releaseCue(run,fade);else start()}
  else if(slot.action==='go')start();
  else if(slot.action==='pause'){if(run){this.rebase(run);run.paused=!run.paused;this.log(`${run.paused?'Paused':'Resumed'} · ${run.cue.name}`)}}
  else if(slot.action==='release'&&run)this.releaseCue(run,fade);
 }
 // Put a running cue on top without restarting it, so it wins every fixture it uses.
 bringToTop(run){if(run===this.playback)return;this.layers=this.layers.filter(l=>l!==run);if(this.playback)this.layers.push(this.playback);this.playback=run}
 mastersStatus(){const running=new Set(this.running().map(l=>l.cue.id));return {held:[...[...this.flashes].filter(([,cue])=>running.has(cue)).map(([slot])=>slot),...this.bumps],levels:Object.fromEntries(this.levels)}}
 // A master's level (its fader) scales the cue that master started. Like a Hog fader, raising it from zero starts the
 // cue and bringing it back to zero releases it, but only if the fader started it.
 masterLevel(id,level,go=true){
  const slot=this.show.masters.slots.find(x=>x.id===id);if(!slot)throw Error('Unknown master '+id);
  if(level>=1)this.levels.delete(id);else this.levels.set(id,level);if(!go||!slot.cue)return;
  const run=this.running().find(l=>l.cue.id===slot.cue);
  if(level>0&&!run){this.startCue(this.show.cues.find(c=>c.id===slot.cue),{fade:slot.fade??0});this.playback.master=slot.id;this.faderOwned.add(id)}
  else if(level===0&&run&&this.faderOwned.has(id)){this.faderOwned.delete(id);this.releaseCue(run,slot.fade??0)}
 }
 // A sound hit (sound module) presses the master and lets go after its hold; another hit during the hold extends it.
 soundHit(id){
  const slot=this.show.masters.slots.find(x=>x.id===id);if(!slot?.cue)return;const hold=slot.sound?.holdMs??80,held=this.soundHolds.get(id);
  if(slot.sound?.mode==='step'){try{this.stepMaster(id)}catch{}return}
  if(held)clearTimeout(held);else this.masterTrigger(id,true);
  const timer=setTimeout(()=>{this.soundHolds.delete(id);try{this.masterTrigger(id,false);this.tick();this.mods?.changed()}catch(e){this.log('Sound trigger: '+e.message)}},hold);timer.unref?.();this.soundHolds.set(id,timer);
 }
 // Note step (docs/MIDI-AND-SOUND.md): advance every step track of the master's running cue. The crossfade is 40% of
 // the time since the last step, at most 0.3 s, so slow playing glides and fast playing snaps. Only the running copy changes.
 stepMaster(id){
  const slot=this.show.masters.slots.find(x=>x.id===id),run=slot?.cue&&this.running().find(l=>l.cue.id===slot.cue);if(!run)throw Error(`Master ${id}'s cue is not running`);
  const now=this.sourceTime(run);
  for(const tr of run.cue.tracks)if(tr.effect==='step'){const p=tr.params,t=now-tr.start;p.stepFade=p.step===undefined?.15:Math.min(.3,Math.max(.03,.4*(t-(p.stepAt??t))));p.step=(p.step??-1)+1;p.stepAt=t}
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
  return finish(this.show,states,this.master,false);
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
 runtime(){return {agents:this.connectedAgents(),selection:copy(this.selection),lampCommands:Object.fromEntries([...this.lampCommands].map(([id,p])=>[id,{action:p.action,remaining:Math.max(0,p.until-this.clock())}])),revision:this.revision,running:this.runningStatus(),highlight:this.highlight,find:this.findStatus(),parked:(this.show.parked??[]).map(p=>p.id),tempo:this.tempoStatus(),locked:this.locked,resume:this.resumeStatus(),...(this.mods?.live()??{}),scene:this.scene?{id:this.scene.id,name:this.scene.name}:null,masters:this.mastersStatus(),playback:this.playback?{id:this.playback.cue.id,name:this.playback.cue.name,duration:this.playback.cue.duration,loop:this.playback.cue.loop,hold:!!this.playback.cue.hold,paused:this.playback.paused,elapsed:Math.min(this.elapsed()% (this.playback.cue.loop?this.playback.cue.duration:Infinity),this.playback.cue.duration)}:null,stack:this.stackStatus(),net:{in:this.net.count.in,out:this.net.count.out,rejected:this.net.count.rejected,listening:!!this.net.listener.listening,last:this.net.in[0]?.address??null},preview:this.previewStatus(),fx:this.fx.map(x=>this.fxSummary(x)),fxPreview:this.fxSummary(this.fxPreview),blind:{enabled:this.blind,fixtures:Object.keys(this.blindOverrides),overrides:this.blindOverrides,release:this.blindRelease?{fixtures:Object.keys(this.blindRelease.frames),progress:Math.min(1,(this.clock()-this.blindRelease.start)/Math.max(.001,this.blindRelease.duration))}:null},previewFrames:this.previewFrames,transition:this.transition?{from:this.transition.from.cue?.id??null,duration:this.transition.duration,progress:Math.min(1,(this.clock()-this.transition.start)/Math.max(.001,this.transition.duration))}:null,release:this.release?{fixtures:Object.keys(this.release.frames),progress:Math.min(1,(this.clock()-this.release.start)/Math.max(.001,this.release.duration))}:null,master:this.master,blackout:this.blackout,overrides:this.overrides,frames:this.frames,output:this.output.status(),tickCount:this.tickCount,slowFrames:this.dropped,logs:this.logs.slice(-15)}}
 snapshot(){return {show:copy(this.show),runtime:this.runtime()}}
 update(fn){const next=copy(this.show);fn(next);if(next.groups?.some(g=>g.children))syncGroups(next);validateShow(next);this.show=next;this.revision++;this.save();this.versions.edited(this.show)}
 appendEntry(s,pageId,cue,fade=2,after){const page=s.pages.find(p=>p.id===pageId);if(!page)throw Error('Unknown page');const id=shortId('entry'),at=after?page.cues.findIndex(e=>e.id===after):-1;page.cues.splice(at<0?page.cues.length:at+1,0,{id,cue,fade,follow:'manual'});return id}
 // What is seen right now (blind view while blind), with master removed, as look entries. Highlight is never recorded.
 // Cues record only what they light or what was changed (docs/MASTERS-AND-SCENES.md): a fixture at zero that nobody touched
 // stays out, so playing the cue never blacks out the rest of the rig. keep = extra IDs to keep (e.g. the cue's own). Scenes and
 // all:true still record every fixture.
 activeLook(look,keep=[]){const src=this.blind?this.blindOverrides:this.overrides,touched=new Set([...Object.keys(src),...(this.blind?[]:this.fx.flatMap(x=>x.fixtures)),...keep]);return look.filter(e=>e.values.intensity>.001||touched.has(e.id))}
 snapshotLook(){const seen=this.blind?this.previewFrames:this.highlight&&this.programmed?finish(this.show,this.programmed,this.master,this.blackout):this.frames;return seen.filter(f=>this.show.fixtures.some(x=>x.id===f.id&&x.enabled)).map(({id,...values})=>({id,values:{...values,intensity:this.master>0?Math.min(1,values.intensity/this.master):0,color:'#'+values.color.map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('')}}))}
 // Programmer effects: one per fixture per layer, layered on top of cue + overrides.
 applyFx(states,list,now){
  if(!list.length)return states;const byId=new Map(states.map(s=>[s.id,s])),fixtures=fixtureIndex(this.show);
  for(const fx of list){const t=now-fx.started;fx.fixtures.forEach((id,i)=>{const f=fixtures.get(id),st=byId.get(id);if(f&&st)byId.set(id,layerEffect(st,f,i,fx.fixtures.length,fx.effect,fx.params,t,this.show,fx.layer,1,fx.duration))})}
  return states.map(s=>byId.get(s.id));
 }
 // Built-in presets plus the show's custom ones; custom presets get their category from the effect's layer.
 allPresets(){
  const cat={intensity:'intensity',color:'color',position:'movement'};
  return {...Object.fromEntries(Object.entries(EFFECT_PRESETS).map(([k,v])=>[k,{...v,custom:false}])),...Object.fromEntries(this.show.presets.map(p=>{const layer=EFFECTS[p.effect].layer;return [p.id,{duration:20,loop:true,...copy(p),category:cat[layer],movers:layer==='position',custom:true}]}))};
 }
 presetById(id){const p=this.allPresets()[id];if(!p)throw Error('Unknown effect preset '+id);return p}
 resolveFx(args){
  const preset=args.preset?this.presetById(args.preset):null,effect=args.effect??preset?.effect;if(!effect)throw Error('Give a preset or an effect');
  const layer=args.layer??EFFECTS[effect].layer;if(!layer)throw Error(EFFECTS[effect].name+' cannot be layered on a look');
  this.ensureIds(args.fixtures);let fixtures=[...new Set(args.fixtures)].filter(id=>this.show.fixtures.find(f=>f.id===id).enabled);
  if(layer==='position'){fixtures=fixtures.filter(id=>MOVING.includes(this.show.fixtures.find(f=>f.id===id).profile));if(!fixtures.length)throw Error('Movement effects need moving heads in the selection')}
  if(!fixtures.length)throw Error('Select patched fixtures for this effect');
  const params={...(preset?.params??{}),...copy(args.params??{})};for(const id of fixtures)validateWheelAttributes(this.show.fixtures.find(f=>f.id===id),params);
  return {fixtures,effect,layer,params,preset:args.preset??null,name:preset?.name??EFFECTS[effect].name,duration:preset?.duration??20};
 }
 outputStatus(){const s=this.show.settings,o=this.output.status();return {armed:o.armed,source:s.source,target:s.target,port:s.port??6454,mappings:copy(s.mappings),packets:o.packets,lastSent:o.lastSent,lastError:o.lastError,armedAt:o.armedAt??null,receiver:o.receiver,interfaces:o.interfaces,lastCheck:this.lastCheck??null,note:o.armed?'Sending Art-Net. ArtDMX has no acknowledgment, so watch the rig.':'Output is disarmed: nothing is sent to the rig. Arm output (output.arm) to send Art-Net.'}}
 fxSummary(fx){return fx&&{id:fx.id,name:fx.name,preset:fx.preset,effect:fx.effect,layer:fx.layer,fixtures:fx.fixtures,params:fx.params}}
 upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i<0)list.push(copy(item));else list[i]=copy(item)}
 ensureIds(ids){for(const id of ids)if(!this.show.fixtures.some(f=>f.id===id))throw Error('Unknown fixture '+id)}
 async disarm(){this.lampCommands.clear();this.scene=null;this.flashes.clear();this.bumps.clear();const dark=copy(this.frames).map(f=>({...f,intensity:0}));this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.fading=null;this.transition=null;this.release=null;this.stack=null;this.held=copy(dark);this.frames=copy(dark);if(this.output.armed){for(let i=0;i<5;i++){this.output.send(encode(this.show,dark,{physical:true}));await new Promise(r=>setTimeout(r,34))}this.output.close();}this.playback=null;this.overrides={};this.fx=[];this.fading=null;this.held=copy(this.frames).map(f=>({...f,intensity:0}));this.frames=copy(this.held);this.log('Physical output stopped. Hog channel handback remains manual.')}
 // lean: skip building the full runtime in the reply (show-control triggers do not need it).
 async command(name,args={},{lean=false}={}){
  if(!Object.hasOwn(COMMANDS,name))throw Error('Unknown command '+name);const def=COMMANDS[name];validate(def.schema,args);
  // Sound trigger tuning (channel, band, sensitivity, hold, gap) is a live adjustment like a fader, so it stays open.
  const soundTuning=name==='masters.assign'&&Object.keys(args).every(k=>['slot','sound','clearSound'].includes(k));
  if(this.locked&&SHOW_EDITS.has(name)&&!soundTuning)throw Error('The performance lock is on: unlock it to change the show.');
  if(name==='show.versions')return {versions:this.versions.list()};if(name==='show.check')return this.showCheck(args);if(name==='modules.status')return this.modulesStatus();if(name==='sound.inputs')return {inputs:this.show.audioInputs??[]};
  if(['sound.status','midi.status'].includes(name)){const m=this.mods?.[name.split('.')[0]];if(!m)throw Error(this.moduleOff(name.split('.')[0]));return m.status()}
  if(name==='agent.hello'){const known=this.agents.get(args.session);this.agents.set(args.session,{session:args.session,client:args.client,version:args.version??'',connectedAt:known?.connectedAt??this.clock(),lastSeen:this.clock()});if(!known)this.log(`Agent connected · ${args.client}${args.version?' '+args.version:''}`);return {ok:true}}
  if(name==='status')return this.snapshot();if(name==='visualizer.status')return this.visualizerStatus();if(name==='patch.report')return this.patchReport();if(name==='network.status')return this.networkStatus();if(name==='look.report')return this.lookReport(args);
  if(name==='output.status')return this.outputStatus();if(name==='output.check'){const c={...this.show.settings,...Object.fromEntries(Object.entries(args).filter(([,v])=>v))};this.lastCheck=await(this.output.check?this.output.check(c):checkConnection(c));this.log(`Connection check · ${c.target} · ${this.lastCheck.ok?'all good':this.lastCheck.steps.filter(x=>!x.ok).map(x=>x.id).join(', ')+' failed'}`);return this.lastCheck}
  if(name==='target.presets'){const t=this.targetById(args.id);if(args.refresh)this.askPresets(t);return {target:t.id,requested:!!args.refresh,...(this.net.presets[t.id]??{at:null,presets:[]})}}
 if(name==='schema')return {version:1,commands:COMMANDS,profiles:PROFILE_DEFS,effects:EFFECTS,presets:this.allPresets(),icons:ICONS,media:BUILTIN_MEDIA};let created;
  if(this.output.armed&&['show.import','fixture.patch','output.configure','cue.seek','effect.preview'].includes(name))throw Error('Disarm physical output before this operation.');
  switch(name){
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
   case 'cue.save':this.update(s=>this.upsert(s.cues,args.cue));break;
   case 'cue.delete':this.update(s=>{s.cues=s.cues.filter(c=>c.id!==args.id);for(const p of s.pages)p.cues=p.cues.filter(e=>e.cue!==args.id);for(const m of s.masters.slots)if(m.cue===args.id)delete m.cue});break;
   case 'cue.play':{
    if(args.requestId&&this.requests.has(args.requestId))return {ok:true,duplicate:true,runtime:this.runtime()};
    const cue=this.show.cues.find(c=>c.id===args.id);if(!cue)throw Error('Unknown cue');
    this.overrides={};this.fx=[];this.release=null;this.stack=null;this.startCue(cue,{fade:args.fade??0});
    if(args.requestId){this.requests.set(args.requestId,this.clock());if(this.requests.size>1000)this.requests.delete(this.requests.keys().next().value)}break;}
   case 'cue.pause':{const r=args.id===undefined?this.playback:this.runningCue(args.id);if(r&&r.paused!==args.paused){this.rebase(r);r.paused=args.paused;this.log(`${args.paused?'Paused':'Resumed'} · ${r.cue.name}`)}break}
   case 'cue.release':this.releaseCue(this.runningCue(args.id),args.fade??1.5);break;
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
     if(args.color)m.color=args.color;if(args.clearColor)delete m.color;if(args.priority!==undefined){if(args.priority)m.priority=true;else delete m.priority}if(args.sound)m.sound=args.sound;if(args.clearSound)delete m.sound;if(args.midi)m.midi=args.midi;if(args.clearMidi)delete m.midi});
    if(args.clear||args.cue)this.flashes.delete(args.slot);if(args.sound||args.clearSound||args.clear)await this.mods?.sound?.configure();break}
   case 'masters.level':this.masterLevel(args.slot,args.level,args.go??true);break;
   case 'masters.sound':{const m=this.show.masters.slots.find(x=>x.id===args.slot);if(!m)throw Error('Unknown master '+args.slot);if(!m.sound)throw Error(`Master ${this.show.masters.slots.indexOf(m)+1} has no sound trigger: give it one in its editor first`);
    const on=args.enabled??m.sound.enabled===false;this.update(s=>{masterSlot(s,args.slot).sound.enabled=on});if(!on&&this.soundHolds.has(args.slot)){clearTimeout(this.soundHolds.get(args.slot));this.soundHolds.delete(args.slot);this.masterTrigger(args.slot,false)}
    this.mods?.sound?.configure();this.log(`Master ${this.show.masters.slots.indexOf(m)+1} sound trigger ${on?'on':'off'}`);created={slot:args.slot,sound:on};break}
   case 'tempo.tap':this.tapTempo();break;
   case 'tempo.set':this.setTempo(args.bpm??null,'set');break;
   case 'tempo.scale':this.setTempo(this.tempoBase()*args.factor,this.tempo.source??'set');break;
   case 'tempo.nudge':this.setTempo(this.tempoBase()+args.delta,this.tempo.source??'set');break;
   case 'performance.lock':if(args.enabled&&!this.locked)this.versions.snapshot(this.show,'performance-lock');this.locked=args.enabled;this.log(`Performance lock ${args.enabled?'on':'off'}`);break;
   case 'show.restore':{if(this.output.armed)throw Error('Disarm output before restoring a show version.');const next=migrate(this.versions.read(args.id));next.settings=copy(this.show.settings);validateShow(next);
    this.versions.snapshot(this.show,'before-restore');this.resetLive();this.update(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,next)});this.log('Show restored from version '+args.id);break}
   case 'resume.apply':{const r=this.resume;if(!r)throw Error('Nothing to resume');if(r.armed&&args.confirmation!=='ENABLE_PHYSICAL_OUTPUT')throw Error('Resuming re-arms output: pass confirmation ENABLE_PHYSICAL_OUTPUT');this.resume=null;
    if(r.tempo)this.setTempo(r.tempo,'resume');if(typeof r.master==='number')this.master=r.master;if(r.armed&&!this.output.armed)await this.output.arm(this.show.settings);
    const sc=r.scene&&this.show.scenes.find(s=>s.id===r.scene);if(sc)this.scene={id:sc.id,name:sc.name,rev:-1};
    const pg=r.stack&&this.show.pages.find(p=>p.id===r.stack.page),i=pg?pg.cues.findIndex(e=>e.id===r.stack.entry):-1;if(i>=0)this.goEntry(pg,i,0);
    this.log('Resumed after an unexpected restart'+(sc?' · scene '+sc.name:'')+(i>=0?` · ${pg.name} cue ${i+1}`:''));break}
   case 'resume.dismiss':this.resume=null;this.live.write(this.liveSnapshot());break;
   case 'sound.inputs.set':this.update(s=>{const m=new Map(args.replace?[]:(s.audioInputs??[]).map(a=>[a.channel,a.name]));for(const a of args.inputs){const n=a.name.trim();if(n)m.set(a.channel,n);else m.delete(a.channel)}s.audioInputs=[...m].sort((a,b)=>a[0]-b[0]).map(([channel,name])=>({channel,name}))});break;
   case 'modules.set':this.update(s=>{const m=s.settings.modules??={};if(args.sound)m.sound={...m.sound,...args.sound};if(args.midi)m.midi={...m.midi,...args.midi}});await this.syncModules();break;
   case 'sound.meter':case 'sound.test':case 'midi.test':case 'controller.test':{const which=name.startsWith('sound')?'sound':'midi',mod=this.mods?.[which];if(!mod)throw Error(this.moduleOff(which));created=await mod.command(name,args);break}
   case 'controller.save':this.update(s=>{const list=s.controllers??=[];let c=list.find(x=>x.id===args.id);if(!c)list.push(c={id:args.id,model:args.model??'apc40mk2',map:{}});Object.assign(c.map,args.map??{});for(const k of ['name','deskNumbers','deskColors'])if(args[k])c[k]=args[k]});this.mods?.changed(true);break;
   case 'controller.reset':this.update(s=>{s.controllers=(s.controllers??[]).filter(c=>c.id!==args.id)});this.mods?.changed(true);break;
   case 'masters.key':{if(!args.clear&&!args.key)throw Error('Give a key, or clear:true');this.update(s=>setMasterKey(s,args.slot,args.clear?null:args.key,args.conflict));break}
   case 'masters.save':this.update(s=>{if(args.slots)s.masters.slots=args.slots;if(args.desk)s.masters.desk=args.desk});for(const id of [...this.flashes.keys()])if(!this.show.masters.slots.some(m=>m.id===id&&m.cue===this.flashes.get(id)))this.flashes.delete(id);break;
   case 'effect.preview':{
    const cue={id:'ad-hoc',name:'Unsaved effect',duration:args.duration??20,loop:true,tracks:[{group:args.group,effect:args.effect,start:0,duration:args.duration??20,params:args.params,fadeIn:.5,fadeOut:.5}]};
    const probe=copy(this.show);probe.cues.push(cue);validateShow(probe);this.overrides={};this.fx=[];this.release=null;this.stack=null;this.startCue(cue);break;}
   case 'effect.save':if(!this.show.groups.some(g=>g.id===args.group))throw Error('Unknown group');this.update(s=>this.upsert(s.effects,args));break;
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
   case 'fixture.set':this.ensureIds(args.ids);for(const id of args.ids)validateWheelAttributes(this.show.fixtures.find(f=>f.id===id),args.values);for(const id of args.ids)if(this.show.fixtures.find(f=>f.id===id).profile==='beam200'&&args.values.prism>1)throw Error('200W Beam supports one 3-face prism (0 or 1).');for(const id of args.ids){if(this.show.fixtures.find(f=>f.id===id).profile==='beam7r'&&(args.values.prism>1||args.values.gobo>14))throw Error('7R supports one 8-face prism and static gobos 0–14');if(this.show.fixtures.find(f=>f.id===id).profile==='mh7'&&(args.values.prism===3||args.values.gobo>12))throw Error('MH7 supports one prism at a time and static gobos 0–12');}const buffer=this.blind?this.blindOverrides:this.overrides;for(const id of args.ids){const next={...(buffer[id]??{})};if(args.values.color!==undefined){delete next.colorWheel;delete next.colorWheel2;}buffer[id]={...next,...copy(args.values)};if(!this.blind&&this.release)delete this.release.frames[id];if(this.blind&&this.blindRelease)delete this.blindRelease.frames[id]}if(!this.blind)this.fading=null;break;
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
    const next=migrate(copy(args.show));next.settings=copy(this.show.settings);validateShow(next);
    if(this.dir)fs.writeFileSync(path.join(this.dir,'show-before-import-'+Date.now()+'.json'),JSON.stringify(this.show,null,2));this.versions.snapshot(this.show,'before-import');
    this.selection={ids:[],group:'all',revision:this.selection.revision+1};this.preview=null;this.blind=false;this.blindOverrides={};this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.held=null;this.fading=null;this.transition=null;this.release=null;this.stack=null;this.blackout=false;this.update(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,next)});break;
   }
   case 'fixture.patch':this.update(s=>this.upsert(s.fixtures,args.fixture));break;
   case 'group.save':{if(!args.fixtures&&!args.children)throw Error('Give fixtures, or children for a parent group');if(args.fixtures)this.ensureIds(args.fixtures);if(args.children)for(const c of args.children)if(!this.show.groups.some(g=>g.id===c))throw Error('Unknown group '+c);if(args.children&&!args.fixtures)args={...args,fixtures:[]};const old=this.show.groups.find(g=>g.id===args.id)?.color;this.update(s=>this.upsert(s.groups,{...args,...(args.color??old?{color:args.color??old}:{})}));break}
   case 'palette.save':this.update(s=>this.upsert(s.palettes,args));break;
   case 'point.save':this.ensureIds(args.fixtures);this.update(s=>this.upsert(s.points,{id:args.id,name:args.name,positions:Object.fromEntries(args.fixtures.map(id=>{const f=(this.blind?this.previewFrames:this.frames).find(f=>f.id===id);return [id,{pan:f.pan,tilt:f.tilt}]}))}));break;
   case 'point.recall':{const p=this.show.points.find(p=>p.id===args.id);if(!p)throw Error('Unknown position');if(args.ids)this.ensureIds(args.ids);const ids=Object.keys(p.positions).filter(id=>!args.ids||args.ids.includes(id));if(!ids.length)throw Error('No selected fixture has a pose in this position');const buffer=this.blind?this.blindOverrides:this.overrides;for(const id of ids){buffer[id]={...(buffer[id]??{}),...p.positions[id]};if(!this.blind&&this.release)delete this.release.frames[id]}if(this.blind)break;this.fading=null;break;}
   case 'point.delete':if(this.show.cues.some(c=>c.tracks.some(t=>t.params.pointA===args.id||t.params.pointB===args.id)))throw Error('A cue uses this position');this.update(s=>{s.points=s.points.filter(p=>p.id!==args.id)});break;
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
     if(s.parked)s.parked=s.parked.filter(p=>!gone.has(p.id));
     if(s.visualizer){s.visualizer.hiddenFixtures=(s.visualizer.hiddenFixtures??[]).filter(id=>!gone.has(id));s.visualizer.hiddenGroups=(s.visualizer.hiddenGroups??[]).filter(g=>!emptied.has(g))}
    });
    this.selection={ids:this.selection.ids.filter(id=>!gone.has(id)),group:emptied.has(this.selection.group)?null:this.selection.group,revision:this.selection.revision+1};for(const id of gone)delete this.overrides[id];
    this.log(`Removed ${gone.size} fixture${gone.size===1?'':'s'}${emptied.size?' and group'+(emptied.size===1?' ':'s ')+[...emptied].join(', '):''}`);break}
   case 'group.nest':{const g=this.show.groups.find(x=>x.id===args.id),p=args.parent&&this.show.groups.find(x=>x.id===args.parent);if(!g)throw Error('Unknown group');if(args.parent&&!p)throw Error('Unknown group '+args.parent);
    if(p&&!p.children?.length)throw Error(`${p.name} holds fixtures, not groups: make a parent group first (group.save with children)`);
    if(p&&(p.id===g.id||groupDescendants(this.show,g.id).has(p.id)))throw Error(`${p.name} is inside ${g.name}: a group cannot go inside itself`);
    this.update(s=>{for(const x of s.groups)if(x.children?.includes(g.id)&&x.id!==p?.id){x.children=x.children.filter(c=>c!==g.id);if(!x.children.length)delete x.children}
     if(p){const t=s.groups.find(x=>x.id===p.id);t.children=t.children?.includes(g.id)?t.children:[...(t.children??[]),g.id]}});break}
   case 'group.delete':if(this.show.effects.some(e=>e.group===args.id))throw Error('A saved effect uses this group');this.update(s=>{s.groups=s.groups.filter(g=>g.id!==args.id);for(const x of s.groups)if(x.children?.includes(args.id)){x.children=x.children.filter(c=>c!==args.id);if(!x.children.length)delete x.children}if(s.visualizer)s.visualizer.hiddenGroups=s.visualizer.hiddenGroups.filter(g=>g!==args.id)});break;
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
    let cue;
    if(mode==='replace'||!base){const own=existing?[...(existing.look??[]).map(e=>e.id),...existing.tracks.flatMap(t=>trackFixtures(this.show,t))]:[],look=args.all?this.snapshotLook():this.activeLook(this.snapshotLook(),own);if(!look.length)throw Error('Nothing is lit or changed to record');cue={...(existing?copy(existing):{id:args.id,name:args.name??'Recorded look',duration:30,loop:true}),tracks:[],look}}
    else{
     if(!ids.length&&!fx.length)throw Error('No changes to record — adjust fixtures or add an effect first');
     cue=copy(base);if(!existing){cue.id=args.id;cue.name=args.name??base.name+' · copy'}cue.look??=[];
     for(const id of ids){const values=copy(src[id]);let e=cue.look.find(x=>x.id===id&&x.over);if(!e){e={id,values:{},over:true};cue.look.push(e)}if(values.color!==undefined&&values.colorWheel===undefined){delete e.values.colorWheel;delete e.values.colorWheel2}Object.assign(e.values,values)}
     for(const f of fx){cue.tracks=cue.tracks.filter(t=>!(t.layer===f.layer&&t.fixtures?.every(id=>f.fixtures.includes(id))));cue.tracks.push({fixtures:[...f.fixtures],layer:f.layer,effect:f.effect,start:0,duration:cue.duration,params:copy(f.params),fadeIn:0,fadeOut:0})}
    }
    if(args.name&&existing)cue.name=args.name;
    let entry;this.update(s=>{this.upsert(s.cues,cue);if(args.page)entry=this.appendEntry(s,args.page,cue.id,args.fade??0,args.after)});created={cue:cue.id,updated:!!existing,mode,...(entry?{entry}:{})};
    const clearProgrammer=()=>{if(this.blind)this.blindOverrides={};else{for(const id of ids)delete this.overrides[id];this.fx=[];this.release=null}};
    if(this.playback?.cue.id===cue.id){this.playback.cue=copy(cue);clearProgrammer()}
    else if(args.go&&entry){const page=this.show.pages.find(p=>p.id===args.page);this.goEntry(page,page.cues.findIndex(e=>e.id===entry),0);clearProgrammer()}
    break;}
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
   case 'media.delete':{const m=this.show.media.find(m=>m.id===args.id);if(!m)throw Error(BUILTIN_MEDIA.some(b=>b.id===args.id)?'Built-in media cannot be deleted':'Unknown media');this.update(s=>{s.media=s.media.filter(x=>x.id!==args.id);if(s.ledWall.media===args.id)s.ledWall.media='off'});if(this.dir)fs.rmSync(path.join(this.dir,'media',path.basename(m.src)),{force:true});break;}
   case 'visualizer.hide':{if(!args.groups&&!args.fixtures)throw Error('Name groups and/or fixtures to hide or show');for(const g of args.groups??[])if(!this.show.groups.some(x=>x.id===g))throw Error('Unknown group '+g);this.ensureIds(args.fixtures??[]);
    this.update(s=>{const v=s.visualizer??={hiddenGroups:[],hiddenFixtures:[]},apply=(list,items)=>args.hidden?[...new Set([...list,...items])]:list.filter(x=>!items.includes(x));
     if(args.groups)v.hiddenGroups=apply(v.hiddenGroups,args.groups);if(args.fixtures)v.hiddenFixtures=apply(v.hiddenFixtures,args.fixtures);
     if(!args.hidden&&args.groups){const members=new Set(args.groups.flatMap(g=>s.groups.find(x=>x.id===g).fixtures));v.hiddenFixtures=v.hiddenFixtures.filter(id=>!members.has(id))}});
    created={visualizer:this.visualizerStatus()};break;}
   case 'ledwall.set':this.update(s=>Object.assign(s.ledWall,args));break;
   case 'master.set':this.master=args.value;break;
   case 'blackout.set':this.blackout=args.enabled;break;
   case 'output.configure':validateNetwork(args);this.update(s=>Object.assign(s.settings,args));break;
   case 'output.arm':if(this.scene)throw Error('Release the scene before arming.');if(this.playback||this.layers.length||Object.keys(this.overrides).length||this.fx.length||this.fading||this.transition||this.release)throw Error('Stop preview and clear overrides before arming.');await this.output.arm(this.show.settings);break;
   case 'output.disarm':await this.disarm();break;
  }
  this.log(`${name}${args.id?' · '+args.id:''}${args.slot?' · '+args.slot:''}${args.cue?.name?' · '+args.cue.name:''}${args.page?.name?' · '+args.page.name:''}`);this.tick();this.live.schedule(()=>this.liveSnapshot());this.mods?.changed();return {ok:true,...(created?{created}:{}),...(lean?{}:{runtime:this.runtime()})};
 }
// Modules (docs/MIDI-AND-SOUND.md) are imported only while one is on; when none is, nothing of them exists.
 async syncModules(){
  const m=this.show.settings.modules??{},on=!!(m.sound?.enabled||m.midi?.enabled);
  if(on&&!this.mods){const {Modules}=await import('./modules/index.mjs');this.mods=new Modules(this)}
  if(this.mods){if(on)await this.mods.apply(m);else{await this.mods.close();this.mods=null;this.log('Modules off')}}
 }
 moduleOff(name){return `The ${name==='sound'?'sound':'MIDI'} module is off: turn it on with modules.set {${name}:{enabled:true}}.`}
 modulesStatus(){const m=this.show.settings.modules??{};return {sound:{enabled:!!m.sound?.enabled,device:m.sound?.device??null,inputs:this.show.audioInputs??[],...(this.mods?.sound?.summary()??{})},midi:{enabled:!!m.midi?.enabled,virtualPort:m.midi?.virtualPort!==false,...(this.mods?.midi?.summary()??{})},helper:this.mods?.io?.summary()??{running:false}}}
 liveSnapshot(){const st=this.stack;return {clean:false,at:new Date().toISOString(),armed:!!this.output.armed,scene:this.scene?.id??null,stack:st?{page:st.page,entry:st.entry}:null,master:this.master,tempo:this.tempo.bpm,locked:this.locked}}
 resumeStatus(){const r=this.resume;if(!r)return null;const pg=r.stack&&this.show.pages.find(p=>p.id===r.stack.page),i=pg?pg.cues.findIndex(e=>e.id===r.stack.entry):-1,e=i>=0?pg.cues[i]:null;
  return {at:r.at,armed:!!r.armed,scene:this.show.scenes.find(s=>s.id===r.scene)?.name??null,page:pg?.name??null,cue:e?{number:i+1,name:e.label??this.show.cues.find(c=>c.id===e.cue)?.name??e.cue}:null,master:r.master,tempo:r.tempo??null}}
 resetLive(){this.selection={ids:[],group:'all',revision:this.selection.revision+1};this.preview=null;this.blind=false;this.blindOverrides={};this.playback=null;this.layers=[];this.overrides={};this.fx=[];this.held=null;this.fading=null;this.transition=null;this.release=null;this.stack=null;this.blackout=false;this.scene=null;this.flashes.clear();this.bumps.clear();this.levels.clear();this.faderOwned.clear()}
 // Pre-show check: one list of what to look at before doors. Sends no DMX.
 async showCheck({network=true}={}){
  const rows=[],add=(id,label,state,detail)=>rows.push({id,label,state,detail}),out=this.outputStatus(),rep=this.patchReport();
  if(network){const c=await(this.output.check?this.output.check(this.show.settings):checkConnection(this.show.settings));this.lastCheck=c;add('network','Art-Net path to '+this.show.settings.target,c.ok?'pass':'fail',c.ok?'Source, subnet, ping and ArtPoll all answered':(c.steps.find(x=>!x.ok)?.label??'The check failed')+' Open Settings → Art-Net output for every step.')}
  add('output','Output',out.armed?'pass':'warn',out.armed?'Armed and sending':'Off: arm it before the show');
  const unrouted=rep.fixtures.filter(f=>f.state==='unrouted').length,unverified=rep.fixtures.filter(f=>f.enabled&&f.state==='unverified').length,enabled=rep.fixtures.filter(f=>f.enabled).length;
  add('routing','Universes routed',unrouted?'fail':'pass',unrouted?`${unrouted} fixtures are on a universe with no Art-Net route`:`${rep.universes.filter(u=>u.artnet!==null).length} universes routed`);
  add('fixtures','Fixtures',unverified?'warn':'pass',`${enabled} enabled`+(unverified?` · ${unverified} unverified (preview only, never sent)`:''));
  const v=this.versions.list()[0];add('saved','Show saved',this.dir?'pass':'warn',this.dir?(v?`Latest version ${v.at}`:'Saved; no version yet'):'No data folder: nothing is saved');
  add('lock','Performance lock',this.locked?'pass':'warn',this.locked?'On':'Off: lock the show before it starts');
  add('timing','Engine timing',this.dropped>10?'warn':'pass',this.dropped?`${this.dropped} slow frames since start`:'No slow frames');
  if(this.mods)rows.push(...this.mods.checks());
  const rig=this.show.pages.find(p=>/rig/i.test(p.id+' '+p.name)&&p.cues.length);add('rig','Rig check',rig?'pass':'warn',rig?`Page “${rig.name}” is ready to run`:'No rig check page with a cue');
  return {ok:!rows.some(r=>r.state==='fail'),rows,at:new Date().toISOString()};
 }
 start(){this.live.write(this.liveSnapshot());this.syncModules().catch(e=>this.log('Modules: '+e.message));this.timer=setInterval(()=>{try{this.tick()}catch(e){this.log('Engine error: '+e.message);this.output.close()}},1000/30)}
 // Stopping the engine blacks out the rig first, unless show.playback.holdOnStop is false: by default the last packets stand (docs/SHOW-SAFETY.md).
 async close(){clearInterval(this.timer);this.live.close(this.liveSnapshot());await this.mods?.close();this.mods=null;if(this.show.playback.holdOnStop!==false&&this.output.armed){this.log('Engine stopped · output left at the last look (keep the last look on stop)');this.output.close()}else await this.disarm();const audit=this.audit;this.audit=null;await new Promise(r=>audit?audit.end(r):r())}
}
