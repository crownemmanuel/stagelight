// All traffic in this test stays on loopback. Never contacts FixtureNet.
import assert from 'node:assert/strict';import dgram from 'node:dgram';import {artDmx} from '../engine/render.mjs';import {decodeOSC,encodeOSC} from '../engine/osc.mjs';
const base='http://127.0.0.1:1460';
const session=await fetch(base+'/api/session').then(r=>r.json());
const post=async(command,args={})=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':session.token},body:JSON.stringify({command,args})});const body=await r.json();if(!r.ok)throw Error(body.error);return body};
assert.equal((await fetch(base+'/api/command',{method:'POST',body:'{}'})).status,403);
assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://untrusted.example'}})).status,403);
await post('cue.stop',{fade:0});
const before=await fetch(base+'/api/state').then(r=>r.json());assert.equal(before.runtime.output.armed,false);
const osc=dgram.createSocket('udp4');await new Promise(r=>osc.bind(0,'127.0.0.1',r));
async function request(address,args){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('OSC reply timeout')),2000);osc.once('message',b=>{clearTimeout(timeout);resolve(decodeOSC(b))});osc.send(encodeOSC(address,args),1461,'127.0.0.1')})}
assert.equal((await request('/lights/ping',[])).address,'/lights/hello');
const rid='test-'+Date.now();assert.equal((await request('/lights/cue/play',['agent-aurora',rid])).args[2],'accepted');assert.equal((await request('/lights/cue/play',['agent-aurora',rid])).args[2],'duplicate');osc.close();
await post('cue.pause',{paused:true});await post('cue.seek',{seconds:8});
const receiver=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{receiver.once('error',reject);receiver.bind(0,'127.0.0.1',resolve)});
const sender=dgram.createSocket('udp4');
try{const received=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('ArtDmx loopback timeout')),2000);receiver.once('message',(msg,remote)=>{clearTimeout(timeout);resolve({msg,remote})})});const data=Buffer.alloc(512);data[8]=123;sender.send(artDmx(2,data,1),receiver.address().port,'127.0.0.1');const {msg,remote}=await received;assert.equal(msg.length,530);assert.equal(remote.address,'127.0.0.1');assert.equal(msg[26],123);assert.equal(msg.readUInt16LE(14),2);assert.equal(msg[18+55],0)}finally{sender.close();receiver.close()}
const after=await fetch(base+'/api/state').then(r=>r.json());assert.equal(after.runtime.output.packets,0);assert.equal(after.runtime.output.armed,false);
console.log('HTTP token/origin guards, OSC ack/deduplication and real ArtDmx UDP loopback passed. FixtureNet packets: 0.');
