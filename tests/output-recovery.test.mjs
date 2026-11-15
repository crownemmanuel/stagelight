// Output and tick faults during a show (docs/SHOW-SAFETY.md): the rig is never switched off by a transient failure.
import test from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import fs from 'node:fs';import path from 'node:path';
import {Output} from '../engine/output.mjs';import {Engine} from '../engine/engine.mjs';
const source=Object.values(os.networkInterfaces()).flat().find(i=>i.family==='IPv4'&&!i.internal)?.address;
// A stand-in for a UDP socket: bind can be refused and sends can fail on demand.
function rig(){const net={sockets:[],bindError:null,sendError:null,sent:0},clock={t:0},logs=[];
 const socketFactory=()=>{const h={},s={closed:false,on(ev,f){h[ev]=f},once(ev,f){h[ev]=f},removeListener(ev){delete h[ev]},bind(port,addr,cb){setImmediate(()=>net.bindError?h.error?.(Error(net.bindError)):cb())},send(buf,port,host,cb){setImmediate(()=>{if(net.sendError)cb(Error(net.sendError));else{net.sent++;cb(null)}})},close(){s.closed=true},emit(ev,e){h[ev]?.(e)}};net.sockets.push(s);return s};
 return {net,clock,logs,out:new Output(m=>logs.push(m),{socketFactory,retryMs:5,reopenAfterMs:2000,now:()=>clock.t})}}
const packets=()=>new Map([[0,Buffer.alloc(512)],[1,Buffer.alloc(512)]]),settle=(ms=15)=>new Promise(r=>setTimeout(r,ms));

test('a failed send never disarms output: it keeps trying, reopens the socket and carries on when the link is back',{skip:!source&&'no network adapter on this machine'},async()=>{
 const {net,clock,logs,out}=rig();await out.arm({source,target:'10.255.255.1'});
 out.send(packets());await settle();assert.equal(net.sent,2);assert.equal(out.status().failing,false);
 // The cable is pulled: every send fails.
 net.sendError='ENETDOWN';for(let i=0;i<30;i++){clock.t+=33;out.send(packets())}await settle();
 assert.equal(out.armed,true,'still armed');assert.equal(out.status().failing,true);assert.equal(out.status().lastError,'ENETDOWN');assert.equal(out.status().sendErrors,60);
 assert.equal(logs.filter(l=>/send failing/.test(l)).length,1,'one log line for the whole outage so far');assert.equal(net.sockets.length,1,'under two seconds: same socket');
 // After two seconds of failures the socket is replaced, still armed.
 clock.t+=2100;out.send(packets());await settle();assert.ok(net.sockets.length>=2);assert.equal(net.sockets[0].closed,true);assert.equal(out.armed,true);
 // The link returns.
 net.sendError=null;const before=net.sent;clock.t+=33;out.send(packets());await settle();assert.equal(net.sent,before+2);assert.equal(out.status().failing,false);assert.ok(logs.some(l=>/sending again after/.test(l)));
 out.close();assert.equal(out.armed,false);
});
test('a socket error while armed reopens the socket; while the adapter is gone it retries until it is back; disarm stops the retries',{skip:!source&&'no network adapter on this machine'},async()=>{
 const {net,logs,out}=rig();await out.arm({source,target:'10.255.255.1'});
 net.bindError='EADDRNOTAVAIL';net.sockets[0].emit('error',Error('EPIPE'));await settle(40);
 assert.equal(out.armed,true);assert.equal(out.status().recovering,true);assert.equal(out.status().failing,true);assert.ok(net.sockets.length>3,'kept retrying');out.send(packets());await settle();assert.equal(net.sent,0,'nothing to send on, and no throw');
 net.bindError=null;await settle(30);assert.equal(out.status().recovering,false);assert.ok(logs.some(l=>/socket reopened/.test(l)));out.send(packets());await settle();assert.equal(net.sent,2);
 net.bindError='EADDRNOTAVAIL';net.sockets.at(-1).emit('error',Error('EPIPE'));await settle(20);out.close();const n=net.sockets.length;await settle(40);assert.equal(net.sockets.length,n,'no retries after disarm');assert.equal(out.status().failing,false);
 await assert.rejects(new Output(()=>{}).arm({source:'10.254.254.254',target:'10.255.255.1'}),/not present on this Mac/);
});

