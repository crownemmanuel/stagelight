// A stand-in for stagelight-io that can misbehave on request, for tests/modules-resilience.test.mjs (LIGHTS_IO_BIN).
// Same devices as fake-io.mjs. Extra ops: test.crash {code} exits; test.hang stops answering anything;
// test.garbage writes malformed lines; test.devices {audio, midiIn, midiOut} changes the device list and reports it,
// as the real helper does on hot-plug.
import readline from 'node:readline';
const out=m=>process.stdout.write((typeof m==='string'?m:JSON.stringify(m))+'\n');
let list={audio:[{name:'Dante Virtual Soundcard',inputs:64},{name:'MacBook Pro Microphone',inputs:1}],midiIn:['APC40 mkII'],midiOut:['APC40 mkII']},hung=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 if(hung)return;let m;try{m=JSON.parse(line)}catch{return}
 if(m.op==='devices')out({ev:'devices',...list});
 else if(m.op==='audio.open')out({ev:'audio',ok:true,device:m.device,channels:64});
 else if(m.op==='test.crash')process.exit(m.code??3);
 else if(m.op==='test.hang')hung=true;
 else if(m.op==='test.garbage'){for(const l of ['not json','null','[1,2]','42','{"ev":5}','{"ev":"hit"}','{"ev":"hit","id":{"x":1}}','{"ev":"level","levels":"loud"}','{"ev":"level","levels":{"m1":"x","m2":null}}','{"ev":"meter","levels":[1],"input":"x"}','{"ev":"midi","port":"apc","bytes":"zz"}','{"ev":"midi","port":"apc","bytes":[176,7]}','{"ev":"midi","port":"apc","bytes":[144,300,1]}','{"ev":"midi","port":"apc","bytes":[240,0,0,0,97]}','{"ev":"audio"}','{"ev":"error"}'])out(l);out({ev:'garbage-done'})}
 else if(m.op==='test.devices'){list={audio:m.audio??[],midiIn:m.midiIn??[],midiOut:m.midiOut??[]};out({ev:'devices',...list})}
 else if(m.op==='quit')process.exit(0);
});
