// Sound triggers (docs/MIDI-AND-SOUND.md): a master with sound {channel, band, …} on a channel of the chosen input device
// (e.g. Dante Virtual Soundcard). Hit mode flashes it on each hit the helper detects; follow mode rides its level on the
// channel's loudness, like a fader in the band's hands, and releases the cue after TIMING.silence ms of quiet.
// Sensitivity 0..1 maps to a threshold from -6 dBFS (only the loudest hits) down to -60 dBFS (almost anything).
export const thresholdDb=s=>Math.round((-6-54*(s??.5))*10)/10;
// Timings in ms (tests shorten them): silence before a follow cue is let go, retry interval for a lost input, how long
// without a meter message counts as a dead stream, and how long digital silence counts as a dead feed.
export const TIMING={silence:2000,reopen:2000,stale:3000,deadAfter:20000};
// Digital silence on the whole input (every channel at once) for this long is almost certainly a dead feed, not a quiet
// moment in the room: Dante Virtual Soundcard delivers zeros when the network or the console stops sending.
export const DEAD_DB=-80;
export const DEFAULT_INPUT='System default input';
export class Sound{
 constructor(engine,io){
  this.engine=engine;this.io=io;this.levels={};this.input=null;this.channels=null;this.hits={};this.meterOn=false;this.meterTimer=null;this.lastHit={};this.opened=null;this.following=new Map();
  this.reopenTimer=null;this.staleTimer=null;this.followTimer=null;this.metered=false;this.signalAt=Date.now();this.defaultDevice=null;
  this.offs=[io.on('hit',m=>this.hit(m)),io.on('level',m=>this.follow(m.levels??{})),io.on('meter',m=>this.meter(m)),io.on('audio',m=>this.audio(m)),io.on('error',m=>this.failed(m.message)),io.on('devices',m=>this.devicesChanged(m)),io.on('stopped',()=>this.stopped())];
 }
 device(){return this.engine.show.settings.modules?.sound?.device??null}
 triggers(){return this.listening().filter(t=>!t.off).map(({off,...t})=>t)}
 // Every set-up trigger is metered, switched off or not, so the panel shows its channel's audio while you set it up;
 // hits and levels from one that is off are dropped in hit() and follow(), so it never fires.
 listening(){return this.engine.show.masters.slots.filter(m=>m.sound&&m.cue).map(m=>({...(m.sound.enabled===false?{off:true}:{}),id:m.id,channel:m.sound.channel,band:m.sound.band??'kick',threshold:thresholdDb(m.sound.sensitivity),gapMs:m.sound.gapMs??90,
  ...(m.sound.mode==='follow'?{mode:'follow',attackMs:m.sound.attackMs??30,releaseMs:m.sound.releaseMs??300}:{})}))}
 // Follow mode: dBFS → master level, silent at the threshold and full rangeDb above it, through the same path as a
 // fader (masterLevel) so sound starts the cue. Quiet keeps it running dark; only TIMING.silence ms of quiet releases it.
 // Called ~30 times a second while a follow trigger listens; nothing is logged per update.
 follow(levels){
  const e=this.engine,now=Date.now();let changed=false;
  for(const [id,db] of Object.entries(levels)){
   const s=e.show.masters.slots.find(m=>m.id===id);if(!s?.cue||s.sound?.mode!=='follow'||s.sound.enabled===false)continue;
   const floor=thresholdDb(s.sound.sensitivity),level=Math.round(Math.max(0,Math.min(1,(db-floor)/(s.sound.rangeDb??24)))*100)/100,f=this.following.get(id)??{level:0,quiet:null,released:true};
   try{
    if(level>0){f.quiet=null;f.released=false;if(level!==f.level){e.masterLevel(id,level,true);changed=true}}
    else{f.quiet??=now;if(f.level!==0){e.masterLevel(id,0,false);changed=true}if(!f.released&&now-f.quiet>=TIMING.silence){e.masterLevel(id,0,true);f.released=true;changed=true}}
   }catch(err){e.log('Sound follow: '+err.message)}
   f.level=level;this.following.set(id,f);
  }
  if(changed)e.mods?.changed();
  // Levels stop arriving when the input dies or the helper stops: then the cue a level brought up would stay up for
  // good. If none comes for TIMING.silence ms while a follow cue is up, it is let go as if the band went quiet.
  clearTimeout(this.followTimer);this.followTimer=null;
  if([...this.following.values()].some(f=>!f.released)){this.followTimer=setTimeout(()=>{this.followTimer=null;this.letGo(true,`no level for ${TIMING.silence/1000} s`)},TIMING.silence+250);this.followTimer.unref?.()}
 }
 // A follow trigger switched off, removed or changed to another mode lets go of the cue its level brought up, as
 // silence would; otherwise follow() skips it from then on and the cue stays up for good. all: every follow cue (the
 // module going off, the input or helper gone quiet).
 letGo(all=false,why){for(const [id,f] of this.following){const s=this.engine.show.masters.slots.find(m=>m.id===id);if(f.released||(!all&&s?.sound?.mode==='follow'&&s.sound.enabled!==false))continue;
  if(why)this.engine.log(`Sound follow: ${why}, master ${this.engine.show.masters.slots.findIndex(m=>m.id===id)+1} let go`);
  try{this.engine.masterLevel(id,0,true);this.engine.tick();this.engine.mods?.changed()}catch(e){this.engine.log('Sound follow: '+e.message)}this.following.delete(id)}}
 // Sent again whenever the device, a trigger or the device list changes; the helper reopens only what it must. The
 // input stays open while a device is chosen, even with no trigger yet, so the meter shows that audio is arriving.
 configure(){this.letGo();const dev=this.device();if(this.lost&&this.lost.device!==dev)this.lost=null;const t=this.listening().map(({off,...t})=>t);if(!dev){clearTimeout(this.reopenTimer);this.reopenTimer=null;this.io.send({op:'audio.close'});this.opened=null;this.input=null;return}this.io.send({op:'audio.open',device:dev,triggers:t})}
 // lost: the input failed under us (helper error or no audio callbacks). It stays lost, logged once and shown in health,
 // through every reopen until audio actually arrives again (a meter message): a Dante card without its clock opens and
 // goes quiet again and again, and that must not log two lines every five seconds.
 audio(m){const was=this.opened;this.opened=m;this.metered=false;clearTimeout(this.staleTimer);this.staleTimer=null;
  if(m.ok){clearTimeout(this.reopenTimer);this.reopenTimer=null;this.signalAt=Date.now();if(was&&!was.ok&&!this.lost)this.engine.log(`Sound input open again · ${m.device}`);
   // An input that opens but never delivers audio (a Dante card without its clock) is lost too, once this helper has
   // shown it meters at all.
   if(this.everMetered){this.staleTimer=setTimeout(()=>{this.staleTimer=null;if(this.opened?.ok)this.failed('Audio input: no audio callbacks for '+TIMING.stale/1000+' s')},TIMING.stale);this.staleTimer.unref?.()}return}
  if(!was||was.ok||was.error!==m.error)this.engine.log(`Sound input did not open · ${m.device??this.device()}: ${m.error??'unknown error'}`);this.reopenLater()}
 // The helper keeps a stream that died (Dante restarting with the network, a USB interface unplugged) and, asked to open
 // the same device again, reuses it, so triggers stay deaf until the engine restarts (seen 2026-11-01 02:15). On the
 // helper's input error, or when its meter (sent ~15 times a second while open) stops, the stream is closed and opened
 // fresh every 2 s until it works.
 failed(message){if(!/^Audio input/.test(message??''))return;const dev=this.device();if(!dev)return;
  const error=message.replace(/^Audio input:\s*/,'');if(!this.lost){this.lost={error,device:dev,at:new Date().toISOString()};this.engine.log(`Sound input lost · ${dev}: ${error} · reopening every ${TIMING.reopen/1000} s`)}
  this.opened={ok:false,device:dev,error};this.input=null;this.levels={};this.io.send({op:'audio.close'});this.letGo(true,'the input was lost');this.reopenLater()}
 reopenLater(){if(this.reopenTimer||!this.device())return;this.reopenTimer=setTimeout(()=>{this.reopenTimer=null;if(this.device()&&this.opened?.ok!==true){this.io.send({op:'audio.close'});this.configure()}},TIMING.reopen);this.reopenTimer.unref?.()}
 meter(m){this.everMetered=true;if(this.lost){this.engine.log(`Sound input back · ${this.device()} (lost since ${this.lost.at})`);this.lost=null}this.levels=m.levels??{};this.input=m.input??null;if(m.channels)this.channels=m.channels;if(this.input!==null&&this.input>DEAD_DB)this.signalAt=Date.now();
  // Only once this helper has shown it meters the open input do we watch for the meter stopping.
  this.metered=true;clearTimeout(this.staleTimer);this.staleTimer=setTimeout(()=>{this.staleTimer=null;if(this.opened?.ok&&this.metered)this.failed('Audio input: no audio callbacks for '+TIMING.stale/1000+' s')},TIMING.stale);this.staleTimer.unref?.()}
 // The device list changed (hot-plug every 2 s). "System default input" follows the Mac's Sound settings, so when macOS
 // switches its default (often to the MacBook microphone when Dante stops) the triggers would listen to the wrong thing:
 // log it, and say so in the checks and runtime.health.
 devicesChanged(m){const def=(m.audio??[]).find(d=>d.name===DEFAULT_INPUT)?.device??null;
  if(this.device()===DEFAULT_INPUT&&this.defaultDevice&&def!==this.defaultDevice)this.engine.log(`Sound input: the Mac's default input changed from ${this.defaultDevice} to ${def??'none'}, and the sound triggers follow it`);
  this.defaultDevice=def;this.configure()}
 stopped(){this.lost=null;this.opened=null;this.input=null;this.levels={};this.metered=false;clearTimeout(this.staleTimer);this.staleTimer=null;this.letGo(true,'the helper stopped')}
 hit({id,level}){if(this.engine.show.masters.slots.find(m=>m.id===id)?.sound?.enabled===false)return;this.lastHit[id]={level:level??null,at:new Date().toISOString()};this.hits[id]=(this.hits[id]??0)+1;try{this.engine.soundHit(id);this.engine.tick();this.engine.mods?.changed()}catch(e){this.engine.log('Sound trigger: '+e.message)}}
 async command(name,args){
  if(name==='sound.meter'){
   this.meterOn=args.on;clearTimeout(this.meterTimer);if(!args.on){this.levels={};this.channels=null}this.configure();this.io.send({op:'audio.meter',on:args.on});
   if(args.on){this.meterTimer=setTimeout(()=>{this.meterOn=false;this.levels={};this.channels=null;this.io.send({op:'audio.meter',on:false});this.configure()},30000);this.meterTimer.unref?.()}
   return {meter:args.on};
  }
  const s=this.engine.show.masters.slots.find(m=>m.id===args.slot);if(!s?.sound)throw Error('That master has no sound trigger');
  if(s.sound.mode==='follow'){this.follow({[args.slot]:thresholdDb(s.sound.sensitivity)+(s.sound.rangeDb??24)});const t=setTimeout(()=>this.follow({[args.slot]:-90}),400);t.unref?.();return {swell:args.slot}}
  this.hit({id:args.slot});return {hit:args.slot};
 }
 devices(){return this.io.devices?.audio??[]}
 // Right after the helper starts its device list may not be in yet: wait for it (at most 2 s) instead of answering empty.
 async status(){await this.io.ready();return {device:this.device(),devices:this.devices(),open:this.opened,input:this.input,silentFor:this.silentFor(),...(this.channels?{channels:this.channels}:{}),triggers:this.triggers().map(t=>({...t,lastHit:this.lastHit[t.id]??null})),meter:this.meterOn?this.levels:null,warnings:this.health().map(h=>h.message)}}
 summary(){return {devices:this.devices().length,open:!!this.opened?.ok,triggers:this.triggers().length}}
 // Seconds of digital silence on the whole open input, or 0.
 silentFor(){return this.opened?.ok&&this.metered?Math.max(0,+((Date.now()-this.signalAt)/1000).toFixed(1)):0}
 // What the desk banner and the pre-show check should say about the input right now.
 health(){
  const dev=this.device(),out=[],n=this.triggers().length;if(!dev)return out;
  if(this.lost||this.opened&&!this.opened.ok)out.push({id:'sound-input',level:'error',message:`Sound input ${dev} is not working: ${this.lost?.error??this.opened.error??'it did not open'}. Retrying every ${TIMING.reopen/1000} s.`});
  else if(n&&this.silentFor()*1000>=TIMING.deadAfter)out.push({id:'sound-silent',level:'warn',message:`No audio at all on ${dev} since ${new Date(this.signalAt).toLocaleTimeString()}: check the Dante feed (Dante Controller, the console's Dante card).`});
  if(dev===DEFAULT_INPUT)out.push({id:'sound-default',level:'warn',message:`Sound triggers follow the Mac's default input${this.defaultDevice?` (now ${this.defaultDevice})`:''}: choose the device by name so a change in macOS cannot move them.`});
  return out;
 }
 checks(){
  const dev=this.device(),found=dev===DEFAULT_INPUT?!!this.defaultDevice||this.devices().some(d=>d.name===dev):this.devices().some(d=>d.name===dev),n=this.triggers().length,h=this.health();
  const rows=[{id:'sound',label:'Sound triggers',state:!dev?'warn':!found?'fail':this.opened&&!this.opened.ok?'fail':'pass',detail:!dev?'No input device chosen':!found?`“${dev}” is not connected`:this.opened&&!this.opened.ok?this.opened.error??'The input did not open':`${n} trigger${n===1?'':'s'} on ${dev}`}];
  for(const x of h.filter(x=>x.id!=='sound-input'))rows.push({id:x.id,label:x.id==='sound-silent'?'Sound input signal':'Sound input device',state:'warn',detail:x.message});
  return rows;
 }
 close(){this.letGo(true,'the sound module went off');for(const off of this.offs)off();clearTimeout(this.meterTimer);clearTimeout(this.reopenTimer);clearTimeout(this.staleTimer);clearTimeout(this.followTimer);this.io.send({op:'audio.close'})}
}
