import test from 'node:test';import assert from 'node:assert/strict';import dgram from 'node:dgram';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {routeOSC,catalog} from '../engine/osc-routes.mjs';import {decodePacket,encodeOSC} from '../engine/osc.mjs';
import {duv,mccamy,colorFigures,isWhite,lookDiffers,lookSnap,CHANGE,LOOK_PROTOCOL} from '../engine/look.mjs';
// Look Link, protocol stagelight.look/1 (docs/LOOK-LINK.md): zones, per-zone colour, envelope, sending modes, presets, feedback.
const output=()=>({armed:false,send(){},status(){return {armed:false,packets:0,interfaces:[]}},async arm(){},close(){}});
async function rig(){let time=0;const e=new Engine({output:output(),clock:()=>time});const sent=[];let replies=()=>null;e.sendHook=async(t,p)=>{sent.push({target:t.id,...p});return replies(t,p)};
 await e.command('master.set',{value:1});
 const look=(ids,values)=>ids.map(id=>({id,values}));
 await e.command('cue.save',{cue:{id:'warm',name:'Warm',duration:30,loop:true,tracks:[],look:[...look(['401','402','403','404'],{intensity:.8,color:'#ffb347'}),...look(['301','302'],{intensity:.6,color:'#ffffff'})]}});
 await e.command('cue.save',{cue:{id:'blue',name:'Blue',duration:30,loop:true,tracks:[],look:[...look(['401','402','403','404'],{intensity:.5,color:'#3a6bff'}),...look(['301','302'],{intensity:.6,color:'#ffffff'})]}});
 await e.command('page.save',{page:{id:'act',name:'Act One',cues:[{id:'a',cue:'warm',fade:0,follow:'manual'},{id:'b',cue:'blue',fade:3,follow:'manual'}]}});
 await e.command('zone.save',{zone:{id:'back',name:'Backlights',role:'back',groups:['backlights']}});
 await e.command('zone.save',{zone:{id:'front',name:'Front beams',role:'front',fixtures:['301','302']}});
 return {e,sent,at:t=>{time=t;e.tick()},flush:()=>new Promise(r=>setImmediate(()=>setImmediate(r))),reply:fn=>replies=fn,looks:id=>sent.filter(s=>s.target===id&&(s.http?.type==='look'||s.osc?.[0]?.[0]==='/stagelight/look/begin'))}}

test('Duv, CCT and white: D65 sits just above the locus, blackbody on it, green above, magenta below',()=>{
 assert.ok(Math.abs(duv({x:.31271,y:.32902})-.0032)<.0002);assert.equal(mccamy({x:.31271,y:.32902}),6504);
 assert.ok(Math.abs(duv({x:.43695,y:.40410}))<.0003,'3000 K blackbody');assert.ok(duv({x:.3,y:.4})>.03);assert.ok(duv({x:.35,y:.3})<-.02);
 const warm=colorFigures([1,.702,.278]),blue=colorFigures([.227,.42,1]),dark=colorFigures([0,0,0]);
 assert.ok(warm.kelvin<3000&&warm.mired===Math.round(1e6/warm.kelvin)&&Math.abs(warm.duv)<.015);assert.ok(blue.duv<-.05);
 assert.deepEqual(dark,{kelvin:null,mired:null,duv:null,cie:null,saturation:0});
 assert.equal(isWhite(1,3200,.004),true);assert.equal(isWhite(1,3200,.02),false);assert.equal(isWhite(1,1900,0),false);assert.equal(isWhite(1,10500,0),false);assert.equal(isWhite(0,3200,0),false);
});

