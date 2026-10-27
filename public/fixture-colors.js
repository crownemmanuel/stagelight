import {BEAM7R_COLOR_PRESETS,BEAM7R_COLOR_BANDS} from './beam7r-presets.js';
import {BEAM200_COLOR_PRESETS,BEAM200_COLOR_BANDS} from './beam200-presets.js';
// The DMX encoder and 3D preview share these wheel choices. Swatch RGBs are
// illustrative approximations of filters, not measured spectral calibration.
export const COLOR_WHEELS={
 rogue:[['#ffffff',0],['#ff0000',6],['#ff8000',10],['#00ffff',14],['#70ff60',18],['#ffff99',22],['#bb88ff',26],['#ff88bb',30],['#ffff00',34],['#ff00ff',38],['#55aaff',42],['#ffb000',46]],
 mh7:[['#ffffff',0],['#ff0000',12],['#0000ff',23],['#00ff00',33],['#ff00ff',43],['#ffff00',53],['#70bfff',63],['#ff88bb',74],['#ff8000',85],['#00ffff',96],['#9900ff',106],['#ffcf99',115],['#b0d2ff',125],['#6600aa',137]]
};
export const hexRGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
export function nearestWheel(profile,requested,slots=COLOR_WHEELS[profile]??[]){
 let best=null,distance=Infinity;
 for(const slot of slots){const [hex,value,secondary=0]=Array.isArray(slot)?slot:[slot.color,slot.value,slot.secondary??0];const rgb=hexRGB(hex),d=rgb.reduce((n,c,i)=>n+(c-requested[i])**2,0);if(d<distance){distance=d;best={hex,value,secondary,rgb}}}
 return best;
}
// Raw wheel overrides take precedence; saved fixture slots translate RGB requests.
// These controls address only known color channels, never reset/lamp channels.
export function fixtureWheel(f,state){
 const slots=f.colorSlots??[],white=state.color.every(c=>c===1);
 const slot=state.colorWheel===undefined&&(!white||slots.some(s=>s.color.toLowerCase()==='#ffffff'))?nearestWheel(f.profile,state.color,slots):null;
 return {value:Math.max(0,Math.min(f.profile==='beam7r'?119:127,Math.round(state.colorWheel??slot?.value??0))),secondary:Math.max(0,Math.min(255,Math.round(state.colorWheel2??slot?.secondary??0)))};
}
export function outputRGB(profile,requested,white=0,fixture={},state={}){
 if(profile==='beam200'||profile==='beam7r'){
  const wheel=fixtureWheel({...fixture,profile},{...state,color:requested});
  const slot=fixture.colorSlots?.find(s=>s.value===wheel.value&&(s.secondary??0)===wheel.secondary);
  return slot?hexRGB(slot.color):[1,1,1]; // Unsaved wheel positions have no verified preview color.
 }
 const wheel=nearestWheel(profile,requested);if(wheel)return wheel.rgb;
 const tint=profile==='q120'?[1,.78,.5]:profile==='colorado'?[1,1,1]:profile==='reveE3'?[1,.88,.6]:profile==='pendant4'?[1,.95,.85]:[0,0,0];
 return requested.map((c,i)=>Math.max(0,Math.min(1,c+white*tint[i])));
}
// False when a 200W/7R sits on a wheel position nobody has named yet (outputRGB then reports white).
export function colorKnown(profile,requested,fixture={},state={}){
 if(profile!=='beam200'&&profile!=='beam7r')return true;
 const wheel=fixtureWheel({...fixture,profile},{...state,color:requested});
 return !!fixture.colorSlots?.some(s=>s.value===wheel.value&&(s.secondary??0)===wheel.secondary);
}

// Use the same resolved DMX wheel position as the encoder, including raw overrides.
// Split-filter portions are schematic: names/values are observed; spectral RGBs
// and their proportions are approximations until measured in the room.
export function outputBands(profile,requested,white=0,fixture={},state={}){
 if(profile==='beam200'||profile==='beam7r'){
  const presets=profile==='beam200'?BEAM200_COLOR_PRESETS:BEAM7R_COLOR_PRESETS,bands=profile==='beam200'?BEAM200_COLOR_BANDS:BEAM7R_COLOR_BANDS;
  const wheel=fixtureWheel({...fixture,profile},{...state,color:requested});
  const slot=fixture.colorSlots?.find(s=>s.value===wheel.value&&(s.secondary??0)===wheel.secondary);
  const preset=presets.find(s=>s.value===wheel.value);
  if(slot&&preset&&slot.name===preset.name&&slot.color.toLowerCase()===preset.color&&wheel.secondary===0&&bands[wheel.value])return bands[wheel.value].map(hexRGB);
 }
 return [outputRGB(profile,requested,white,fixture,state)];
}
export function bandSwatch(bands){
 const hex=rgb=>'#'+rgb.map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('');
 return bands.length>1?'linear-gradient(90deg,'+bands.flatMap((rgb,i)=>[`${hex(rgb)} ${i*100/bands.length}%`,`${hex(rgb)} ${(i+1)*100/bands.length}%`]).join(',')+')':hex(bands[0]);
}
