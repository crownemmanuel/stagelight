// A stand-in for the native helper (stagelight-io) that speaks its protocol over stdin/stdout, for engine tests
// (LIGHTS_IO_BIN). It reports a Dante Virtual Soundcard and an APC40 mkII; tests inject hits and MIDI themselves.
import readline from 'node:readline';
const out=m=>process.stdout.write(JSON.stringify(m)+'\n');let demo=null,metering=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.op==='devices')out({ev:'devices',audio:[{name:'Dante Virtual Soundcard',inputs:64},{name:'MacBook Pro Microphone',inputs:1}],midiIn:['APC40 mkII'],midiOut:['APC40 mkII']});
 else if(m.op==='audio.open'){out({ev:'audio',ok:true,device:m.device,channels:64});
  // FAKE_IO_DEMO=1 (desk checks only): a pulsing input level and a kick hit twice a second on every hit trigger.
  // While metering, every channel too, as the real helper does: 1–16 carry the drums, 20–27 the band, the rest are silent.
  if(process.env.FAKE_IO_DEMO&&!demo){let n=0;demo=setInterval(()=>{n++;const kick=n%8===0,db=kick?-8:-30+10*Math.sin(n/3);out({ev:'meter',input:db,levels:Object.fromEntries(m.triggers.map(t=>[t.id,db])),...(metering?{channels:Array.from({length:64},(_,i)=>i<16||(i>=19&&i<27)?Math.round(db-i%5*3):-90)}:{})});if(kick)for(const t of m.triggers)if(t.mode!=='follow')out({ev:'hit',id:t.id,level:db})},66)}}
 else if(m.op==='audio.meter')metering=!!m.on;
 else if(m.op==='quit')process.exit(0);
});