test('Zones are validated, saved in the show, listed over OSC and cleaned out of targets when deleted',async()=>{
 const {e}=await rig();
 await assert.rejects(e.command('zone.save',{zone:{id:'x',name:'X',role:'face'}}),/needs a group or a fixture/);
 await assert.rejects(e.command('zone.save',{zone:{id:'x',name:'X',role:'face',groups:['nope']}}),/unknown group/);
 await assert.rejects(e.command('zone.save',{zone:{id:'x',name:'X',role:'face',fixtures:['999']}}),/unknown fixture/);
 await assert.rejects(e.command('zone.save',{zone:{id:'x',name:'X',role:'key',fixtures:['301']}}),/unsupported/);
 await e.command('group.save',{id:'pair',name:'Pair',fixtures:['305','306']});await e.command('zone.save',{zone:{id:'pair',name:'Pair',role:'side',groups:['pair']}});
 await assert.rejects(e.command('group.delete',{id:'pair'}),/unknown group/,'a zone keeps its group');await e.command('zone.delete',{id:'pair'});
 assert.deepEqual(e.show.zones.map(z=>z.id),['back','front']);
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'osc',host:'127.0.0.1',port:9100,look:{zones:['front','back'],mode:'cue'}}});
 await assert.rejects(e.command('target.save',{target:{id:'c2',name:'C2',kind:'osc',host:'127.0.0.1',port:9101,look:{zones:['nope']}}}),/unknown zone/);
 await assert.rejects(e.command('target.save',{target:{id:'c2',name:'C2',kind:'osc',host:'127.0.0.1',port:9101,look:{heartbeat:.5}}}),/Heartbeat/);
 const rt=e.runtime(),z=routeOSC('/stagelight/zones',[9200],e.show,rt);assert.equal(z.replyPort,9200);
 assert.deepEqual(z.replies,[['/stagelight/zones/begin',[2]],['/stagelight/zone',['back','Backlights','back',8]],['/stagelight/zone',['front','Front beams','front',2]],['/stagelight/zones/end',[]]]);
 assert.deepEqual(catalog(e.show,1).filter(([a])=>a==='/stagelight/catalog/zone').map(([,a])=>a[0]),['back','front']);
 await e.command('zone.delete',{id:'front'});assert.deepEqual(e.show.targets[0].look.zones,['back']);await e.command('zone.delete',{id:'back'});assert.equal(e.show.targets[0].look.zones,undefined);
 await assert.rejects(e.command('zone.delete',{id:'back'}),/Unknown zone/);
});

test('look.report: per-zone measures for a cue end state or the live stage, legacy fields kept, nothing sent or counted',async()=>{
 const {e,sent,at}=await rig();
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'http',url:'http://127.0.0.1:9/x',look:{zones:['front','back'],members:true}}});
 const r=await e.command('look.report',{target:'cam',page:'act',entry:'a'}),m=r.message;
 assert.equal(m.protocol,LOOK_PROTOCOL);assert.equal(m.type,'look');assert.equal(m.reason,'cue');assert.equal(m.target,'cam');assert.deepEqual(m.cue,{entry:'a',id:'warm',name:'Warm',number:1});
 assert.deepEqual(m.zones.map(z=>z.id),['front','back'],'operator order');
 const back=m.zones.find(z=>z.id==='back'),front=m.zones[0];
 assert.equal(back.fixtures,8);assert.equal(back.lit,4);assert.equal(back.level,.4);assert.equal(back.peak,.8);assert.ok(back.kelvin<3000&&back.white,`warm amber ${back.kelvin} K duv ${back.duv}`);assert.equal(back.colorUnknown,0);assert.equal(back.members.length,8);
 assert.ok(front.kelvin>6000&&Math.abs(front.duv-.0033)<.0005&&front.white);assert.ok(front.cie.x>.3&&front.cie.x<.32);
 for(const k of ['kelvin','level','color','saturation','lit','fixtures','groups'])assert.ok(k in m,'legacy '+k);assert.equal(m.fixtures,10,'overall covers the zones sent');
 assert.deepEqual(r.osc.map(o=>o.address),['/stagelight/look/begin','/stagelight/look','/stagelight/look/zone','/stagelight/look/zone','/stagelight/look/end']);
 assert.equal(r.osc[2].types,',isssiffsfiiii');assert.equal(r.osc[1].types,',ssifsf');assert.equal(r.osc[0].args[0],m.seq);
 const blue=(await e.command('look.report',{target:'cam',cue:'blue'})).message.zones.find(z=>z.id==='back');assert.equal(blue.white,false);assert.ok(blue.duv<-.05);
 const dark=(await e.command('look.report',{target:'cam'})).message;assert.equal(dark.reason,'request');assert.equal(dark.zones[0].lit,0);assert.equal(dark.zones[0].kelvin,null);assert.equal(dark.zones[0].white,false);
 await e.command('page.go',{id:'act'});at(.1);const live=(await e.command('look.report',{zones:['back']})).message;assert.equal(live.target,null);assert.equal(live.zones.length,1);assert.equal(live.zones[0].lit,4);assert.equal(live.zones[0].members,undefined);
 assert.equal(e.looks.get('cam')?.seq??0,0,'report does not consume a sequence number');assert.equal(sent.length,0);
 await e.command('blackout.set',{enabled:true});at(.2);const bo=(await e.command('look.report',{target:'cam',page:'act',entry:'a'})).message;assert.equal(bo.output.blackout,true);assert.equal(bo.zones[1].lit,0,'blackout darkens the end state too');
});

