// Akai APC40 mkII, from Akai's "APC40 Mk2 Communications Protocol" v1.2 (19 January 2015). StageLight puts it in
// Ableton Live Mode (0x41), where every button is momentary and the host drives the LEDs (docs/MIDI-AND-SOUND.md).
// The protocol numbers the clip grid 1-40 (notes 0x00-0x27) but does not say which row is which; we take the top row
// as notes 32-39 and the bottom row as 0-7, as the unit is commonly used. The editor lights each control you press,
// so check this on the real unit.

// RGB LED palette (velocity → colour, protocol pages 18-22) and nearest-colour matching live in public/pad-colors.js,
// shared with the desk so its masters show the colour the pads show.
export {PALETTE,nearestColor,dimColor} from '../../public/pad-colors.js';
// RGB LED types are chosen by MIDI channel: 0 solid, 6-10 pulsing, 11-15 blinking (1/24 … 1/2).
export const LED={solid:0,pulse:8,blink:13};

// Controls. kind: pad (RGB), button (single LED or none), fader, knob (absolute), encoder (relative).
// x, y, w, h place the control on the editor's drawing of the unit (a 112 × 74 board).
const C=[];
const add=(id,label,kind,midi,x,y,w,h,led)=>C.push({id,label,kind,midi,x,y,w,h,...(led?{led}:{})});
for(let row=0;row<5;row++)for(let col=0;col<8;col++){const n=row*8+col+1;add(`pad-${n}`,`Pad ${n}`,'pad',{type:'note',number:(4-row)*8+col},3+col*8.6,10+row*5.6,7.6,4.6,'rgb')}
for(let i=0;i<5;i++)add(`scene-${i+1}`,`Scene launch ${i+1}`,'pad',{type:'note',number:0x52+i},73,10+i*5.6,6,4.6,'rgb');
for(let t=0;t<8;t++){
 const x=3+t*8.6;
 add(`clip-stop-${t+1}`,`Clip stop ${t+1}`,'button',{type:'note',number:0x34,channel:t},x,38.4,7.6,2.6,'clip');
 add(`track-${t+1}`,`Track select ${t+1}`,'button',{type:'note',number:0x33,channel:t},x,42,7.6,3,'single');
 add(`activator-${t+1}`,`Activator ${t+1}`,'button',{type:'note',number:0x32,channel:t},x,46,2.4,2.4,'single');
 add(`solo-${t+1}`,`Solo ${t+1}`,'button',{type:'note',number:0x31,channel:t},x+2.6,46,2.4,2.4,'single');
 add(`arm-${t+1}`,`Record arm ${t+1}`,'button',{type:'note',number:0x30,channel:t},x+5.2,46,2.4,2.4,'single');
 add(`fader-${t+1}`,`Fader ${t+1}`,'fader',{type:'cc',number:0x07,channel:t},x+1.3,51,5,20);
 add(`knob-${t+1}`,`Track knob ${t+1}`,'knob',{type:'cc',number:0x30+t},x+1.3,2,5,5);
}
add('stop-all','Stop all clips','button',{type:'note',number:0x51},73,38.4,6,2.6);
add('master','Master','button',{type:'note',number:0x50},73,42,6,3,'single');
add('cue-level','Cue level','encoder',{type:'cc',number:0x2F},73.5,46,5,4.6);
add('master-fader','Master fader','fader',{type:'cc',number:0x0E},73.5,51,5,20);
[['pan','Pan',0x57,81,10],['sends','Sends',0x58,81,14],['user','User',0x59,81,18],['play','Play',0x5B,88,10],['record','Record',0x5D,95,10],['session','Session',0x66,102,10],
 ['metronome','Metronome',0x5A,88,15],['tap','Tap tempo',0x63,95,15],['nudge-minus','Nudge −',0x64,88,19.5],['nudge-plus','Nudge +',0x65,95,19.5]].forEach(([id,label,n,x,y])=>add(id,label,'button',{type:'note',number:n},x,y,6,3,['tap','nudge-minus','nudge-plus'].includes(id)?null:'single'));
