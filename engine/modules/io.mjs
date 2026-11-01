// The native helper, stagelight-io (src-tauri/io): CoreAudio input with hit detection, and CoreMIDI ports. Spoken to as
// newline-delimited JSON over stdin/stdout (protocol in docs/MIDI-AND-SOUND.md). Spawned only while a module needs it.
import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
// LIGHTS_IO_BIN first (tests point it at a Node fake), then next to the bundled node (desktop app), then a dev build.
export function findHelper(){
 const name=process.platform==='win32'?'stagelight-io.exe':'stagelight-io';
 return [process.env.LIGHTS_IO_BIN,path.join(path.dirname(process.execPath),name),path.join(here,'../../src-tauri/target/release',name),path.join(here,'../../src-tauri/target/debug',name)].filter(Boolean).find(p=>fs.existsSync(p))??null;
}
// A helper that stops on its own (a crash, a driver fault) is started again after 1, 2, 5, then 10 s, at most 5 times
// in a minute, so sound triggers and the APC40 come back mid-show without anyone toggling the module. Its 'devices'
// reply makes each module re-open its input and ports. A helper stopped on purpose (close) is never restarted.
export const BACKOFF=[1,2,5,10];
export class Helper{
 constructor(engine){this.engine=engine;this.child=null;this.handlers=new Map();this.devices=null;this.error=null;this.buf='';this.restarts=[];this.timer=null;this.closed=false}
 restartLater(){
  if(this.closed||this.timer)return;const now=Date.now();this.restarts=this.restarts.filter(t=>now-t<60000);
  if(this.restarts.length>=5){this.error=`The native helper stopped ${this.restarts.length} times in a minute: turn the module off and on to try again`;this.engine.log(this.error);return}
  const wait=BACKOFF[Math.min(this.restarts.length,BACKOFF.length-1)];this.restarts.push(now);
  this.timer=setTimeout(()=>{this.timer=null;if(this.closed)return;this.engine.log('Restarting the native helper');this.devices=null;this.buf='';this.start()},wait*1000);this.timer.unref?.();
 }
 start(){
  const bin=findHelper();if(!bin){this.error='The native helper (stagelight-io) is not installed';this.engine.log(this.error);return}
  const script=/\.m?js$/.test(bin);let child;
  try{child=spawn(script?process.execPath:bin,script?[bin]:[],{stdio:['pipe','pipe','pipe']})}catch(e){this.error=e.message;return}
  this.child=child;this.error=null;child.stdout.setEncoding('utf8');child.stdin.on('error',()=>{});
  child.stdout.on('data',d=>{this.buf+=d;let i;while((i=this.buf.indexOf('\n'))>=0){const line=this.buf.slice(0,i);this.buf=this.buf.slice(i+1);if(line.trim())this.receive(line)}});
  child.stderr.on('data',d=>this.engine.log('Helper: '+String(d).trim().slice(0,200)));
  child.on('error',e=>{this.error=e.message;if(this.child===child)this.child=null});
  child.on('exit',code=>{if(this.child===child){this.child=null;this.error=`The native helper stopped (${code})`;this.engine.log(this.error);this.emit({ev:'stopped'});this.restartLater()}});
  this.send({op:'devices'});
 }
 receive(line){let m;try{m=JSON.parse(line)}catch{return}if(m.ev==='devices')this.devices=m;if(m.ev==='error')this.engine.log('Helper: '+m.message);this.emit(m)}
 emit(m){for(const f of this.handlers.get(m.ev)??[])try{f(m)}catch(e){this.engine.log('Module: '+e.message)}}
 // Returns a function that removes the handler, so a module that turns off leaves nothing behind.
 on(ev,f){const list=this.handlers.get(ev)??[];list.push(f);this.handlers.set(ev,list);return ()=>this.handlers.set(ev,(this.handlers.get(ev)??[]).filter(x=>x!==f))}
 send(msg){if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(msg)+'\n')}
 ready(ms=2000){if(this.devices||!this.child)return Promise.resolve();return new Promise(res=>{const off=this.on('devices',()=>{off();clearTimeout(t);res()}),t=setTimeout(()=>{off();res()},ms)})}
 refresh(){this.send({op:'devices'})}
 summary(){return {running:!!this.child,error:this.error,restarts:this.restarts.length}}
 checks(){return [{id:'helper',label:'Sound and MIDI helper',state:this.child?'pass':'fail',detail:this.child?'Running':this.error??'Not running'}]}
 async close(){
  this.closed=true;clearTimeout(this.timer);this.timer=null;const c=this.child;this.child=null;this.handlers.clear();if(!c)return;
  try{c.stdin.write(JSON.stringify({op:'quit'})+'\n')}catch{}
  await new Promise(res=>{const t=setTimeout(()=>{c.kill('SIGKILL');res()},800);c.once('exit',()=>{clearTimeout(t);res()})});
 }
}