test('A 7R on a wheel position nobody named counts as colorUnknown',async()=>{
 const {e,at}=await rig();const r7=e.show.fixtures.find(f=>f.profile==='beam7r'&&f.enabled);
 await e.command('zone.save',{zone:{id:'fx',name:'Rear heads',role:'effect',fixtures:[r7.id]}});
 await e.command('fixture.set',{ids:[r7.id],values:{intensity:1,colorWheel:5}});at(.1);
 let z=(await e.command('look.report',{zones:['fx'],members:true})).message.zones[0];assert.equal(z.colorUnknown,1);assert.equal(z.members[0].known,false);
 await e.command('fixture.set',{ids:[r7.id],values:{colorWheel:r7.colorSlots[3].value}});at(.2);
 z=(await e.command('look.report',{zones:['fx']})).message.zones[0];assert.equal(z.colorUnknown,0);assert.equal(z.color,r7.colorSlots[3].color.toLowerCase());
});

test('GO: preset before look, one look per target, envelope with timing; OSC burst keeps the 0.3.0 message',async()=>{
 const {e,sent,flush}=await rig();
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'http',url:'http://127.0.0.1:9/x',look:{mode:'cue'}}});
 await e.command('target.save',{target:{id:'osc',name:'Cam OSC',kind:'osc',host:'127.0.0.1',port:9100,look:{zones:['back']}}});
 await e.command('target.save',{target:{id:'off',name:'Legacy',kind:'osc',host:'127.0.0.1',port:9101}});
 await assert.rejects(e.command('page.save',{page:{...structuredClone(e.show.pages.find(p=>p.id==='act')),cues:[{id:'a',cue:'warm',fade:0,follow:'manual',send:[{target:'cam',message:'preset'}]}]}}),/preset id/);
 await assert.rejects(e.command('page.save',{page:{...structuredClone(e.show.pages.find(p=>p.id==='act')),cues:[{id:'a',cue:'warm',fade:0,follow:'manual',send:[{target:'cam',message:'look',preset:'x'}]}]}}),/preset sends/);
 const p=structuredClone(e.show.pages.find(p=>p.id==='act'));p.cues[1].send=[{target:'cam',message:'look'},{target:'cam',message:'preset',preset:'Face warm 3200',fade:3},{target:'osc',message:'look'},{target:'osc',message:'preset',preset:'cam2'}];await e.command('page.save',{page:p});
 await e.command('page.go',{id:'act',entry:'b'});await flush();
 const cam=sent.filter(s=>s.target==='cam').map(s=>s.http);assert.deepEqual(cam.map(m=>m.type),['preset','look'],'preset first, look once');
 assert.equal(cam[0].preset,'Face warm 3200');assert.equal(cam[0].fade,3);assert.deepEqual(cam[0].cue,{entry:'b',id:'blue',name:'Blue',number:2});assert.ok(cam[1].seq>cam[0].seq);
 const look=cam[1];assert.equal(look.reason,'cue');assert.equal(look.state,'fading');assert.equal(look.timing.fade,3);assert.equal(Date.parse(look.timing.settlesAt)-Date.parse(look.timing.startedAt),3000);
 assert.deepEqual(look.output,{armed:false,blackout:false,master:1});assert.match(look.id,/^msg_[0-9a-f]{8}$/);assert.equal(look.target,'cam');assert.equal(look.test,false);assert.equal(look.zones.length,2,'no zones chosen = every zone');
 const osc=sent.filter(s=>s.target==='osc').map(s=>s.osc);assert.deepEqual(osc[0],[['/stagelight/preset',['cam2',{t:'f',v:-1},{t:'i',v:osc[0][0][1][2].v}]]]);
 assert.deepEqual(osc[1].map(([a])=>a),['/stagelight/look/begin','/stagelight/look','/stagelight/look/zone','/stagelight/look/end']);
 const [begin,legacy,zone,end]=osc[1].map(([,a])=>a);assert.deepEqual([begin[1],begin[2],begin[3],begin[4].v,begin[5].v,begin[6].v],['cue','Act One','Blue',3,1,0]);
 assert.equal(legacy.length,6);assert.deepEqual(legacy.slice(0,2),['Act One','Blue']);assert.equal(zone[1],'back');assert.equal(zone[9].v,0,'blue is not white');assert.equal(end[0].v,begin[0].v);
 assert.ok(!sent.some(s=>s.target==='off'),'mode off sends nothing without an explicit send');
 const before=sent.length;await e.command('page.go',{id:'act',entry:'a'});await flush();assert.deepEqual(sent.slice(before).map(s=>s.target),['cam'],'mode cue: a look on every GO');
});

