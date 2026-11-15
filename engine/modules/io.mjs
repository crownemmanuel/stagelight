// The native helper, stagelight-io (src-tauri/io): CoreAudio input with hit detection, and CoreMIDI ports. Spoken to as
// newline-delimited JSON over stdin/stdout (protocol in docs/MIDI-AND-SOUND.md). Spawned only while a module needs it.
// Live-show behaviour: if the helper exits it is started again after 1, 2, 5, 10 then every 30 s (the count resets once
// it has run for a minute); if it stops answering for 25 s it is killed and restarted the same way. Every restart is
// followed by its device list, which makes the sound and MIDI modules reopen the input, the virtual port and the APC40.
import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export const BACKOFF=[1000,2000,5000,10000,30000];
const STABLE=60000,QUIET=15000,ANSWER=10000,WATCH=5000,MAX_LINE=1e6;
// LIGHTS_IO_BIN first (tests point it at a Node fake), then next to the bundled node (desktop app), then a dev build.
export function findHelper(){
 const name=process.platform==='win32'?'stagelight-io.exe':'stagelight-io';
 return [process.env.LIGHTS_IO_BIN,path.join(path.dirname(process.execPath),name),path.join(here,'../../src-tauri/target/release',name),path.join(here,'../../src-tauri/target/debug',name)].filter(Boolean).find(p=>fs.existsSync(p))??null;
}
const list=v=>Array.isArray(v)?v:[];
export class Helper{
 constructor(engine,{backoff=BACKOFF,quietMs=QUIET,answerMs=ANSWER,watchMs=WATCH}={}){
  this.engine=engine;this.child=null;this.handlers=new Map();this.devices=null;this.devicesKey=null;this.error=null;this.buf='';
  this.backoff=backoff;this.quietMs=quietMs;this.answerMs=answerMs;this.watchMs=watchMs;
  this.closed=false;this.restarts=0;this.attempt=0;this.retry=null;this.watch=null;this.startedAt=0;this.lastLine=0;this.pingAt=0;this.said=new Map();
 }
 // The same message at most once per 10 s, so a helper that repeats an error cannot flood the audit log.
 log(message){const now=Date.now(),last=this.said.get(message);if(last&&now-last<10000)return;if(this.said.size>200)this.said.clear();this.said.set(message,now);this.engine.log(message)}
 start(){
  if(this.closed)return;clearTimeout(this.retry);this.retry=null;
  const bin=findHelper();if(!bin){this.error='The native helper (stagelight-io) is not installed';this.log(this.error);return}
  const script=/\.m?js$/.test(bin);let child;
  try{child=spawn(script?process.execPath:bin,script?[bin]:[],{stdio:['pipe','pipe','pipe']})}catch(e){this.error=e.message;this.log('Helper could not start: '+e.message);this.again();return}
  this.child=child;this.error=null;this.buf='';this.devices=null;this.devicesKey=null;this.startedAt=this.lastLine=Date.now();this.pingAt=0;
  child.stdout.setEncoding('utf8');child.stdin.on('error',()=>{});child.stdout.on('error',()=>{});child.stderr.on('error',()=>{});
  child.stdout.on('data',d=>{if(this.child!==child)return;this.lastLine=Date.now();this.buf+=d;let i;while((i=this.buf.indexOf('\n'))>=0){const line=this.buf.slice(0,i);this.buf=this.buf.slice(i+1);if(line.trim())this.receive(line)}
   if(this.buf.length>MAX_LINE){this.buf='';this.log('Helper: dropped an over-long line')}});
  child.stderr.on('data',d=>this.log('Helper: '+String(d).trim().slice(0,200)));
  child.on('error',e=>{this.error=e.message;if(this.child===child)this.lost(child,e.message)});
  child.on('exit',(code,signal)=>{if(this.child===child)this.lost(child,`The native helper stopped (${code??signal})`)});
  clearInterval(this.watch);this.watch=setInterval(()=>this.check(),this.watchMs);this.watch.unref?.();
  this.send({op:'devices'});
 }
 // The helper went away without being asked to: tell the modules, then start it again after the next back-off step.
 lost(child,why){
  this.child=null;this.error=why;this.log(why);try{child.kill('SIGKILL')}catch{}
  this.emit({ev:'stopped'});this.again();
 }
 again(){
  if(this.closed||this.retry)return;if(this.startedAt&&Date.now()-this.startedAt>=STABLE)this.attempt=0;
  const ms=this.backoff[Math.min(this.attempt,this.backoff.length-1)];this.attempt++;this.restarts++;
  this.log(`Restarting the native helper in ${ms/1000} s`);this.retry=setTimeout(()=>{this.retry=null;this.start()},ms);this.retry.unref?.();
 }
 // Hang check, a few times a minute (never per frame): after quietMs of silence ask for the device list; no answer
 // within answerMs means the helper is stuck, so it is killed and restarted.
 check(){
  const c=this.child;if(!c)return;const now=Date.now();
  if(this.pingAt&&this.lastLine<this.pingAt&&now-this.pingAt>=this.answerMs){this.pingAt=0;this.lost(c,'The native helper stopped answering');return}
  if(now-this.lastLine>=this.quietMs&&!(this.pingAt&&this.lastLine<this.pingAt)){this.pingAt=now;this.send({op:'devices'})}
 }
 // Bad output (not JSON, not an object, wrong shapes) is dropped here, never thrown inside the stream handler.
 receive(line){
  let m;try{m=JSON.parse(line)}catch{return}if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.ev!=='string')return;
  if(m.ev==='devices'){
   const d={ev:'devices',audio:list(m.audio).filter(a=>a&&typeof a.name==='string'),midiIn:list(m.midiIn).filter(n=>typeof n==='string'),midiOut:list(m.midiOut).filter(n=>typeof n==='string')};
   const key=JSON.stringify(d);this.devices=d;if(key===this.devicesKey)return;this.devicesKey=key;m=d;
  }
  if(m.ev==='error')this.log('Helper: '+String(m.message??'').slice(0,200));
  this.emit(m);
 }
 emit(m){for(const f of [...(this.handlers.get(m.ev)??[])])try{f(m)}catch(e){this.log('Module: '+e.message)}}
 // Returns a function that removes the handler, so a module that turns off leaves nothing behind.
 on(ev,f){const list=this.handlers.get(ev)??[];list.push(f);this.handlers.set(ev,list);return ()=>{const rest=(this.handlers.get(ev)??[]).filter(x=>x!==f);if(rest.length)this.handlers.set(ev,rest);else this.handlers.delete(ev)}}
 send(msg){try{if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(msg)+'\n')}catch(e){this.log('Helper: '+e.message)}}
 ready(ms=2000){if(this.devices||!this.child)return Promise.resolve();return new Promise(res=>{const off=this.on('devices',()=>{off();clearTimeout(t);res()}),t=setTimeout(()=>{off();res()},ms)})}
 refresh(){this.send({op:'devices'})}
 summary(){return {running:!!this.child,error:this.error,restarts:this.restarts}}
 checks(){return [{id:'helper',label:'Sound and MIDI helper',state:this.child?'pass':'fail',detail:this.child?(this.restarts?`Running · restarted ${this.restarts}×`:'Running'):(this.error??'Not running')+(this.retry?' · restarting':'')}]}
 async close(){
  this.closed=true;clearTimeout(this.retry);this.retry=null;clearInterval(this.watch);this.watch=null;
  const c=this.child;this.child=null;this.handlers.clear();if(!c)return;
  try{c.stdin.write(JSON.stringify({op:'quit'})+'\n')}catch{}
  await new Promise(res=>{if(c.exitCode!==null||c.signalCode!==null)return res();const t=setTimeout(()=>{try{c.kill('SIGKILL')}catch{}res()},800);c.once('exit',()=>{clearTimeout(t);res()})});
 }
}
