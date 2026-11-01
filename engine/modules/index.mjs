// Optional modules (docs/MIDI-AND-SOUND.md). The engine imports this file only while sound or MIDI is on. It starts the
// native helper and the modules that are on, and closes all of them when they are turned off, so a show that uses
// neither pays nothing: no process, no ports, no audio and no work in the engine tick.
// v is '' on the first load and '?v=N' after modules.reload, so Node imports the module files on disk again and a fix
// to sound, MIDI or the helper link takes effect without restarting the engine (docs/PRODUCTION-READINESS.md).
export class Modules{
 constructor(engine,v=''){this.engine=engine;this.v=v;this.io=null;this.sound=null;this.midi=null}
 async apply(cfg){
  const e=this.engine;if(!this.io){const {Helper}=await import('./io.mjs'+this.v);this.io=new Helper(e);this.io.start()}
  if(cfg.sound?.enabled&&!this.sound){const {Sound}=await import('./sound.mjs'+this.v);this.sound=new Sound(e,this.io);e.log('Sound module on')}
  else if(!cfg.sound?.enabled&&this.sound){this.sound.close();this.sound=null;e.log('Sound module off')}
  if(cfg.midi?.enabled&&!this.midi){const {Midi}=await import('./midi.mjs'+this.v);this.midi=new Midi(e,this.io);e.log('MIDI module on')}
  else if(!cfg.midi?.enabled&&this.midi){this.midi.close();this.midi=null;e.log('MIDI module off')}
  this.sound?.configure();this.midi?.configure();
 }
 changed(force=false){this.midi?.changed(force)}
 // Extra runtime fields, only while something needs them: the controller's fader bank and last input while one is connected.
 // runtime.sound: the input level and hit counts whenever an input is open (the desk's meter and hit blinks).
 live(){const out={};const s=this.sound;if(s?.opened?.ok)out.sound={input:s.input,meter:s.levels,hits:s.hits,device:s.opened.device,...(s.channels?{channels:s.channels}:{})};const c=this.midi?.live();if(c)out.controller=c;return out}
 // Problems worth a banner on the desk right now (runtime.health): the helper down, the sound input lost or silent.
 health(){return [...(this.io&&!this.io.child?[{id:'helper',level:'error',message:this.io.error??'The sound and MIDI helper is not running'}]:[]),...(this.sound?.health()??[])]}
 checks(){return [...this.io.checks(),...(this.sound?.checks()??[]),...(this.midi?.checks()??[])]}
 async close(){this.sound?.close();this.midi?.close();this.sound=this.midi=null;await this.io?.close();this.io=null}
}