test('Change mode: thresholds, 4/s limit, trailing send, settled after a fade, blackout mid-fade',async()=>{
 const {e,at,flush,looks}=await rig();const msgs=()=>looks('cam').map(s=>s.http);
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'http',url:'http://127.0.0.1:9/x',look:{mode:'change',zones:['back']}}});
 await e.command('page.go',{id:'act',entry:'a'});at(.1);await flush();assert.deepEqual(msgs().map(m=>m.reason),['cue']);
 for(let t=.2;t<1;t+=.06)at(t);await flush();assert.equal(msgs().length,1,'a static look sends nothing more');
 await e.command('master.set',{value:.97});at(1);at(1.4);await flush();assert.equal(msgs().length,1,'0.03 × 0.4 level is below the threshold');
 // A fader pull: big steps every 50 ms send at most every 250 ms, then one trailing look with the final level.
 let v=.97,t=2;for(let i=0;i<14;i++){v-=.05;await e.command('master.set',{value:+v.toFixed(3)});t+=.05;at(t)}
 await flush();const during=msgs().slice(1);assert.ok(during.length>=2&&during.length<=4,`${during.length} change looks in 0.7 s`);assert.ok(during.every(m=>m.reason==='change'));
 for(let k=0;k<8;k++){t+=.05;at(t)}await flush();const last=msgs().at(-1);assert.equal(last.zones[0].level,+(.4*e.master).toFixed(3),'trailing look carries the final level');
 const n=msgs().length;for(let k=0;k<10;k++){t+=.1;at(t)}await flush();assert.equal(msgs().length,n,'quiet again');
 // GO with a 3 s fade: announced once (end state), changes held, then settled.
 await e.command('master.set',{value:1});t+=.3;at(t);t+=.3;at(t);await flush();const m0=msgs().length;
 await e.command('page.go',{id:'act',entry:'b'});const go=t;for(let k=0;k<20;k++){t+=.1;at(t)}await flush();
 assert.deepEqual(msgs().slice(m0).map(m=>m.reason),['cue'],'no change looks during the announced fade');
 t=go+3.05;at(t);await flush();const settled=msgs().at(-1);assert.equal(settled.reason,'settled');assert.equal(settled.state,'settled');assert.deepEqual(settled.zones[0].color,msgs()[m0].zones[0].color);
 // Blackout during a fade cancels the wait: the dark stage goes out as soon as the 4/s limit allows (lit crossing 0).
 await e.command('page.go',{id:'act',entry:'a',fade:4});t+=.1;at(t);await e.command('blackout.set',{enabled:true});for(let k=0;k<4;k++){t+=.06;at(t)}await flush();
 const bo=msgs().at(-1);assert.equal(bo.reason,'change');assert.equal(bo.zones[0].lit,0);assert.equal(bo.output.blackout,true);
});

