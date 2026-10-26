import {fixtureWheel,outputBands,hexRGB} from './fixture-colors.js';
export const wheelFixtures=fixtures=>fixtures.filter(f=>['beam200','beam7r'].includes(f.profile));
// Capture each selected fixture's current value, not a shared slider's first value.
export function wheelEntries(fixtures,frames){
 return wheelFixtures(fixtures).map(f=>{const state=frames.find(s=>s.id===f.id);if(!state)throw Error('No current wheel state for '+f.id);const wheel=fixtureWheel(f,state);return {id:f.id,value:wheel.value,...(f.profile==='beam200'?{secondary:wheel.secondary}:{})}});
}
// A group swatch recalls each head's own calibrated position for the named color.
export function sharedWheelColors(fixtures){
 const targets=wheelFixtures(fixtures);if(!targets.length)return [];
 const same=(a,b)=>a.name===b.name&&a.color.toLowerCase()===b.color.toLowerCase();
 return [...(targets[0].colorSlots??[])].sort((a,b)=>a.value-b.value||(a.secondary??0)-(b.secondary??0)).filter((slot,index,list)=>list.findIndex(s=>same(s,slot))===index&&targets.every(f=>f.colorSlots?.some(s=>same(s,slot)))).map(slot=>({name:slot.name,color:slot.color,bands:outputBands(targets[0].profile,hexRGB(slot.color),0,targets[0],{colorWheel:slot.value,colorWheel2:slot.secondary??0}),entries:targets.map(f=>{const s=f.colorSlots.find(c=>same(c,slot));return {id:f.id,value:s.value,...(f.profile==='beam200'?{secondary:s.secondary??0}:{})}})}));
}
