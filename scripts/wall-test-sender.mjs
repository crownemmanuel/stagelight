#!/usr/bin/env node
// Stand-in for LiveStage's wall video sender (docs/WALL-VIDEO.md), for testing StageLight's receiver without LiveStage.
// It connects to ws://<host>:<port>/wall/in, says hello, answers clock pings and streams stamped JPEG frames while
// StageLight reports viewers > 0, exactly as protocol 1 says.
//
//   node scripts/wall-test-sender.mjs --port 1488 [--fps 25] [--delay 40] [--skew 0] [--seconds 0]
//        [--flash 2 [--osc 1487 --cue <cue id>]] [--image picture.jpg]
//
// --delay ms   holds each frame that long before sending it (stamp = when it was "rendered", sentAt = when sent),
//              to imitate LiveStage's capture + encode + network time.
// --skew ms    pretends the sender's clock runs that far ahead (its stamps and pongs), to exercise the clock offset.
// --flash s    alternates black and white every s seconds (the sync probe's flash test). With --osc and --cue it fires
//              /stagelight/play <cue> 0 at StageLight's OSC port on each cut to white and /stagelight/stop 0 on each
//              cut to black, at the stamp of that frame, as a LiveStage preview cue would. Use a dev instance only.
// Never point this at a show computer's StageLight (1455/1460/1461) while a show runs.
import fs from 'node:fs';
import dgram from 'node:dgram';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {connect} from '../engine/ws.mjs';
import {encodeFrame,clockNow} from '../engine/wall.mjs';
import {encodeOSC} from '../engine/osc.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),fixture=n=>fs.readFileSync(path.join(here,'..','tests','fixtures','wall',n));
// Width and height of a baseline/progressive JPEG, from its SOF marker.
export function jpegSize(b){for(let i=2;i+9<b.length;){if(b[i]!==0xff){i++;continue}const m=b[i+1],len=b.readUInt16BE(i+2);if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return {height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};i+=2+len}return null}
export async function startSender({host='127.0.0.1',port=1455,fps=25,delay=0,skew=0,flash=0,osc=0,cue=null,image=null,always=false,hello={},log=()=>{}}={}){
 const now=()=>clockNow()+skew,ws=await connect(`ws://${host}:${port}/wall/in`);
 const pics=image?{still:fs.readFileSync(image)}:{still:fixture('bars.jpg'),black:fixture('black.jpg'),white:fixture('white.jpg')};
 const st={viewers:0,hello:null,stats:null,pings:0,sent:0,held:0,cuts:[],closed:false};let seq=0,white=null,timer=null;
 const udp=osc?dgram.createSocket('udp4'):null,fire=(address,args)=>udp?.send(encodeOSC(address,args),osc,'127.0.0.1',()=>{});
 ws.on('message',(data,binary)=>{if(binary)return;let m;try{m=JSON.parse(data)}catch{return}
  if(m.t==='ping'){st.pings++;ws.json({t:'pong',id:m.id,s:m.s,l:now()})}
  else if(m.t==='viewers'){st.viewers=m.n;log(`viewers ${m.n}`)}else if(m.t==='hello'){st.hello=m;log(`StageLight ${m.version} · ${m.armed?'ARMED':'not armed'}`)}else if(m.t==='stats'){st.stats=m;log(`stats ${JSON.stringify(m)}`)}});
 ws.on('close',()=>{st.closed=true;clearInterval(timer);try{udp?.close()}catch{}});
 const info={app:'LiveStage',version:'test-sender',protocol:1,width:0,height:0,fps,scene:flash?'Flash test':'Test card',wall:[3072,768],...hello};
 const first=pics.still,size=jpegSize(first);ws.json({t:'hello',...info,width:size.width,height:size.height});
 timer=setInterval(()=>{
  if(st.closed||(!always&&!st.viewers))return;
  const stamp=now();let img=pics.still;
  if(flash){const w=Math.floor(stamp/(flash*1000))%2===1;img=w?pics.white:pics.black;
   // The cue goes when the cut is rendered, with no delay: it reaches StageLight long before the frame does.
   if(w!==white){if(white!==null){st.cuts.push({white:w,stamp});if(cue)w?fire('/stagelight/play',[cue,{t:'f',v:0}]):fire('/stagelight/stop',[{t:'f',v:0}])}white=w}}
  const {width,height}=jpegSize(img),go=()=>{if(st.closed)return;if(ws.bufferedAmount>0){st.held++;return}ws.send(encodeFrame({codec:1,width,height,flags:0,seq:seq++,stamp,sentAt:now()},img));st.sent++};
  delay?setTimeout(go,delay):go();
 },1000/fps);
 return {ws,state:st,stop:()=>{clearInterval(timer);ws.close(1000,'Test sender stopped')}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2),opt=(k,d)=>{const i=a.indexOf('--'+k);return i<0?d:a[i+1]};
 const port=Number(opt('port',1455));if([1460,1461].includes(port))console.error('Warning: 1460/1461 are the show computer\'s StageLight ports.');
 const s=await startSender({host:opt('host','127.0.0.1'),port,fps:Number(opt('fps',25)),delay:Number(opt('delay',0)),skew:Number(opt('skew',0)),flash:Number(opt('flash',0)),osc:Number(opt('osc',0)),cue:opt('cue',null),image:opt('image',null),always:a.includes('--always'),log:m=>console.log(m)});
 console.log(`Connected to ws://${opt('host','127.0.0.1')}:${port}/wall/in · frames go while StageLight shows them`);
 const secs=Number(opt('seconds',0));if(secs)setTimeout(()=>{s.stop();setTimeout(()=>process.exit(0),200)},secs*1000);
 setInterval(()=>console.log(`sent ${s.state.sent} · viewers ${s.state.viewers} · pings ${s.state.pings}`),5000).unref();
 s.ws.on('close',()=>{console.log('Disconnected');process.exit(0)});process.on('SIGINT',()=>{s.stop();setTimeout(()=>process.exit(0),200)});
}