test('Heartbeat repeats the live look; look.send and target.test send now with their reasons',async()=>{
 const {e,at,flush,looks}=await rig();
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'http',url:'http://127.0.0.1:9/x',look:{mode:'cue',heartbeat:2}}});
 // The heartbeat clock starts when the target is first watched (here at 1 s).
 at(1);at(2.1);await flush();assert.equal(looks('cam').length,0);at(3.05);await flush();assert.deepEqual(looks('cam').map(s=>s.http.reason),['heartbeat']);at(4);await flush();assert.equal(looks('cam').length,1);at(5.1);await flush();assert.equal(looks('cam').length,2);
 const r=await e.command('look.send',{target:'cam',requestId:'r-1'});await flush();const req=looks('cam').at(-1).http;assert.equal(req.reason,'request');assert.equal(req.requestId,'r-1');assert.equal(r.created.message,req.id);
 await e.command('target.test',{id:'cam',message:'look'});await flush();const test=looks('cam').at(-1).http;assert.equal(test.reason,'test');assert.equal(test.test,true);
 const seqs=looks('cam').map(s=>s.http.seq);assert.deepEqual([...seqs].sort((a,b)=>a-b),seqs);assert.ok(seqs[0]>2.5e8,'time-based, so it keeps rising across restarts');
});

test('HTTP replies are logged with the send; preset lists come back by HTTP or OSC; feedback finds its message',async()=>{
 const {e,flush,reply}=await rig();
 reply((t,p)=>p.http?.type==='presets.request'?{ok:true,presets:[{id:'face-warm-3200',name:'Face warm 3200K',description:'Key 3200K'},{id:'x'},{name:'no id'}]}:{ok:false,status:'ignored',summary:'Unknown preset '+(p.http?.preset??'')+'x'.repeat(300)});
 await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'http',url:'http://10.0.0.20:9200/stagelight'}});
 await e.command('target.save',{target:{id:'cam2',name:'Cam OSC',kind:'osc',host:'10.0.0.21',port:9100}});
 await e.command('target.save',{target:{id:'ls',name:'LiveStage',kind:'osc',host:'10.0.0.21',port:9000}});
 const p=structuredClone(e.show.pages.find(p=>p.id==='act'));p.cues[0].send=[{target:'cam',message:'preset',preset:'nope'}];await e.command('page.save',{page:p});
 await e.command('page.go',{id:'act',entry:'a'});await flush();
 let row=(await e.command('network.status')).outbound[0];assert.equal(row.reply.ok,false);assert.equal(row.reply.status,'ignored');assert.equal(row.reply.summary.length,200);assert.match(row.reply.summary,/^Unknown preset nope/);
 assert.deepEqual((await e.command('target.presets',{id:'cam'})).presets,[]);const ask=await e.command('target.presets',{id:'cam',refresh:true});assert.equal(ask.requested,true);await flush();
 assert.deepEqual((await e.command('target.presets',{id:'cam'})).presets.map(x=>x.id+':'+x.name),['face-warm-3200:Face warm 3200K','x:x']);
 // OSC publication: two targets share 10.0.0.21, so the one whose port sent it (or the one asked last) gets the list.
 const from={address:'10.0.0.21',port:5555},route=(a,args)=>routeOSC(a,args,e.show,e.runtime()).presets;
 e.receivePresets(route('/stagelight/presets/begin',[2]),from);e.receivePresets(route('/stagelight/presets/item',['wide','Stage wide']),from);
 assert.throws(()=>e.receivePresets(route('/stagelight/presets/end',[]),from),/Several targets/);
 await e.command('target.presets',{id:'cam2',refresh:true});await flush();const sentAsk=(await e.command('network.status')).outbound[0];assert.equal(sentAsk.summary,'/stagelight/presets/request 1461');
 for(const [a,args] of [['/stagelight/presets/begin',[2]],['/stagelight/presets/item',['wide','Stage wide','All cams wide']],['/stagelight/presets/item',['tight','']],['/stagelight/presets/end',[]]])e.receivePresets(route(a,args),from);
 assert.deepEqual(e.net.presets.cam2.presets,[{id:'wide',name:'Stage wide',description:'All cams wide'},{id:'tight',name:'tight'}]);assert.equal(e.net.presets.ls,undefined);
 for(const [a,args] of [['/stagelight/presets/begin',[1,'LiveStage']],['/stagelight/presets/item',['go','GO']],['/stagelight/presets/end',[]]])e.receivePresets(route(a,args),from);assert.equal(e.net.presets.ls.presets[0].id,'go');
 // Feedback: by message id (HTTP) or by seq (OSC burst carries no id).
 row=(await e.command('network.status')).outbound.find(r=>r.label==='preset');const fb=routeOSC('/stagelight/feedback',[row.id,'Applied','Face cam → 3200K'],e.show,e.runtime()).feedback;
 assert.match(e.feedback(fb,'10.0.0.20'),/applied · Camera control preset/);assert.deepEqual({...row.feedback,at:0},{status:'applied',summary:'Face cam → 3200K',at:0});
 await e.command('target.save',{target:{...structuredClone(e.show.targets.find(t=>t.id==='cam2')),look:{mode:'cue'}}});await e.command('page.go',{id:'act',entry:'a'});await flush();
 const oscRow=(await e.command('network.status')).outbound.find(r=>r.targetId==='cam2'&&r.label==='look');e.feedback({id:String(oscRow.seq),status:'queued',summary:''},'10.0.0.21');assert.equal(oscRow.feedback.status,'queued');
 assert.match(e.feedback({id:'msg_nothere',status:'failed',summary:'x'},'1.2.3.4'),/not in the recent log/);
 assert.throws(()=>routeOSC('/stagelight/feedback',['m','done','x'],e.show,e.runtime()),/applied, queued/);
 await e.command('target.delete',{id:'cam'});assert.equal(e.net.presets.cam,undefined);
});

