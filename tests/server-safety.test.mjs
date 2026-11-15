import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import dgram from 'node:dgram';import {spawn} from 'node:child_process';
import {encodeOSC,decodeOSC} from '../engine/osc.mjs';
// server.mjs on show day (docs/SHOW-SAFETY.md): big imports, the real version on /lights/ping, an unreadable show.json at
// startup, and stray errors that must not stop the engine.
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lights-server-'));
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
// Starts the server on free ports; resolves when it is ready, or with the exit code and stderr if it exits first.
async function start(dir,{script,env:extra={}}={}){
 const port=await freePort(),osc=await freePort(),env={...process.env,...extra,LIGHTS_PORT:String(port),LIGHTS_OSC_PORT:String(osc),LIGHTS_DATA_DIR:dir,LIGHTS_SHOWS_DIR:path.join(dir,'shows')};
 const child=spawn(process.execPath,script?['--input-type=module','-e',script]:[path.resolve('server.mjs')],{env,stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=d);
 const exit=new Promise(r=>child.once('exit',code=>r(code)));
 const ready=await Promise.race([new Promise(r=>child.stdout.on('data',d=>{if(String(d).includes('LIGHTS_READY'))r(true)})),exit.then(()=>false)]);
 const base=`http://127.0.0.1:${port}`;
 return {child,port,osc,base,ready,exit,stderr:()=>err,async stop(){if(child.exitCode===null){child.kill();await exit}},
  session:()=>fetch(base+'/api/session').then(r=>r.json()),
  async command(command,args={},body){const {token}=await this.session();const r=await fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:body??JSON.stringify({command,args})});return {status:r.status,body:await r.json()}}};
}

test('a show bigger than the old 300 000-character limit imports over HTTP; above 32 MB the answer is a clear 413',async()=>{
 const dir=tmp(),s=await start(dir);
 try{
  assert.ok(s.ready);const show=await fetch(s.base+'/api/show').then(r=>r.json());const base=show.cues[0];
  for(let i=0;show.cues.length<2000&&JSON.stringify(show).length<7e5;i++)show.cues.push({...structuredClone(base),id:`big-${i}`,name:`Big cue ${i}`});
  const size=JSON.stringify({command:'show.import',args:{show}}).length;assert.ok(size>6e5,`${size} characters`);
  const r=await s.command('show.import',{show});assert.equal(r.status,200,JSON.stringify(r.body).slice(0,300));assert.equal(r.body.ok,true);
  const back=await fetch(s.base+'/api/show').then(r=>r.json());assert.equal(back.cues.length,show.cues.length,'every cue arrived');
  const huge=JSON.stringify({command:'status',args:{pad:'x'.repeat(33*1024*1024)}});const t=await s.command(null,null,huge);
  assert.equal(t.status,413);assert.match(t.body.error,/Request too large: the limit is 32 MB/);
  assert.equal((await s.command('status')).status,200,'the server is fine afterwards');
  const bad=await s.command(null,null,'{not json');assert.equal(bad.status,400);assert.match(bad.body.error,/not valid JSON/);
 }finally{await s.stop();fs.rmSync(dir,{recursive:true,force:true})}
});

test('/lights/ping answers with the real package version',async()=>{
 const dir=tmp(),s=await start(dir),sock=dgram.createSocket('udp4');
 try{
  assert.ok(s.ready);await new Promise(r=>sock.bind(0,'127.0.0.1',r));
  const got=new Promise(r=>sock.once('message',m=>r(decodeOSC(m))));sock.send(encodeOSC('/lights/ping',[]),s.osc,'127.0.0.1');
  const hello=await got;assert.equal(hello.address,'/lights/hello');assert.deepEqual(hello.args,[version,0]);
 }finally{sock.close();await s.stop();fs.rmSync(dir,{recursive:true,force:true})}
});

