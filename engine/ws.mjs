// A minimal WebSocket (RFC 6455) for the wall video link (docs/WALL-VIDEO.md): the upgrade handshake, text and binary
// messages (7-, 16- and 64-bit lengths, fragmented messages), masking, ping/pong and close. No extensions, no
// subprotocols. Node has no WebSocket server built in and the engine takes no npm dependencies, so this is it. The
// client side (connect) exists for the test sender and the tests; StageLight's own windows use the browser's WebSocket.
import crypto from 'node:crypto';
import http from 'node:http';
import {EventEmitter} from 'node:events';
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const acceptKey=key=>crypto.createHash('sha1').update(key+GUID).digest('base64');
// Answer an HTTP request that cannot become a WebSocket, then close the connection.
export function refuse(socket,status,text){try{socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)}catch{socket.destroy()}}
export class WebSocket extends EventEmitter{
 // client: this end masks what it sends and expects unmasked frames (a server expects masked ones, as the RFC says).
 constructor(socket,{client=false,maxMessage=2*1024*1024,head=null}={}){
  super();this.socket=socket;this.client=client;this.maxMessage=maxMessage;this.state='open';this.buf=Buffer.alloc(0);this.parts=[];this.size=0;this.opcode=0;this.closeTimer=null;
  this.remoteAddress=socket.remoteAddress;socket.setNoDelay?.(true);
  socket.on('data',d=>{try{this.read(d)}catch(e){this.fail(1011,'Internal error');this.emit('error',e)}});
  socket.on('end',()=>{try{socket.end()}catch{}});socket.on('close',()=>this.closed(1006,''));socket.on('error',e=>{if(this.listenerCount('error'))this.emit('error',e)});
  // Bytes that came with the handshake are read on the next turn, once the caller has its listeners on; data that
  // arrives first is appended behind them, so the order holds.
  if(head?.length){this.buf=Buffer.from(head);setImmediate(()=>{try{this.read(Buffer.alloc(0))}catch{}})}
 }
 get bufferedAmount(){return this.socket.writableLength}
 read(d){
  if(this.state==='closed'||this.failed)return;this.buf=this.buf.length?Buffer.concat([this.buf,d]):d;
  for(;;){
   const b=this.buf;if(b.length<2)return;
   const fin=(b[0]&0x80)!==0,rsv=b[0]&0x70,op=b[0]&0x0f,masked=(b[1]&0x80)!==0;let len=b[1]&0x7f,off=2;
   if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4}
   else if(len===127){if(b.length<10)return;const hi=b.readUInt32BE(2);if(hi>0x1fffff)return this.fail(1009,'Message too large');len=hi*2**32+b.readUInt32BE(6);off=10}
   if(rsv)return this.fail(1002,'Reserved bits are set (no extensions were agreed)');
   if(masked===this.client)return this.fail(1002,this.client?'The server sent a masked frame':'Frames from a client must be masked');
   if(op>=8){if(!fin||len>125)return this.fail(1002,'Invalid control frame')}
   else if(this.size+len>this.maxMessage)return this.fail(1009,`Message too large: the limit is ${this.maxMessage} bytes`);
   const start=off+(masked?4:0),end=start+len;if(b.length<end)return;
   const payload=b.subarray(start,end);
   if(masked){const m=b.subarray(off,start);for(let i=0;i<len;i++)payload[i]^=m[i&3]}
   this.buf=b.subarray(end);this.frame(fin,op,payload);if(this.state==='closed'||this.failed)return;
  }
 }
 frame(fin,op,payload){
  switch(op){
   case 0:if(!this.opcode)return this.fail(1002,'Continuation without a message');this.parts.push(payload);this.size+=payload.length;if(fin){const op=this.opcode,data=Buffer.concat(this.parts,this.size);this.opcode=0;this.parts=[];this.size=0;this.deliver(op,data)}return;
   case 1:case 2:if(this.opcode)return this.fail(1002,'New message inside a fragmented one');if(fin)return this.deliver(op,payload);this.opcode=op;this.parts=[payload];this.size=payload.length;return;
   case 8:{const code=payload.length>=2?payload.readUInt16BE(0):1005,reason=payload.subarray(2).toString('utf8');
    if(this.state==='open'){this.state='closing';this.write(8,payload.length>=2?payload.subarray(0,2):Buffer.alloc(0))}
    try{this.socket.end()}catch{}this.closed(code,reason);return}
   case 9:if(this.state==='open')this.write(10,payload);this.emit('ping',payload);return;
   case 10:this.emit('pong',payload);return;
   default:return this.fail(1002,'Unknown opcode '+op);
  }
 }
 deliver(op,data){if(this.state!=='open')return;this.emit('message',op===1?data.toString('utf8'):data,op===2)}
 write(op,payload){
  const len=payload.length,mask=this.client;let head;
  if(len<126){head=Buffer.alloc(2+(mask?4:0));head[1]=len}
  else if(len<65536){head=Buffer.alloc(4+(mask?4:0));head[1]=126;head.writeUInt16BE(len,2)}
  else{head=Buffer.alloc(10+(mask?4:0));head[1]=127;head.writeUInt32BE(Math.floor(len/2**32),2);head.writeUInt32BE(len>>>0,6)}
  head[0]=0x80|op;
  if(mask){head[1]|=0x80;const m=crypto.randomBytes(4);m.copy(head,head.length-4);const out=Buffer.allocUnsafe(len);for(let i=0;i<len;i++)out[i]=payload[i]^m[i&3];payload=out}
  try{this.socket.cork();this.socket.write(head);if(len)this.socket.write(payload);this.socket.uncork();return true}catch{return false}
 }
 // A string goes as a text message, a Buffer or typed array as binary, unchanged.
 send(data){if(this.state!=='open')return false;return typeof data==='string'?this.write(1,Buffer.from(data,'utf8')):this.write(2,Buffer.isBuffer(data)?data:Buffer.from(data.buffer,data.byteOffset,data.byteLength))}
 json(v){return this.send(JSON.stringify(v))}
 ping(data=Buffer.alloc(0)){return this.state==='open'&&this.write(9,data)}
 close(code=1000,reason=''){
  if(this.state!=='open')return;this.state='closing';const r=Buffer.from(String(reason).slice(0,120),'utf8'),p=Buffer.alloc(2+r.length);p.writeUInt16BE(code,0);r.copy(p,2);this.write(8,p);
  this.closeTimer=setTimeout(()=>this.terminate(),2000);this.closeTimer.unref?.();
 }
 fail(code,reason){this.failed=true;this.close(code,reason);this.closeCode=code;this.closeReason=reason}
 terminate(){try{this.socket.destroy()}catch{}this.closed(this.closeCode??1006,this.closeReason??'')}
 closed(code,reason){if(this.state==='closed')return;this.state='closed';clearTimeout(this.closeTimer);this.buf=Buffer.alloc(0);this.parts=[];this.emit('close',this.closeCode??code,this.closeReason??reason)}
}
// Server side of the handshake. Returns the WebSocket, or null after refusing the request.
export function upgrade(req,socket,head,opts={}){
 const key=req.headers['sec-websocket-key'];
 if(req.method!=='GET'||!/(^|,)\s*websocket\s*(,|$)/i.test(req.headers.upgrade??'')||!key||!/upgrade/i.test(req.headers.connection??'')){refuse(socket,'400 Bad Request','Expected a WebSocket upgrade');return null}
 if(req.headers['sec-websocket-version']!=='13'){try{socket.end('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')}catch{}return null}
 socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
 return new WebSocket(socket,{...opts,head});
}
// Client side (the test sender, the tests): resolves with an open WebSocket.
export function connect(url,{maxMessage=64*1024*1024,headers={},timeout=5000}={}){
 return new Promise((resolve,reject)=>{
  const u=new URL(url),key=crypto.randomBytes(16).toString('base64');
  const req=http.request({host:u.hostname,port:u.port||80,path:u.pathname+u.search,timeout,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key,...headers}});
  req.on('upgrade',(res,socket,head)=>{if(res.headers['sec-websocket-accept']!==acceptKey(key)){socket.destroy();return reject(Error('The server answered with the wrong Sec-WebSocket-Accept'))}resolve(new WebSocket(socket,{client:true,maxMessage,head}))});
  req.on('response',res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>reject(Error(`HTTP ${res.statusCode}${body?': '+body.slice(0,200):''}`)))});
  req.on('timeout',()=>req.destroy(Error('Timed out connecting to '+url)));req.on('error',reject);req.end();
 });
}
