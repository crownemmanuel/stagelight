// Optional modules (docs/MIDI-AND-SOUND.md). The engine imports this file only while sound or MIDI is on. It starts the
// native helper and the modules that are on, and closes all of them when they are turned off, so a show that uses
// neither pays nothing: no process, no ports, no audio and no work in the engine tick.
import {Helper} from './io.mjs';
export class Modules{
 constructor(engine){this.engine=engine;this.io=null;this.sound=null;this.midi=null}
 async apply(cfg){
  const e=this.engine;if(!this.io){this.io=new Helper(e);this.io.start()}
  if(cfg.sound?.enabled&&!this.sound){const {Sound}=await import('./sound.mjs');this.sound=new Sound(e,this.io);e.log('Sound module on')}
  else if(!cfg.sound?.enabled&&this.sound){this.sound.close();this.sound=null;e.log('Sound module off')}
  if(cfg.midi?.enabled&&!this.midi){const {Midi}=await import('./midi.mjs');this.midi=new Midi(e,this.io);e.log('MIDI module on')}
  else if(!cfg.midi?.enabled&&this.midi){this.midi.close();this.midi=null;e.log('MIDI module off')}
  this.sound?.configure();this.midi?.configure();
 }
 changed(force=false){this.midi?.changed(force)}
 // Extra runtime fields, only while something needs them: the controller's fader bank and last input while one is connected.
 // runtime.sound: the input level and hit counts whenever an input is open (the desk's meter and hit blinks).
 live(){const out={};const s=this.sound;if(s?.opened?.ok)out.sound={input:s.input,meter:s.levels,hits:s.hits,device:s.opened.device};const c=this.midi?.live();if(c)out.controller=c;return out}
 checks(){return [...this.io.checks(),...(this.sound?.checks()??[]),...(this.midi?.checks()??[])]}
 async close(){this.sound?.close();this.midi?.close();this.sound=this.midi=null;await this.io?.close();this.io=null}
}
