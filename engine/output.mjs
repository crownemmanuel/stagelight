import dgram from 'node:dgram';
import os from 'node:os';
import net from 'node:net';
import {artDmx} from './render.mjs';
export const interfaces=()=>Object.entries(os.networkInterfaces()).flatMap(([name,items])=>items.filter(i=>i.family==='IPv4').map(i=>({name,address:i.address,netmask:i.netmask,internal:i.internal})));
export function validateNetwork(c){for(const key of ['source','target']){if(!net.isIPv4(c[key]))throw Error(`${key} must be an IPv4 address`);const n=c[key].split('.').map(Number);if(n[0]===0||n[0]>=224||n[3]===255)throw Error('Only specific unicast addresses are allowed')}if(c.source===c.target)throw Error('Source and destination must differ')}
export class Output{
 constructor(log){this.log=log;this.socket=null;this.armed=false;this.sequence=0;this.stats={packets:0,bytes:0,lastSent:null,lastError:null,armedAt:null,receiver:'Unconfirmed · ArtDMX has no acknowledgment'};}
 async arm(config){validateNetwork(config);if(!interfaces().some(x=>x.address===config.source))throw Error(`Source ${config.source} is not present on this Mac`);if(this.socket)throw Error('Output already active');
  const socket=dgram.createSocket('udp4');
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(6454,config.source,()=>{socket.removeListener('error',reject);resolve()})}).catch(e=>{socket.close();throw e});
  this.socket=socket;this.config={...config};this.armed=true;this.stats.lastError=null;this.stats.armedAt=new Date().toISOString();
  socket.on('error',e=>{this.stats.lastError=e.message;this.log('Output error: '+e.message);this.close()});this.log('Physical output armed');
 }
 send(universes){if(!this.armed)return;const seq=this.sequence=this.sequence%255+1;
  for(const [u,d] of universes){const p=artDmx(u,d,seq);this.socket.send(p,6454,this.config.target,e=>{if(e){this.stats.lastError=e.message;this.log('Send failed: '+e.message);this.close()}else{this.stats.packets++;this.stats.bytes+=p.length;this.stats.lastSent=new Date().toISOString()}})}
 }
 close(){this.armed=false;if(this.socket){try{this.socket.close()}catch{}this.socket=null}}
 status(){return {armed:this.armed,...this.stats,interfaces:interfaces()}}
 check(config){return checkConnection(config,{socket:this.armed?this.socket:null})}
}

