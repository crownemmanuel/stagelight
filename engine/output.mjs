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
}
