// Sound triggers (docs/MIDI-AND-SOUND.md): a master with sound {channel, band, …} on a channel of the chosen input device
// (e.g. Dante Virtual Soundcard). Hit mode flashes it on each hit the helper detects; follow mode rides its level on the
// channel's loudness, like a fader in the band's hands, and releases the cue after SILENCE ms of quiet.
// Sensitivity 0..1 maps to a threshold from -6 dBFS (only the loudest hits) down to -60 dBFS (almost anything).
export const thresholdDb=s=>Math.round((-6-54*(s??.5))*10)/10;
const SILENCE=2000,REOPEN=2000,REOPEN_EVERY=10000;
// Helper output is checked before use: only finite dBFS numbers keyed by master ID get through.
const dbMap=v=>{const out={};if(v&&typeof v==='object'&&!Array.isArray(v))for(const [k,db] of Object.entries(v))if(typeof db==='number'&&Number.isFinite(db))out[k]=db;return out};
export class Sound{
 constructor(engine,io){
  this.engine=engine;this.io=io;this.levels={};this.input=null;this.hits={};this.meterOn=false;this.meterTimer=null;this.lastHit={};this.opened=null;this.following=new Map();
  this.lastLevelAt=0;this.watch=null;this.reopenTimer=null;this.reopenedAt=0;this.missing=false;
  this.offs=[io.on('hit',m=>this.hit(m)),io.on('level',m=>{this.lastLevelAt=Date.now();this.follow(dbMap(m.levels))}),io.on('meter',m=>{this.levels=dbMap(m.levels);this.input=typeof m.input==='number'&&Number.isFinite(m.input)?m.input:null}),
   io.on('audio',m=>{this.opened={ok:!!m.ok,device:typeof m.device==='string'?m.device:null,...(m.channels?{channels:m.channels}:{}),...(m.rate?{rate:m.rate}:{}),...(m.ok?{}:{error:String(m.error??'The input did not open').slice(0,200)})}}),
   io.on('devices',()=>this.configure()),io.on('error',m=>this.streamError(m)),io.on('stopped',()=>this.stopped())];
 }
 // The helper stopped: nothing is open any more, and a follow cue it was riding lets go as if the band went quiet.
 // It is restarted by io.mjs; its device list then calls configure() and the input opens again.
 stopped(){this.opened=null;this.input=null;this.levels={};this.dropFollow();clearTimeout(this.reopenTimer);this.reopenTimer=null}
 // CoreAudio reports a stream failure (Dante restarted, the interface unplugged) as an "Audio input" error while the
 // helper keeps the dead stream: close it and open it again shortly, at most every 10 s.
 streamError(m){
  if(!/^Audio input/.test(String(m?.message??''))||!this.device())return;this.opened={ok:false,device:this.device(),error:String(m.message).slice(0,200)};this.dropFollow();
  if(this.reopenTimer)return;const wait=Math.max(REOPEN,this.reopenedAt+REOPEN_EVERY-Date.now());
  this.reopenTimer=setTimeout(()=>{this.reopenTimer=null;this.reopenedAt=Date.now();this.engine.log('Sound: reopening '+this.device());this.io.send({op:'audio.close'});this.configure()},wait);this.reopenTimer.unref?.();
 }
 // Releases every cue a follow trigger brought up (switching off, the helper stopping, the input lost).
 dropFollow(){for(const [id,f] of this.following){if(f.released)continue;try{this.engine.masterLevel(id,0,true);this.engine.mods?.changed()}catch(e){this.engine.log('Sound follow: '+e.message)}f.released=true;f.level=0}this.watchFollow()}
 // While a follow cue is up, a check once a second releases it if the helper's levels stop arriving for SILENCE ms
 // (no events, no release otherwise). The timer exists only while something is following.
 watchFollow(){
  const up=[...this.following.values()].some(f=>!f.released);
  if(!up){clearInterval(this.watch);this.watch=null;return}
  if(!this.watch){this.watch=setInterval(()=>{if(Date.now()-this.lastLevelAt>SILENCE)this.dropFollow()},1000);this.watch.unref?.()}
 }
 device(){return this.engine.show.settings.modules?.sound?.device??null}
 triggers(){return this.listening().filter(t=>!t.off).map(({off,...t})=>t)}
 // Every set-up trigger is metered, switched off or not, so the panel shows its channel's audio while you set it up;
 // hits and levels from one that is off are dropped in hit() and follow(), so it never fires.
 listening(){return this.engine.show.masters.slots.filter(m=>m.sound&&m.cue).map(m=>({...(m.sound.enabled===false?{off:true}:{}),id:m.id,channel:m.sound.channel,band:m.sound.band??'kick',threshold:thresholdDb(m.sound.sensitivity),gapMs:m.sound.gapMs??90,
  ...(m.sound.mode==='follow'?{mode:'follow',attackMs:m.sound.attackMs??30,releaseMs:m.sound.releaseMs??300}:{})}))}
 // Follow mode: dBFS → master level, silent at the threshold and full rangeDb above it, through the same path as a
 // fader (masterLevel) so sound starts the cue. Quiet keeps it running dark; only SILENCE ms of quiet releases it.
 // Called ~30 times a second while a follow trigger listens; nothing is logged per update.
 follow(levels){
  const e=this.engine,now=Date.now();let changed=false;
  for(const [id,db] of Object.entries(levels)){
   const s=e.show.masters.slots.find(m=>m.id===id);if(!s?.cue||s.sound?.mode!=='follow'||s.sound.enabled===false)continue;
   const floor=thresholdDb(s.sound.sensitivity),level=Math.round(Math.max(0,Math.min(1,(db-floor)/(s.sound.rangeDb??24)))*100)/100,f=this.following.get(id)??{level:0,quiet:null,released:true};
   try{
    if(level>0){f.quiet=null;f.released=false;if(level!==f.level){e.masterLevel(id,level,true);changed=true}}
    else{f.quiet??=now;if(f.level!==0){e.masterLevel(id,0,false);changed=true}if(!f.released&&now-f.quiet>=SILENCE){e.masterLevel(id,0,true);f.released=true;changed=true}}
   }catch(err){e.log('Sound follow: '+err.message)}
   f.level=level;this.following.set(id,f);
  }
  if(changed)e.mods?.changed();this.watchFollow();
 }
 // Sent again whenever the device, a trigger or the device list changes; the helper reopens only what it must. The
 // input stays open while a device is chosen, even with no trigger yet, so the meter shows that audio is arriving.
 // A follow trigger switched off, removed or changed to another mode lets go of the cue its level brought up, as
 // silence would; otherwise follow() skips it from then on and the cue stays up for good.
 letGo(){for(const [id,f] of this.following){const s=this.engine.show.masters.slots.find(m=>m.id===id);if(f.released||(s?.sound?.mode==='follow'&&s.sound.enabled!==false))continue;
  try{this.engine.masterLevel(id,0,true);this.engine.mods?.changed()}catch(e){this.engine.log('Sound follow: '+e.message)}this.following.delete(id)}}
 // A chosen device missing from the helper's list (unplugged, Dante stopped) is closed, so when it comes back the
 // next device list opens a fresh stream instead of keeping the dead one. Never throws: callers do not await it.
 configure(){
  try{
   this.letGo();const dev=this.device(),t=this.listening().map(({off,...t})=>t);
   if(!dev){this.io.send({op:'audio.close'});this.opened=null;this.input=null;this.missing=false;return}
   if(this.io.devices&&!this.devices().some(d=>d.name===dev)){if(!this.missing)this.engine.log(`Sound: “${dev}” is not connected; it opens again when it is back`);this.missing=true;this.io.send({op:'audio.close'});this.opened={ok:false,device:dev,error:`“${dev}” is not connected`};this.input=null;this.levels={};this.dropFollow();return}
   if(this.missing)this.engine.log(`Sound: “${dev}” is back`);this.missing=false;
   this.io.send({op:'audio.open',device:dev,triggers:t});if(this.meterOn)this.io.send({op:'audio.meter',on:true});
  }catch(e){this.engine.log('Sound: '+e.message)}
 }
 hit({id,level}){if(typeof id!=='string'||!this.engine.show.masters.slots.some(m=>m.id===id&&m.sound))return;if(this.engine.show.masters.slots.find(m=>m.id===id)?.sound?.enabled===false)return;if(typeof level!=='number'||!Number.isFinite(level))level=null;this.lastHit[id]={level:level??null,at:new Date().toISOString()};this.hits[id]=(this.hits[id]??0)+1;try{this.engine.soundHit(id);this.engine.tick();this.engine.mods?.changed()}catch(e){this.engine.log('Sound trigger: '+e.message)}}
 async command(name,args){
  if(name==='sound.meter'){
   this.meterOn=args.on;clearTimeout(this.meterTimer);if(!args.on)this.levels={};this.configure();this.io.send({op:'audio.meter',on:args.on});
   if(args.on){this.meterTimer=setTimeout(()=>{this.meterOn=false;this.levels={};this.io.send({op:'audio.meter',on:false});this.configure()},30000);this.meterTimer.unref?.()}
   return {meter:args.on};
  }
  const s=this.engine.show.masters.slots.find(m=>m.id===args.slot);if(!s?.sound)throw Error('That master has no sound trigger');
  if(s.sound.mode==='follow'){this.follow({[args.slot]:thresholdDb(s.sound.sensitivity)+(s.sound.rangeDb??24)});const t=setTimeout(()=>this.follow({[args.slot]:-90}),400);t.unref?.();return {swell:args.slot}}
  this.hit({id:args.slot});return {hit:args.slot};
 }
 devices(){return this.io.devices?.audio??[]}
 // Right after the helper starts its device list may not be in yet: wait for it (at most 2 s) instead of answering empty.
 async status(){await this.io.ready();return {device:this.device(),devices:this.devices(),open:this.opened,triggers:this.triggers().map(t=>({...t,lastHit:this.lastHit[t.id]??null})),meter:this.meterOn?this.levels:null}}
 summary(){return {devices:this.devices().length,open:!!this.opened?.ok,triggers:this.triggers().length}}
 checks(){
  const dev=this.device(),found=this.devices().some(d=>d.name===dev),n=this.triggers().length;
  return [{id:'sound',label:'Sound triggers',state:!dev?'warn':!found?'fail':this.opened&&!this.opened.ok?'fail':'pass',detail:!dev?'No input device chosen':!found?`“${dev}” is not connected`:this.opened&&!this.opened.ok?this.opened.error??'The input did not open':`${n} trigger${n===1?'':'s'} on ${dev}`}];
 }
 close(){for(const off of this.offs)off();clearTimeout(this.meterTimer);clearTimeout(this.reopenTimer);clearInterval(this.watch);this.meterTimer=this.reopenTimer=this.watch=null;this.io.send({op:'audio.close'})}
}
