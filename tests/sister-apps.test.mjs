import test from 'node:test';import assert from 'node:assert/strict';import dgram from 'node:dgram';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {routeOSC} from '../engine/osc-routes.mjs';import {decodePacket,encodeOSC} from '../engine/osc.mjs';
const output=()=>({armed:false,send(){},status(){return {armed:false,packets:0,interfaces:[]}},async arm(){},close(){}});
async function rig(){let time=0;const e=new Engine({output:output(),clock:()=>time});const sent=[];e.sendHook=async(t,p)=>{sent.push({target:t.id,...p})};
 await e.command('master.set',{value:1});
 for(const [id,color] of [['amber','#ffb347'],['cool','#cfe3ff']])await e.command('cue.save',{cue:{id,name:id,duration:30,loop:true,tracks:[],look:[...['401','402','403'].map(f=>({id:f,values:{intensity:.8,color}}))]}});
 await e.command('page.save',{page:{id:'act',name:'Act One',cues:[{id:'a',cue:'amber',fade:0,follow:'auto',wait:2},{id:'b',cue:'cool',fade:0,follow:'manual'}]}});
 return {e,sent,at:t=>{time=t;e.tick()},flush:()=>new Promise(r=>setImmediate(()=>setImmediate(r)))}}

test('OSC routes resolve pages and cues by id, name or number',async()=>{
 const {e}=await rig();const rt=e.runtime();
 assert.deepEqual(routeOSC('/stagelight/go',['act one'],e.show,rt),{command:'page.go',args:{id:'act'}});
 assert.deepEqual(routeOSC('/stagelight/go/cue',['Act One',2,'r1'],e.show,rt),{command:'page.go',args:{id:'act',entry:'b',requestId:'r1'}});
 assert.deepEqual(routeOSC('/stagelight/go/cue',[String(e.show.pages.findIndex(p=>p.id==='act')+1),'cool'],e.show,rt).args.entry,'b');
 assert.deepEqual(routeOSC('/stagelight/master',[75],e.show,rt).args,{value:.75});assert.deepEqual(routeOSC('/stagelight/blackout',[1],e.show,rt).args,{enabled:true});
 assert.equal(routeOSC('/stagelight/ping',[9000],e.show,rt).replyPort,9000);assert.equal(routeOSC('/stagelight/ping',[],e.show,rt).reply[0],'/stagelight/hello');
 assert.throws(()=>routeOSC('/stagelight/go',[],e.show,rt),/Name a page/);assert.throws(()=>routeOSC('/stagelight/go/cue',['act',9],e.show,rt),/No cue 9/);assert.throws(()=>routeOSC('/stagelight/arm',[],e.show,rt),/Unknown/);
});

test('Every GO announces and sends the look summary, including auto-follow; warm reads warmer than cool',async()=>{
 const {e,sent,at,flush}=await rig();
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'osc',host:'127.0.0.1',port:9100}});
 await e.command('target.save',{target:{id:'ls',name:'LiveStage',kind:'osc',host:'127.0.0.1',port:9000,announce:true}});
 const p=structuredClone(e.show.pages.find(p=>p.id==='act'));p.cues.forEach(c=>c.send=[{target:'cam',message:'look'}]);await e.command('page.save',{page:p});
 await e.command('page.go',{id:'act'});await flush();
 const live=sent.find(s=>s.target==='ls'),look1=sent.find(s=>s.target==='cam');assert.equal(live.osc.address,'/stagelight/cue/live');assert.deepEqual(live.osc.args.slice(0,4),['act','Act One',1,'amber']);
 assert.equal(look1.osc.address,'/stagelight/look');const k1=look1.osc.args[2].v;assert.equal(look1.osc.args[3].t,'f');
 at(2);await flush();const look2=sent.filter(s=>s.target==='cam')[1];assert.ok(look2,'auto-follow sent too');assert.ok(look2.osc.args[2].v>k1+1500,`cool ${look2.osc.args[2].v}K vs amber ${k1}K`);
 const summary=e.lookSummary(e.show.cues.find(c=>c.id==='amber'));assert.ok(summary.kelvin<3500&&summary.groups.some(g=>g.id==='backlights'));
 await e.command('target.delete',{id:'cam'});assert.ok(e.show.pages.find(p=>p.id==='act').cues.every(c=>!c.send));
});

test('Named triggers map to safe commands only; network config persists across import',async()=>{
 const {e}=await rig();
 await e.command('trigger.save',{trigger:{id:'chorus',name:'Chorus',command:'page.go',args:{id:'act',entry:'b'}}});
 const r=await e.command('trigger.fire',{id:'chorus',requestId:'t1'});assert.equal(r.created.command,'page.go');assert.equal(e.runtime().stack.entry,'b');assert.equal((await e.command('trigger.fire',{id:'chorus',requestId:'t1'})).duplicate,true);
 await assert.rejects(e.command('trigger.save',{trigger:{id:'bad',name:'Bad',command:'output.arm',args:{}}}),/unsupported/);
 await assert.rejects(e.command('trigger.save',{trigger:{id:'bad2',name:'Bad',command:'page.go',args:{id:'nope',extra:1}}}),/unknown field/);
 let changed;e.onNetworkChange=c=>changed=c;await e.command('network.configure',{bind:'lan',allow:['192.168.1.20']});assert.deepEqual(changed,{bind:'lan',port:1461,allow:['192.168.1.20']});
 await e.command('show.import',{show:{...structuredClone(e.show),settings:{...e.show.settings,osc:{bind:'loopback',allow:[]}}}});assert.equal(e.show.settings.osc.bind,'lan','this Mac keeps its listener');
 const status=await e.command('network.status');assert.ok(status.addresses.some(a=>a.address==='/stagelight/go/cue'));assert.equal(status.triggers.length,1);
});

