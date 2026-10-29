// Sound triggers (docs/MIDI-AND-SOUND.md): a master with sound {channel, band, …} on a channel of the chosen input device
// (e.g. Dante Virtual Soundcard). Hit mode flashes it on each hit the helper detects; follow mode rides its level on the
// channel's loudness, like a fader in the band's hands, and releases the cue after SILENCE ms of quiet.
// Sensitivity 0..1 maps to a threshold from -6 dBFS (only the loudest hits) down to -60 dBFS (almost anything).
export const thresholdDb=s=>Math.round((-6-54*(s??.5))*10)/10;
const SILENCE=2000;
export class Sound{
 constructor(engine,io){
  this.engine=engine;this.io=io;this.levels={};this.input=null;this.hits={};this.meterOn=false;this.meterTimer=null;this.lastHit={};this.opened=null;this.following=new Map();
  this.offs=[io.on('hit',m=>this.hit(m)),io.on('level',m=>this.follow(m.levels??{})),io.on('meter',m=>{this.levels=m.levels??{};this.input=m.input??null}),io.on('audio',m=>{this.opened=m}),io.on('devices',()=>this.configure())];
 }
 device(){return this.engine.show.settings.modules?.sound?.device??null}
 triggers(){return this.engine.show.masters.slots.filter(m=>m.sound&&m.sound.enabled!==false&&m.cue).map(m=>({id:m.id,channel:m.sound.channel,band:m.sound.band??'kick',threshold:thresholdDb(m.sound.sensitivity),gapMs:m.sound.gapMs??90,
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
  if(changed)e.mods?.changed();
 }
 // Sent again whenever the device, a trigger or the device list changes; the helper reopens only what it must. The
 // input stays open while a device is chosen, even with no trigger yet, so the meter shows that audio is arriving.
 configure(){const dev=this.device(),t=this.triggers();if(!dev){this.io.send({op:'audio.close'});this.opened=null;this.input=null;return}this.io.send({op:'audio.open',device:dev,triggers:t})}
 hit({id,level}){if(this.engine.show.masters.slots.find(m=>m.id===id)?.sound?.enabled===false)return;this.lastHit[id]={level:level??null,at:new Date().toISOString()};this.hits[id]=(this.hits[id]??0)+1;try{this.engine.soundHit(id);this.engine.tick();this.engine.mods?.changed()}catch(e){this.engine.log('Sound trigger: '+e.message)}}
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
 close(){for(const off of this.offs)off();clearTimeout(this.meterTimer);this.io.send({op:'audio.close'})}
}
