import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {artPoll,parsePollReply,checkConnection,interfaceFor} from '../engine/output.mjs';
// output.check proves the network path to the console/node without DMX: source on this Mac, same subnet, ping, ArtPoll reply.
const list=[{name:'lo0',address:'127.0.0.1',netmask:'255.0.0.0',internal:true},{name:'en12',address:'10.0.0.50',netmask:'255.0.0.0',internal:false},{name:'en0',address:'172.16.20.232',netmask:'255.255.255.0',internal:false}];
function reply({ip=[10,0,0,1],name='Hog 4',net=0,sub=0,outs=[0,1,2,3]}={}){
 const b=Buffer.alloc(239);b.write('Art-Net\0',0,'ascii');b.writeUInt16LE(0x2100,8);b.set(ip,10);b.writeUInt16LE(6454,14);b[18]=net;b[19]=sub;b.write(name,26,'latin1');b.write(name+' FixtureNet',44,'latin1');
 b.writeUInt16BE(outs.length,172);outs.forEach((u,i)=>{b[174+i]=0x80;b[190+i]=u});return b}
const pingOK=async()=>({sent:3,received:3,ms:.5,ok:true,error:null}),pingNo=async()=>({sent:3,received:0,ms:null,ok:false,error:'Timed out'});
const pollWith=(...r)=>async()=>({sent:true,error:null,note:null,replies:r});
test('ArtPoll is a 14-byte Art-Net 4 poll and ArtPollReply is parsed into name and output universes',()=>{
 const p=artPoll();assert.equal(p.length,14);assert.equal(p.toString('ascii',0,8),'Art-Net\0');assert.equal(p.readUInt16LE(8),0x2000);assert.equal(p.readUInt16BE(10),14);
 const r=parsePollReply(reply({net:0,sub:1,outs:[0,2]}));assert.equal(r.ip,'10.0.0.1');assert.equal(r.shortName,'Hog 4');assert.deepEqual(r.outputUniverses,[16,18]);
 assert.equal(parsePollReply(artPoll()),null);assert.equal(parsePollReply(Buffer.from('junk')),null);
});
test('checkConnection passes every step when the node answers ping and Art-Net',async()=>{
 const c=await checkConnection({source:'10.0.0.50',target:'10.0.0.1'},{list,pinger:pingOK,poller:pollWith({...parsePollReply(reply()),from:'10.0.0.1'})});
 assert.equal(c.ok,true);assert.equal(c.artnet,true);assert.deepEqual(c.steps.map(s=>s.id),['source','route','ping','artnet']);assert.match(c.steps[3].label,/Art-Net is on: Hog 4.*0, 1, 2, 3/);assert.match(c.note,/No DMX/);
});
test('checkConnection names the failing step: wrong source, wrong subnet, no ping, no Art-Net',async()=>{
 const missing=await checkConnection({source:'10.0.0.60',target:'10.0.0.1'},{list,pinger:pingNo,poller:pollWith()});
 assert.equal(missing.ok,false);assert.equal(missing.steps[0].ok,false);assert.match(missing.steps[0].label,/not on any network adapter/);
 const subnet=await checkConnection({source:'10.0.0.50',target:'172.16.20.9'},{list,pinger:pingOK,poller:pollWith()});
 assert.equal(subnet.steps[1].ok,false);assert.match(subnet.steps[1].label,/en0/);assert.equal(subnet.steps[3].ok,false);
 await assert.rejects(checkConnection({source:'10.0.0.50',target:'10.0.0.255'},{list}),/unicast/);
 assert.equal(interfaceFor('192.168.1.5',list),null);
});
test('output.status and output.check read back through the engine without sending DMX',async()=>{
 let sent=0;const output={armed:false,send(){sent++},status(){return {armed:false,packets:0,lastSent:null,lastError:null,receiver:'Unconfirmed',interfaces:list}},check:c=>checkConnection(c,{list,pinger:pingOK,poller:pollWith({...parsePollReply(reply()),from:c.target})}),async arm(){},close(){}};
 const e=new Engine({output});const s=await e.command('output.status');
 assert.equal(s.armed,false);assert.equal(s.target,e.show.settings.target);assert.match(s.note,/nothing is sent/);assert.equal(s.lastCheck,null);
 const c=await e.command('output.check',{target:'10.0.0.2'});assert.equal(c.target,'10.0.0.2');assert.equal(c.ok,true);
 assert.equal(e.show.settings.target,'10.0.0.1','checking another address does not save it');assert.equal((await e.command('output.status')).lastCheck.target,'10.0.0.2');assert.equal(sent,0);
});
test('MCP exposes the output status and check tools as read-only',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 for(const n of ['lights_output_status','lights_output_check']){assert.ok(by(n),n);assert.equal(by(n).annotations.readOnlyHint,true)}
 assert.ok(by('lights_output_check').inputSchema.properties.target);
});