const fakeOut=()=>({armed:true,sends:[],send(p){this.sends.push(p)},status(){return {armed:this.armed,packets:this.sends.length,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
test('a frame that cannot be built keeps output armed on the last good frame, then lets go of what is failing',async()=>{
 const clock={t:0},output=fakeOut(),e=new Engine({output,clock:()=>clock.t});const step=()=>{clock.t+=1/30;return e.safeTick()};
 await e.command('masters.assign',{slot:'m1',cue:'first-light',action:'toggle'});await e.command('masters.trigger',{slot:'m1',down:true});await e.command('cue.play',{id:'afterglow'});
 assert.equal(step(),true);const good=output.sends.at(-1);assert.ok(good.size>0);assert.deepEqual(e.runtime().running.map(r=>r.id),['afterglow','first-light']);
 // Something in the newest cue breaks the frame.
 const compose=e.composite.bind(e);e.composite=(top,layers)=>{if(top.cue.id==='afterglow')throw Error('bad frame');return compose(top,layers)};
 const logs=e.logs.length;assert.equal(step(),false);assert.equal(step(),false);
 assert.equal(output.armed,true,'output stays armed');assert.equal(output.sends.at(-1),good,'the last good frame is sent again');assert.equal(e.runtime().engineError.message,'bad frame');
 assert.equal(e.logs.slice(logs).filter(l=>/Engine error: bad frame/.test(l.message)).length,1,'logged once');
 // Third failure in a row: the newest cue is let go and the show carries on with the one underneath.
 assert.equal(step(),false);assert.ok(e.logs.some(l=>/stopped cue Afterglow to recover/i.test(l.message)));
 assert.equal(step(),true);assert.deepEqual(e.runtime().running.map(r=>r.id),['first-light']);assert.notEqual(output.sends.at(-1),good);assert.equal(output.armed,true);
});

test('a show edit still takes effect when the disk refuses the save, and says so until saving works again',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lights-disk-'));try{
  const e=new Engine({dataDir:dir,output:fakeOut()});fs.chmodSync(dir,0o555);// the folder refuses new files
  const logs=e.logs.length,r=await e.command('settings.set',{sceneFade:4});assert.equal(r.ok,true);assert.equal(e.show.playback.sceneFade,4,'live in memory');
  assert.ok(r.runtime.showFile.error);await e.command('settings.set',{sceneFade:5});assert.equal(e.logs.slice(logs).filter(l=>/could NOT be saved/.test(l.message)).length,1,'said once');
  assert.equal((await e.command('show.check',{network:false})).rows.find(x=>x.id==='saving').state,'fail');
  fs.chmodSync(dir,0o755);const ok=await e.command('settings.set',{sceneFade:6});assert.equal(ok.runtime.showFile.error,undefined);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'show.json'),'utf8')).playback.sceneFade,6);
 }finally{try{fs.chmodSync(dir,0o755)}catch{}fs.rmSync(dir,{recursive:true,force:true})}
});
test('this Mac is held awake only while output is armed',{skip:process.platform!=='darwin'&&'macOS only'},async()=>{
 const e=new Engine({output:fakeOut(),keepAwake:true});e.output.armed=false;const wait=async f=>{for(let i=0;i<100&&!f();i++)await new Promise(r=>setTimeout(r,10))};
 await e.command('master.set',{value:1});assert.equal(e.awake,null,'nothing runs while disarmed');
 await e.command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'}).catch(()=>{});e.output.armed=true;await e.command('master.set',{value:1});await wait(()=>e.awake&&e.awake!=='starting');
 const child=e.awake;assert.ok(child.pid>0);assert.equal(child.spawnfile,'/usr/bin/caffeinate');assert.ok(child.spawnargs.includes(String(process.pid)));
 assert.equal((await e.command('show.check',{network:false})).rows.find(x=>x.id==='awake').state,'pass');
 await e.command('output.disarm',{});assert.equal(e.awake,null);await wait(()=>child.killed||child.exitCode!==null);assert.ok(child.killed||child.exitCode!==null);
 assert.equal(new Engine({output:fakeOut()}).awakeEnabled,false,'never in tests or with an injected output');
});