test('OSC look/get: with a target it goes through that target; without, it is answered to the sender',async()=>{
 const {e}=await rig();await e.command('target.save',{target:{id:'cam',name:'Camera control',kind:'osc',host:'127.0.0.1',port:9100}});const rt=e.runtime();
 assert.deepEqual(routeOSC('/stagelight/look/get',['camera CONTROL',0,'q1'],e.show,rt),{command:'look.send',args:{target:'cam',requestId:'q1'}});
 assert.deepEqual(routeOSC('/stagelight/look/get',[],e.show,rt),{lookReply:true,replyPort:null});
 assert.deepEqual(routeOSC('/stagelight/look/get',[9300,'q2'],e.show,rt),{lookReply:true,replyPort:9300,requestId:'q2'});
 assert.deepEqual(routeOSC('/stagelight/look/get',['',9300],e.show,rt),{lookReply:true,replyPort:9300});
 assert.throws(()=>routeOSC('/stagelight/look/get',['nobody'],e.show,rt),/Unknown target/);
 const burst=e.lookReply('q2');assert.deepEqual(burst.map(([a])=>a),['/stagelight/look/begin','/stagelight/look','/stagelight/look/zone','/stagelight/look/zone','/stagelight/look/end']);assert.equal(burst[0][1][1],'request');
 for(const [a,args] of burst)assert.equal(decodePacket(encodeOSC(a,args))[0].address,a);
 assert.ok((await e.command('network.status')).addresses.some(a=>a.address==='/stagelight/look/get'));
});

test('Change detection ignores kelvin jitter of coloured light but not a white/coloured flip',()=>{
 const z=(o)=>({zones:[{lit:4,level:.5,kelvin:12000,duv:-.06,white:false,...o}]});
 assert.equal(lookDiffers(lookSnap(z({kelvin:11500})),lookSnap(z({})),CHANGE),false);assert.equal(lookDiffers(lookSnap(z({duv:-.057})),lookSnap(z({})),CHANGE),true);
 assert.equal(lookDiffers(lookSnap(z({kelvin:3300,white:true})),lookSnap(z({kelvin:3200,white:true})),CHANGE),true);assert.equal(lookDiffers(lookSnap(z({white:true})),lookSnap(z({})),CHANGE),true);
 assert.equal(lookDiffers(lookSnap(z({lit:0,kelvin:null})),lookSnap(z({})),CHANGE),true);
});

