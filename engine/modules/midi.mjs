// MIDI (docs/MIDI-AND-SOUND.md): a virtual "StageLight" output port that ProPresenter and other apps can map notes from,
// and native controllers (APC40 mkII) with a default profile the operator changes in the visual editor. Every control
// goes through the same engine commands as the desk, MCP and OSC, one at a time in the order they arrive.
import * as APC from '../controllers/apc40mk2.mjs';
const PROFILE='apc40mk2';
export class Midi{
 constructor(engine,io){
  this.engine=engine;this.io=io;this.sent=[];this.apc=null;this.bank=0;this.queue=Promise.resolve();this.leds=new Map();this.last=null;this.shift=false;this.faders=new Map();this.beat=null;
  this.offs=[io.on('midi',m=>{if(m.port==='apc')this.input(m.bytes)}),io.on('devices',()=>this.configure()),io.on('stopped',()=>{this.apc=null;this.leds.clear();this.virtualName=undefined})];
 }
 cfg(){return this.engine.show.settings.modules?.midi??{}}
 configure(){
  const name=this.cfg().virtualPort===false?null:'StageLight';if(name!==this.virtualName){this.virtualName=name;this.io.send({op:'midi.virtual',name})}
  const ins=this.io.devices?.midiIn??[],outs=this.io.devices?.midiOut??[],input=ins.find(n=>/APC40 mkII/i.test(n)),output=outs.find(n=>/APC40 mkII/i.test(n));
  if(input&&!this.apc){this.apc={input,output};this.leds.clear();this.io.send({op:'midi.open',id:'apc',input,output});this.io.send({op:'midi.send',port:'apc',bytes:APC.INTRO});this.engine.log('APC40 mkII connected');this.changed(true)}
  else if(!input&&this.apc){this.apc=null;this.io.send({op:'midi.close',id:'apc'});this.engine.log('APC40 mkII disconnected')}
  this.metronome();
 }
 profile(){const saved=(this.engine.show.controllers??[]).find(c=>c.id===PROFILE);return {id:PROFILE,model:'apc40mk2',name:saved?.name??'APC40 mkII',map:{...APC.DEFAULT_MAP,...saved?.map}}}
 // A note on the virtual port; GO sends turn themselves off after offMs so ProPresenter sees a clean press.
 note({note,channel=1,velocity=100},down,offMs){
  this.io.send({op:'midi.send',port:'virtual',bytes:down?[0x90|(channel-1),note,velocity]:[0x80|(channel-1),note,0]});
  this.sent.unshift({note,channel,velocity,on:down,at:new Date().toISOString()});this.sent.length=Math.min(this.sent.length,20);
  if(down&&offMs){const t=setTimeout(()=>this.note({note,channel},false),offMs);t.unref?.()}
 }
 input(bytes){
  if(bytes[0]===0xF0)return this.intro(bytes);const ev=APC.parse(bytes);if(!ev)return;
  if(ev.control==='shift'){this.shift=ev.value===1;return}
  this.last={control:ev.control,value:ev.value,at:Date.now()};const map=this.profile().map,action=(this.shift&&map[`shift-${ev.control}`])||map[ev.control];
  if(action&&action.do!=='none')this.run(action,ev,APC.control(ev.control));
 }
 // The unit answers the introduction with its nine fader positions, which fader pickup starts from.
 intro(bytes){if(bytes[4]!==0x61)return;for(let i=0;i<9;i++)this.faders.set(i<8?`fader-${i+1}`:'master-fader',{value:bytes[7+i]/127,engaged:false})}
 slotAt(n,bank=false){const s=this.engine.show.masters.slots;return s[bank?this.bank*8+n-1:n-1]}
 run(a,ev,c){
  const e=this.engine,cmd=(name,args)=>{this.queue=this.queue.then(()=>e.command(name,args,{lean:true})).catch(err=>e.log(`APC40 · ${ev.control}: ${err.message}`))};
  const press=c.kind==='pad'||c.kind==='button',down=ev.value===1,slot=a.do.startsWith('master.')?this.slotAt(a.n):a.do.startsWith('bank.')&&a.n?this.slotAt(a.n,true):null;
  switch(a.do){
   case 'master.press':case 'bank.press':if(slot?.cue&&press)cmd('masters.trigger',{slot:slot.id,down});else if(slot?.cue&&!press)cmd('masters.level',{slot:slot.id,level:ev.value});return;
   case 'master.sound':case 'bank.sound':if(slot?.sound&&down)cmd('masters.sound',{slot:slot.id});return;
   case 'master.release':case 'bank.release':if(slot?.cue&&down&&e.running().some(r=>r.cue.id===slot.cue))cmd('cue.release',{id:slot.cue,fade:slot.fade??0});return;
   case 'master.level':case 'bank.level':if(slot&&this.pickup(ev,this.levelOf(slot)))cmd('masters.level',{slot:slot.id,level:+ev.value.toFixed(3)});return;
   case 'grand':if(this.pickup(ev,e.master))cmd('master.set',{value:+ev.value.toFixed(3)});return;
   case 'tempo.fine':if(c.kind==='encoder'&&ev.value)cmd('tempo.nudge',{delta:ev.value*.1});return;
  }
  if(press&&!down)return;
  switch(a.do){
   case 'bank.prev':case 'bank.next':{const max=Math.max(0,Math.ceil(e.show.masters.slots.length/8)-1);this.bank=Math.max(0,Math.min(max,this.bank+(a.do==='bank.next'?1:-1)));for(const f of this.faders.values())f.engaged=false;this.changed(true);return}
   case 'scene':{const sc=e.show.scenes[(a.n??1)-1];if(sc)cmd(e.scene?.id===sc.id?'scene.release':'scene.go',e.scene?.id===sc.id?{}:{id:sc.id});return}
   case 'scene.release':cmd('scene.release',{});return;
   case 'go':{const page=e.activePage()??e.show.pages[0];if(page)cmd('page.go',{id:page.id});return}
   case 'back':cmd('page.back',{});return;
   case 'stop':cmd('cue.stop',{});return;
   case 'clear':cmd('override.release',{});return;
   case 'highlight':cmd('highlight.set',{enabled:!e.highlight});return;
   case 'blackout':cmd('blackout.set',{enabled:!e.blackout});return;
   case 'tap':cmd('tempo.tap',{});return;
   case 'tempo.nudge':cmd('tempo.nudge',{delta:a.delta??1});return;
   case 'tempo.half':cmd('tempo.scale',{factor:.5});return;
   case 'tempo.double':cmd('tempo.scale',{factor:2});return;
   case 'tempo.reset':cmd('tempo.set',{});return;
  }
 }
 levelOf(slot){const running=this.engine.running().some(r=>r.cue.id===slot.cue);return running?this.engine.levels.get(slot.id)??1:0}
 // Soft takeover: after a bank change or at start, a fader only takes over once it reaches the value it controls,
 // so nothing jumps when the physical fader is somewhere else.
 pickup(ev,target){
  const f=this.faders.get(ev.control)??{value:ev.value,engaged:false},prev=f.value;f.value=ev.value;
  if(!f.engaged&&(Math.abs(ev.value-target)<.04||(prev-target)*(ev.value-target)<=0))f.engaged=true;this.faders.set(ev.control,f);return f.engaged;
 }
 // LEDs: what every control should show now, diffed against what the unit already shows, so only changes are sent.
 changed(force=false){
  if(!this.apc)return;for(const [id,msgs] of this.wanted()){const key=JSON.stringify(msgs);if(!force&&this.leds.get(id)===key)continue;this.leds.set(id,key);for(const m of msgs)this.io.send({op:'midi.send',port:'apc',bytes:m})}
 }
 // Also read by the editor, so it mirrors the LEDs even with no unit plugged in.
 wanted(){
  const e=this.engine,want=new Map(),running=new Map(e.running().map(r=>[r.cue.id,r])),held=new Set(e.mastersStatus().held);
  const color=s=>s.color??e.show.pages.find(p=>p.cues.some(x=>x.cue===s.cue))?.color??'#7fd3dc';
  const pad=(id,hex,state)=>{if(!hex||state==='empty')return want.set(id,[[...APC.ledMessage(id,0)]]);const full=APC.nearestColor(hex,1),dim=APC.nearestColor(hex,.28);
   want.set(id,state==='held'?[APC.ledMessage(id,dim,APC.LED.solid),APC.ledMessage(id,full,APC.LED.pulse)]:state==='paused'?[APC.ledMessage(id,full,APC.LED.solid),APC.ledMessage(id,dim,APC.LED.blink)]:[APC.ledMessage(id,state==='running'?full:dim,APC.LED.solid)])};
  const stateOf=s=>!s?.cue?'empty':held.has(s.id)?'held':running.get(s.cue)?.paused?'paused':running.has(s.cue)?'running':'idle';
  const map=this.profile().map;
  for(const c of APC.CONTROLS){const a=map[c.id];if(!c.led)continue;
   if(a?.do==='master.press'||a?.do==='bank.press'||a?.do==='bank.release'){const s=a.do==='master.press'?this.slotAt(a.n):this.slotAt(a.n,true),st=stateOf(s);
    if(c.led==='rgb')pad(c.id,s&&color(s),st);else want.set(c.id,[APC.ledMessage(c.id,st==='empty'||st==='idle'?0:c.led==='clip'&&st==='paused'?2:1)])}
   else if(a?.do==='master.sound'||a?.do==='bank.sound'){const s=a.do==='master.sound'?this.slotAt(a.n):this.slotAt(a.n,true),on=!!s?.sound&&s.sound.enabled!==false;if(c.led==='rgb')pad(c.id,s?.sound?'#4fd18b':null,!s?.sound?'empty':on?'running':'idle');else want.set(c.id,[APC.ledMessage(c.id,on?1:0)])}
   else if(a?.do==='scene'){const sc=e.show.scenes[(a.n??1)-1];pad(c.id,sc&&(sc.color??'#eac28a'),!sc?'empty':e.scene?.id===sc.id?'held':'idle')}
   else if(c.led==='single'||c.led==='clip'){const on=a?.do==='blackout'?e.blackout:a?.do==='highlight'?e.highlight:a?.do==='go'?!!(e.stackStatus()?.next??e.show.pages[0]):a?.do==='bank.prev'?this.bank>0:a?.do==='bank.next'?(this.bank+1)*8<e.show.masters.slots.length:false;want.set(c.id,[APC.ledMessage(c.id,on?1:0)])}
   else if(c.led==='rgb')want.set(c.id,[APC.ledMessage(c.id,0)]);
  }
  return want;
 }
 // The Metronome button blinks on the beat while a tempo is known (a timer only while the module is on).
 metronome(){
  clearInterval(this.beat);this.beat=null;const bpm=this.engine.tempo.bpm??this.engine.playback?.cue.bpm;if(!this.apc||!bpm)return;let on=false;
  this.beat=setInterval(()=>{on=!on;this.io.send({op:'midi.send',port:'apc',bytes:APC.ledMessage('metronome',on?1:0)})},30000/bpm);this.beat.unref?.();this.beatBpm=bpm;
 }
 async command(name,args){
  if(name==='midi.test'){this.note(args,true,200);return {sent:args}}
  const a=this.profile().map[args.control],c=APC.control(args.control);if(!c)throw Error('Unknown control '+args.control);if(!a||a.do==='none')return {control:args.control,action:null};
  const v=args.value??1;this.run(a,{control:args.control,value:c.kind==='encoder'?1:v},c);if(c.kind==='pad'||c.kind==='button')this.run(a,{control:args.control,value:0},c);await this.queue;return {control:args.control,action:a};
 }
 live(){if(!this.apc)return null;const bpm=this.engine.tempo.bpm??this.engine.playback?.cue.bpm;if(bpm!==this.beatBpm)this.metronome();return {connected:true,bank:this.bank,last:this.last}}
 async status(){await this.io.ready();return {virtualPort:this.cfg().virtualPort===false?null:'StageLight',ports:{in:this.io.devices?.midiIn??[],out:this.io.devices?.midiOut??[]},controller:this.apc?{model:'apc40mk2',...this.apc,bank:this.bank}:null,profile:this.profile(),defaults:APC.DEFAULT_MAP,controls:APC.CONTROLS,palette:APC.PALETTE,leds:Object.fromEntries(this.wanted()),last:this.last,sent:this.sent}}
 summary(){return {virtualPort:this.cfg().virtualPort!==false,controller:this.apc?'APC40 mkII':null}}
 checks(){return [{id:'midi',label:'MIDI',state:'pass',detail:this.cfg().virtualPort===false?'No virtual port':'Virtual port “StageLight” open'},{id:'apc',label:'APC40 mkII',state:this.apc?'pass':'warn',detail:this.apc?'Connected':'Not connected'}]}
 close(){for(const off of this.offs)off();clearInterval(this.beat);if(this.apc)this.io.send({op:'midi.close',id:'apc'});this.io.send({op:'midi.virtual',name:null});this.apc=null}
}