// ── Connection check (output.check): proves the network path without sending any DMX ──
// ArtPoll (OpCode 0x2000, Art-Net 4) asks Art-Net devices to identify themselves with ArtPollReply (0x2100).
// A reply proves the device at the destination speaks Art-Net; it still does not prove a fixture will respond.
export function artPoll(){const p=Buffer.alloc(14);p.write('Art-Net\0',0,'ascii');p.writeUInt16LE(0x2000,8);p.writeUInt16BE(14,10);p[12]=0x02;p[13]=0;return p}
const text=(b,from,len)=>b.subarray(from,from+len).toString('latin1').replace(/\0[\s\S]*$/,'').trim();
export function parsePollReply(b){
 if(b.length<207||b.toString('ascii',0,8)!=='Art-Net\0'||b.readUInt16LE(8)!==0x2100)return null;
 const net=b[18]&0x7f,sub=b[19]&0x0f,ports=Math.min(4,b.readUInt16BE(172)),outputs=[];
 for(let i=0;i<ports;i++)if(b[174+i]&0x80)outputs.push(net<<8|sub<<4|(b[190+i]&0x0f));
 return {ip:[...b.subarray(10,14)].join('.'),shortName:text(b,26,18),longName:text(b,44,64),report:text(b,108,64),firmware:b.readUInt16BE(16),oem:b.readUInt16BE(20),esta:b.readUInt16LE(24),ports,outputUniverses:outputs};
}
export function interfaceFor(ip,list=interfaces()){const n=s=>s.split('.').reduce((a,x)=>(a*256)+Number(x),0);return list.find(i=>!i.internal&&(n(i.address)&n(i.netmask))>>>0===(n(ip)&n(i.netmask))>>>0)??null}
export async function ping(target,timeoutS=3){
 const {execFile}=await import('node:child_process');const mac=process.platform==='darwin';
 const args=process.platform==='win32'?['-n','3','-w',String(timeoutS*1000),target]:mac?['-c','3','-t',String(timeoutS),target]:['-c','3','-w',String(timeoutS),target];
 return new Promise(resolve=>execFile('ping',args,{timeout:(timeoutS+2)*1000},(err,stdout='')=>{const got=/(\d+)\s+(?:packets\s+)?received/.exec(stdout),rtt=/=\s*[\d.]+\/([\d.]+)\//.exec(stdout);const received=got?+got[1]:0;resolve({sent:3,received,ms:rtt?+rtt[1]:null,ok:received>0,error:received?null:err?.killed?'Timed out':(err&&!got?err.message:null)})}));
}
// Listen on UDP 6454 (where Art-Net replies go). While armed the output socket already owns the port, so reuse it.
export async function pollNode(config,{socket=null,timeoutMs=1500}={}){
 const replies=[],own=!socket;let note=null;
 if(own){socket=dgram.createSocket({type:'udp4',reuseAddr:true});
  await new Promise(resolve=>{socket.once('error',e=>{note='UDP 6454 is busy ('+e.code+'): another Art-Net program may be running. Replies sent to 6454 could be missed.';socket.close();socket=dgram.createSocket('udp4');socket.bind(0,config.source,resolve)});socket.bind(6454,resolve)});}
 const onMessage=(m,rinfo)=>{const r=parsePollReply(m);if(r&&!replies.some(x=>x.ip===r.ip&&x.from===rinfo.address))replies.push({...r,from:rinfo.address})};
 socket.on('message',onMessage);
 const sendError=await new Promise(resolve=>socket.send(artPoll(),6454,config.target,e=>resolve(e?.message??null)));
 await new Promise(r=>setTimeout(r,timeoutMs));socket.off('message',onMessage);if(own)try{socket.close()}catch{}
 return {sent:!sendError,error:sendError,note,replies};
}
// Every step is reported separately so the desk and agents can say which part of the path failed.
export async function checkConnection(config,{socket=null,list=interfaces(),pinger=ping,poller=pollNode}={}){
 validateNetwork(config);const source=list.find(i=>i.address===config.source)??null,route=interfaceFor(config.target,list);
 const [reach,poll]=await Promise.all([pinger(config.target),source?poller(config,{socket}):Promise.resolve({sent:false,error:'Source address is not on this Mac',note:null,replies:[]})]);
 const node=poll.replies.find(r=>r.ip===config.target||r.from===config.target)??poll.replies[0]??null;
 const steps=[
  {id:'source',ok:!!source,label:source?`${config.source} is on ${source.name}`:`${config.source} is not on any network adapter. Plug in the lighting network or pick another source.`},
  {id:'route',ok:!!route&&route.address===config.source,label:!route?`No adapter is on the same subnet as ${config.target}`:route.address===config.source?`${config.target} is on the same subnet as ${config.source}`:`${config.target} is on ${route.name} (${route.address}), not on the chosen source ${config.source}`},
  {id:'ping',ok:reach.ok,label:reach.ok?`${config.target} answers ping (${reach.received}/${reach.sent}${reach.ms!==null?`, ${reach.ms} ms`:''})`:`${config.target} does not answer ping${reach.error?' · '+reach.error:''}. Some devices block ping, so also read the Art-Net step.`},
  {id:'artnet',ok:!!node,label:node?`Art-Net is on: ${node.shortName||node.longName||node.ip} replied${node.outputUniverses.length?` · outputs on Art-Net ${node.outputUniverses.join(', ')}`:' · it lists no DMX output ports (normal for a console)'}`:poll.error?`Art-Net poll failed: ${poll.error}`:`No Art-Net reply from ${config.target}. Check Art-Net is enabled on the console or node, or it may not answer polls.`}];
 return {at:new Date().toISOString(),source:config.source,target:config.target,port:6454,ok:steps.every(s=>s.ok),reachable:reach.ok,artnet:!!node,node,devices:poll.replies,ping:reach,poll:{sent:poll.sent,error:poll.error,note:poll.note},steps,
  note:'No DMX is sent by this check. An Art-Net reply proves the device speaks Art-Net, not that any fixture responded.'};
}