test('MCP lists the Look Link tools; look.report is read-only',async()=>{
 const child=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{stdio:['pipe','pipe','inherit']});let out='';child.stdout.on('data',d=>out+=d);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');while(!out.includes('\n'))await new Promise(r=>setTimeout(r,20));child.kill();
 const tools=JSON.parse(out.split('\n')[0]).result.tools,by=n=>tools.find(t=>t.name===n);
 for(const n of ['lights_zone_save','lights_zone_delete','lights_look_report','lights_look_send','lights_target_presets'])assert.ok(by(n),n);
 assert.equal(by('lights_look_report').annotations.readOnlyHint,true);assert.equal(by('lights_look_send').annotations.idempotentHint,false);
 assert.deepEqual(by('lights_target_save').inputSchema.properties.target.properties.look.properties.mode.enum,['cue','change','off']);
 assert.ok(by('lights_page_save').inputSchema.properties.page.properties.cues.items.properties.send.items.properties.message.enum.includes('preset'));
});

test('Real UDP and HTTP: look/get, zones, feedback over OSC; an HTTP target reply summary reaches network.status',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stagelight-look-')),port=19500+Math.floor(Math.random()*400),oscPort=port+500;
 const bodies=[],receiver=http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{bodies.push(JSON.parse(b));r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({ok:true,status:'applied',summary:'WB 3200K'}))})});
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.resolve('server.mjs')],{env:{...process.env,LIGHTS_PORT:String(port),LIGHTS_OSC_PORT:String(oscPort),LIGHTS_DATA_DIR:dir},stdio:['ignore','pipe','inherit']});
 const sock=dgram.createSocket('udp4'),inbox=[];sock.on('message',m=>inbox.push(...decodePacket(m)));
 try{
  await new Promise(r=>child.stdout.on('data',d=>{if(String(d).includes('LIGHTS_READY'))r()}));await new Promise(r=>sock.bind(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${port}`,token=(await fetch(base+'/api/session').then(r=>r.json())).token;
  const post=(command,args)=>fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command,args})}).then(r=>r.json());
  const waitFor=async(test,ms=1500)=>{const end=Date.now()+ms;for(;;){const m=await test();if(m)return m;if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,5))}};
  await post('zone.save',{zone:{id:'back',name:'Backlights',role:'back',groups:['backlights']}});
  await post('target.save',{target:{id:'udp',name:'UDP cam',kind:'osc',host:'127.0.0.1',port:sock.address().port}});
  await post('target.save',{target:{id:'web',name:'Web cam',kind:'http',url:`http://127.0.0.1:${receiver.address().port}/stagelight`,look:{zones:['back'],members:true}}});
  const send=(a,args)=>sock.send(encodeOSC(a,args),oscPort,'127.0.0.1');
  send('/stagelight/look/get',[]);await waitFor(()=>inbox.find(m=>m.address==='/stagelight/look/end'));assert.deepEqual(inbox.map(m=>m.address),['/stagelight/look/begin','/stagelight/look','/stagelight/look/zone','/stagelight/look/end']);
  inbox.length=0;send('/stagelight/zones',[]);await waitFor(()=>inbox.find(m=>m.address==='/stagelight/zones/end'));assert.deepEqual(inbox.find(m=>m.address==='/stagelight/zone').args,['back','Backlights','back',8]);
  inbox.length=0;send('/stagelight/look/get',['udp']);await waitFor(()=>inbox.find(m=>m.address==='/stagelight/look/end'));
  send('/stagelight/look/get',['Web cam','','w1']);const body=await waitFor(()=>bodies.find(b=>b.type==='look'));assert.equal(body.reason,'request');assert.equal(body.requestId,'w1');assert.equal(body.zones[0].members.length,8);
  const row=await waitFor(async()=>(await post('network.status',{})).outbound.find(r=>r.targetId==='web'&&r.reply));assert.deepEqual(row.reply,{ok:true,status:'applied',summary:'WB 3200K'});
  send('/stagelight/feedback',[row.id,'failed','Camera offline']);inbox.length=0;send('/stagelight/ping',[]);await waitFor(()=>inbox.find(m=>m.address==='/stagelight/hello'));
  const s2=await post('network.status',{});assert.equal(s2.outbound.find(r=>r.id===row.id).feedback.summary,'Camera offline');assert.ok(s2.inbound.some(r=>r.address==='/stagelight/feedback'&&r.ok));
 }finally{sock.close();receiver.close();child.kill('SIGTERM');await new Promise(r=>child.on('exit',r));fs.rmSync(dir,{recursive:true,force:true})}
});