test('an unreadable show.json is moved aside and the newest version that loads is restored, with a plain log line',async()=>{
 const dir=tmp();
 try{
  // A first run writes a good show; keep it as an older version, then break show.json and add a newer broken version.
  const a=await start(dir);const good=await fetch(a.base+'/api/show').then(r=>r.json());await a.stop();
  good.name='Restored from version';const versions=path.join(dir,'versions');fs.mkdirSync(versions,{recursive:true});
  fs.writeFileSync(path.join(versions,'2026-11-01T10-00-00-000Z-edits.json'),JSON.stringify(good));
  fs.writeFileSync(path.join(versions,'2026-11-02T10-00-00-000Z-edits.json'),'{"truncated":');
  fs.writeFileSync(path.join(dir,'show.json'),'{"fixtures":[1,2');
  const s=await start(dir);
  try{
   assert.ok(s.ready,s.stderr());const show=await fetch(s.base+'/api/show').then(r=>r.json());assert.equal(show.name,'Restored from version');
   const aside=fs.readdirSync(dir).filter(f=>/^show\.unreadable-.+\.json$/.test(f));assert.equal(aside.length,1);assert.equal(fs.readFileSync(path.join(dir,aside[0]),'utf8'),'{"fixtures":[1,2','the bad file is kept as it was');
   const logs=(await fetch(s.base+'/api/state').then(r=>r.json())).runtime?.logs??(await fetch(s.base+'/api/state').then(r=>r.json())).logs;
   const text=JSON.stringify(logs);assert.match(text,/show\.json could not be read/);assert.match(text,/restored from version 2026-11-01T10-00-00-000Z-edits/);
   assert.match(s.stderr(),/Version 2026-11-02T10-00-00-000Z-edits did not load either/);
  }finally{await s.stop()}
  // A valid show.json is never touched, even when another file is broken.
  fs.writeFileSync(path.join(dir,'show-files.json'),'null');fs.writeFileSync(path.join(dir,'live-state.json'),'{"armed":');
  const again=await start(dir);try{assert.ok(again.ready,again.stderr());assert.equal(fs.readdirSync(dir).filter(f=>/^show\.unreadable-/.test(f)).length,1)}finally{await again.stop()}
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('with no version that loads, startup exits naming the bad file and leaves it in place',async()=>{
 const dir=tmp();
 try{
  fs.writeFileSync(path.join(dir,'show.json'),'{broken');fs.mkdirSync(path.join(dir,'versions'));fs.writeFileSync(path.join(dir,'versions','2026-11-02T10-00-00-000Z-edits.json'),'[]');
  const s=await start(dir);assert.equal(s.ready,false);assert.equal(await s.exit,1);
  assert.match(s.stderr(),new RegExp(`cannot start: ${path.join(dir,'show.json').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} is unreadable`));
  assert.equal(fs.readFileSync(path.join(dir,'show.json'),'utf8'),'{broken','never replaced by an empty show');
  assert.deepEqual(fs.readdirSync(dir).filter(f=>/^show\.unreadable-/.test(f)),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('stray rejections and exceptions are logged, rate-limited, and the engine keeps running',async()=>{
 const dir=tmp(),url=new URL('../server.mjs',import.meta.url).href;
 const s=await start(dir,{script:`await import(${JSON.stringify(url)});for(let i=0;i<200;i++){Promise.reject(new Error('stray rejection'));setTimeout(()=>{throw new Error('stray exception')},5)}setTimeout(()=>{Promise.reject(new Error('later rejection'))},300)`});
 try{
  assert.ok(s.ready,s.stderr());await new Promise(r=>setTimeout(r,600));
  assert.ok((await s.session()).token,'still answering');assert.equal(s.child.exitCode,null);
  const err=s.stderr();assert.equal(err.match(/Unhandled rejection: Error: stray rejection/g)?.length,1,'the same error once per 10 s');assert.equal(err.match(/Uncaught exception: Error: stray exception/g)?.length,1);
  assert.match(err,/later rejection/);assert.match(err,/similar reports held back/);
  const audit=fs.readFileSync(path.join(dir,'audit.jsonl'),'utf8');assert.ok((audit.match(/Engine kept running after/g)?.length??0)<=3,'the audit log is not flooded');
 }finally{await s.stop();fs.rmSync(dir,{recursive:true,force:true})}
});

test('a command that never settles stops holding up the queue after the wait, and is logged',async()=>{
 const dir=tmp(),engineUrl=new URL('../engine/engine.mjs',import.meta.url).href,url=new URL('../server.mjs',import.meta.url).href;
 const s=await start(dir,{env:{LIGHTS_QUEUE_WAIT_MS:'300'},script:`const {Engine}=await import(${JSON.stringify(engineUrl)});const run=Engine.prototype.command;Engine.prototype.command=function(n,a,o){return n==='test.hang'?new Promise(()=>{}):run.call(this,n,a,o)};await import(${JSON.stringify(url)})`});
 try{
  assert.ok(s.ready,s.stderr());const {token}=await s.session(),abort=new AbortController();
  fetch(s.base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command:'test.hang'}),signal:abort.signal}).catch(()=>{});
  await new Promise(r=>setTimeout(r,50));const t0=Date.now(),r=await s.command('master.set',{value:.5});abort.abort();
  assert.equal(r.status,200);assert.equal(r.body.ok,true);const waited=Date.now()-t0;assert.ok(waited>=200&&waited<3000,`ran after the wait (${waited} ms)`);
  const logs=JSON.stringify((await fetch(s.base+'/api/state').then(r=>r.json())));assert.match(logs,/test\.hang is still running after 0\.3 s/);
 }finally{await s.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