test('Real UDP: ping, GO by OSC and outbound look arrive within a few milliseconds',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stagelight-net-')),http=19000+Math.floor(Math.random()*500),oscPort=http+600;
 const child=spawn(process.execPath,[path.resolve('server.mjs')],{env:{...process.env,LIGHTS_PORT:String(http),LIGHTS_OSC_PORT:String(oscPort),LIGHTS_DATA_DIR:dir},stdio:['ignore','pipe','inherit']});
 const sock=dgram.createSocket('udp4');const inbox=[];sock.on('message',m=>inbox.push(...decodePacket(m).map(x=>({...x,t:performance.now()}))));
 try{
  await new Promise(r=>child.stdout.on('data',d=>{if(String(d).includes('LIGHTS_READY'))r()}));await new Promise(r=>sock.bind(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${http}`,token=(await fetch(base+'/api/session').then(r=>r.json())).token;
  const post=(command,args)=>fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command,args})}).then(r=>r.json());
  await post('target.save',{target:{id:'me',name:'Test receiver',kind:'osc',host:'127.0.0.1',port:sock.address().port,announce:true}});
  const waitFor=async(address,ms=1500)=>{const end=Date.now()+ms;for(;;){const m=inbox.find(x=>x.address===address);if(m)return m;if(Date.now()>end)throw Error('No '+address);await new Promise(r=>setTimeout(r,2))}};
  sock.send(encodeOSC('/stagelight/ping',[]),oscPort,'127.0.0.1');const hello=await waitFor('/stagelight/hello');assert.equal(hello.args[0],'StageLight');
  // Warm, repeated GOs: measure send → announcement received back over UDP.
  const trips=[];let live;for(let i=0;i<40;i++){inbox.length=0;const t0=performance.now();sock.send(encodeOSC('/stagelight/go/cue',['Opening',1+(i%3)]),oscPort,'127.0.0.1');live=await waitFor('/stagelight/cue/live');trips.push(live.t-t0)}
  trips.sort((a,b)=>a-b);const roundTrip=trips[20],worst=trips.at(-1);assert.ok(roundTrip<10,`median GO → announce ${roundTrip.toFixed(2)} ms`);
  const status=await fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command:'network.status',args:{}})}).then(r=>r.json());
  assert.ok(status.inbound.some(x=>x.address==='/stagelight/go/cue'&&x.ok&&x.ms<20));assert.ok(status.listener.listening);
  const handled=status.inbound.filter(x=>x.address==='/stagelight/go/cue').map(x=>x.ms).sort((a,b)=>a-b);
  console.log(`  GO → announce round trip over UDP: median ${roundTrip.toFixed(2)} ms, worst ${worst.toFixed(2)} ms; engine handling median ${handled[Math.floor(handled.length/2)]} ms`);
 }finally{sock.close();child.kill('SIGTERM');await new Promise(r=>child.on('exit',r));fs.rmSync(dir,{recursive:true,force:true})}
});

test('Catalog lists pages, cues, triggers and library cues for pickers in other apps; hello carries its revision',async()=>{
 const {e}=await rig();
 await e.command('trigger.save',{trigger:{id:'chorus',name:'Chorus',command:'page.go',args:{id:'act',entry:'b'}}});
 const rt=e.runtime(),r=routeOSC('/stagelight/catalog',[9100],e.show,rt);
 assert.equal(r.replyPort,9100);
 const by=a=>r.replies.filter(([x])=>x===a).map(([,args])=>args);
 assert.equal(r.replies[0][0],'/stagelight/catalog/begin');assert.equal(r.replies.at(-1)[0],'/stagelight/catalog/end');
 assert.equal(r.replies[0][1][0],rt.revision);
 const act=by('/stagelight/catalog/page').find(p=>p[0]==='act');assert.deepEqual(act.slice(1,4),['Act One',e.show.pages.findIndex(p=>p.id==='act')+1,2]);
 assert.deepEqual(by('/stagelight/catalog/cue').filter(c=>c[0]==='act').map(c=>c.slice(1,5)),[[1,'a','amber','auto'],[2,'b','cool','manual']]);
 assert.deepEqual(by('/stagelight/catalog/trigger'),[['chorus','Chorus','GO Act One · cue 2 cool']]);
 assert.ok(by('/stagelight/catalog/library').some(([id])=>id==='amber'));
 // Every reply encodes as a normal OSC message.
 for(const [a,args] of r.replies)assert.equal(decodePacket(encodeOSC(a,args))[0].address,a);
 const hello=routeOSC('/stagelight/ping',[],e.show,rt).reply[1];assert.equal(hello.length,6);assert.equal(hello[5],rt.revision);
 const before=rt.revision;await e.command('trigger.delete',{id:'chorus'});assert.ok(e.runtime().revision>before);
});