add('stop','Stop','button',{type:'note',number:0x5C},102,15,6,3);
add('tempo','Tempo knob','encoder',{type:'cc',number:0x0D},103,19,5,5);
for(let i=0;i<8;i++)add(`device-${i+1}`,`Device knob ${i+1}`,'knob',{type:'cc',number:0x10+i},83+(i%4)*7,26+Math.floor(i/4)*8,5.4,5.4);
[['device-left','Device ◀',0x3A],['device-right','Device ▶',0x3B],['bank-left','Bank ◀',0x3C],['bank-right','Bank ▶',0x3D],['device-onoff','Device on/off',0x3E],['device-lock','Device lock',0x3F],['clip-view','Clip/device view',0x40],['detail-view','Detail view',0x41]]
 .forEach(([id,label,n],i)=>add(id,label,'button',{type:'note',number:n},83+(i%4)*7,42+Math.floor(i/4)*4.2,5.4,2.8,'single'));
[['up','Bank select ▲',0x5E,86,54],['down','Bank select ▼',0x5F,86,62],['left','Bank select ◀',0x61,81,58],['right','Bank select ▶',0x60,91,58]].forEach(([id,label,n,x,y])=>add(id,label,'button',{type:'note',number:n},x,y,4.6,3.4));
add('shift','Shift','button',{type:'note',number:0x62},99,54,6,3);
add('bank-lock','Bank','button',{type:'note',number:0x67},99,59,6,3);
add('crossfader','Crossfader','fader',{type:'cc',number:0x0F},85,67,20,4);
export const CONTROLS=C;
const byId=new Map(C.map(c=>[c.id,c]));

// The default StageLight map. Faders 1-8 and the track buttons work on the fader bank (masters 1-8, A S D F G H J K,
// moved by Bank ◀ ▶); the 40 pads are masters 1-40, top-left first; the five scene buttons are scenes 1-5; the eight
// numbered Activator buttons switch the fader bank masters' sound triggers on and off (lit while on).
export const DEFAULT_MAP=Object.fromEntries([
 ...Array.from({length:40},(_,i)=>[`pad-${i+1}`,{do:'master.press',n:i+1}]),
 ...Array.from({length:5},(_,i)=>[`scene-${i+1}`,{do:'scene',n:i+1}]),
 ...Array.from({length:8},(_,i)=>[[`fader-${i+1}`,{do:'bank.level',n:i+1}],[`track-${i+1}`,{do:'bank.press',n:i+1}],[`clip-stop-${i+1}`,{do:'bank.release',n:i+1}],[`activator-${i+1}`,{do:'bank.sound',n:i+1}]]).flat(),
 ['master-fader',{do:'grand'}],['stop-all',{do:'stop'}],['play',{do:'go'}],['stop',{do:'back'}],['record',{do:'blackout'}],['session',{do:'highlight'}],
 ['tap',{do:'tap'}],['nudge-minus',{do:'tempo.nudge',delta:-1}],['nudge-plus',{do:'tempo.nudge',delta:1}],['shift-nudge-minus',{do:'tempo.half'}],['shift-nudge-plus',{do:'tempo.double'}],
 ['metronome',{do:'tempo.reset'}],['tempo',{do:'tempo.fine'}],['bank-left',{do:'bank.prev'}],['bank-right',{do:'bank.next'}],['left',{do:'bank.prev'}],['right',{do:'bank.next'}],['master',{do:'clear'}]
]);
// Introduction: Ableton Live Mode, app version 1.0.0 (protocol page 12).
export const INTRO=[0xF0,0x47,0x7F,0x29,0x60,0x00,0x04,0x41,0x01,0x00,0x00,0xF7];

// Incoming bytes → {control, value} (value 1/0 for buttons, 0..1 for faders and knobs, steps for encoders).
export function parse(bytes){
 const [st,a,b]=bytes,kind=st&0xF0,ch=st&0x0F;
 if(kind===0x90||kind===0x80){const down=kind===0x90&&b>0,c=C.find(x=>x.midi.type==='note'&&x.midi.number===a&&(x.midi.channel===undefined||x.midi.channel===ch));return c?{control:c.id,value:down?1:0}:null}
 if(kind===0xB0){const c=C.find(x=>x.midi.type==='cc'&&x.midi.number===a&&(x.midi.channel===undefined||x.midi.channel===ch));if(!c)return null;return {control:c.id,value:c.kind==='encoder'?(b<64?b:b-128):b/127}}
 return null;
}
// One message for an LED: note on with the LED type on the channel (RGB) or the track (per-track buttons).
export function ledMessage(control,velocity,type=0){
 const c=byId.get(control),m=c.midi,channel=c.led==='rgb'?type:m.channel??0;
 return velocity?[0x90|channel,m.number,velocity]:[0x80|(m.channel??0),m.number,0];
}
export const control=id=>byId.get(id);
