// Pure helpers for the desk (public/app.js), kept here so they can be tested without a browser (tests/desk-ux.test.mjs).
// Nothing in this file touches the DOM or the engine.

// Seconds as an operator reads them: "Cut", "0.5 s", "9.5 s", "12 s", "1:05".
export function fmtSeconds(s){
 if(!Number.isFinite(s)||s<=0)return '0 s';
 if(s>=60){const m=Math.floor(s/60),r=Math.round(s-m*60);return r===60?`${m+1}:00`:`${m}:${String(r).padStart(2,'0')}`}
 return `${s<10?Math.round(s*10)/10:Math.round(s)} s`;
}
// Clock text for the GO bar: elapsed and what is left of the running cue ("0:04 · 0:05 left"); loops show elapsed only.
export function clock(t){const v=Math.max(0,Math.floor(t||0));return `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`}
export function cueTime(pb){
 if(!pb||!Number.isFinite(pb.elapsed))return '';
 if(pb.loop||!Number.isFinite(pb.duration)||pb.duration<=0)return clock(pb.elapsed);
 return `${clock(pb.elapsed)} · ${clock(Math.max(0,pb.duration-pb.elapsed))} left`;
}

// Fields where a key press is typing, so desk shortcuts must leave it alone. Sliders, checkboxes, radios and colour wells
// are not typing: after touching one, Space must still GO and the master keys must still fire.
const TYPING_INPUTS=new Set(['text','search','number','email','password','url','tel','date','time','datetime-local','month','week']);
export function isTyping(el){
 if(!el)return false;const tag=(el.tagName??'').toUpperCase();
 if(tag==='TEXTAREA'||tag==='SELECT')return true;
 if(tag==='INPUT')return TYPING_INPUTS.has(String(el.type??'text').toLowerCase());
 return el.isContentEditable===true;
}

// A short in-memory log of what the desk told the operator (toasts), newest first. Repeats of the same text within a
// few seconds fold into one row with a count, so a 1 s poll that keeps failing does not bury everything else.
export function createMessageLog(limit=60,now=()=>Date.now()){
 const rows=[];
 return {
  push(text,kind='info'){const t=now(),top=rows[0];if(top&&top.text===text&&top.kind===kind&&t-top.at<10000){top.count++;top.at=t;return top}
   const row={text:String(text),kind,at:t,count:1};rows.unshift(row);if(rows.length>limit)rows.length=limit;return row},
  list:()=>rows.slice(),
  errors:()=>rows.filter(r=>r.kind==='error').length,
  clear(){rows.length=0}
 };
}

// Go to a cue by its number in the cue list: digits typed on the keyboard, Enter runs it. Returns the entry or null.
export function entryByNumber(page,text){
 const n=Number.parseInt(String(text??'').trim(),10);if(!page||!Number.isInteger(n)||n<1)return null;
 return page.cues[n-1]??null;
}

// Every key the desk answers to, for the ? sheet. masters = show.masters ({slots, desk}); label(key) prints a key;
// name(slot) names a master's cue.
const DESK_LABEL={highlight:'Highlight',clear:'Clear',blackout:'Blackout',tap:'Tap tempo',stop:'Stop all'};
export function shortcutRows(masters,label,name=()=>''){
 const desk=masters?.desk??{},rows=[
  {group:'Playback',keys:['Space'],action:'GO: run the next cue'},
  {group:'Playback',keys:['Backspace'],action:'Back: the previous cue'},
  {group:'Playback',keys:['1','…','Enter'],action:'Go to a cue by its number (digits that are not master keys)'},
  {group:'Playback',keys:['Esc'],action:'Close a menu, stop preview or find, then select none'},
  {group:'Desk',keys:[desk.clear?label(desk.clear):'—'],action:'Clear: fade manual changes back to the cues'},
  {group:'Desk',keys:[desk.highlight?label(desk.highlight):'—'],action:'Highlight the selected fixtures'},
  {group:'Desk',keys:[desk.blackout?label(desk.blackout):'—'],action:'Blackout on / off'},
  {group:'Desk',keys:[desk.tap?label(desk.tap):'—'],action:'Tap tempo'},
  ...(desk.stop?[{group:'Desk',keys:[label(desk.stop)],action:'Stop all: running cues stop and manual changes clear'}]:[]),
  {group:'Desk',keys:['⌘Z'],action:'Undo the last manual change (programmer)'},
  {group:'Desk',keys:['⇧⌘Z'],action:'Undo the last show edit; press again to redo'},
  {group:'Desk',keys:['← →'],action:'Step through fixtures in Find, otherwise page the masters'},
  {group:'Desk',keys:['?'],action:'This list'},
  {group:'Show file',keys:['⌘S'],action:'Save show'},
  {group:'Show file',keys:['⇧⌘S'],action:'Save show as…'},
  {group:'Show file',keys:['⌘O'],action:'Open show…'}
 ];
 (masters?.slots??[]).forEach((m,i)=>{if(m.key)rows.push({group:'Masters',keys:[label(m.key)],action:`Master ${i+1}${name(m)?' · '+name(m):' · no cue yet'}`,sound:!!m.sound});
  if(m.key&&m.sound&&!m.key.startsWith('shift+')){const combo='shift+'+m.key,deskOwner=Object.entries(desk).find(([,k])=>k===combo)?.[0],slotOwner=(masters?.slots??[]).findIndex(x=>x.key===combo);
   rows.push(deskOwner||slotOwner>=0?{group:'Masters',keys:[label(combo)],action:`Master ${i+1}: no sound switch from the keyboard (${label(combo)} is ${deskOwner?DESK_LABEL[deskOwner]??deskOwner:`master ${slotOwner+1}`}). Click the wave badge on the slot instead.`}:{group:'Masters',keys:[label(combo)],action:`Master ${i+1}: sound trigger on / off`})}});
 return rows;
}

// Custom effect presets: a code preset chooses its own layer; others take it from their effect.
export const presetLayer=(p,effects)=>p?.layer??effects?.[p?.effect]?.layer;
// Controls for a code effect's params.args: numbers 0–1 get a slider, other numbers a number field, #rrggbb a colour
// well, booleans a checkbox. Anything else (number lists) is shown read-only.
export function argControls(args){
 return Object.entries(args??{}).map(([key,value])=>{
  if(typeof value==='boolean')return {key,kind:'check',value};
  if(typeof value==='number')return {key,kind:value>=0&&value<=1?'slider':'number',value};
  if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))return {key,kind:'color',value};
  return {key,kind:'fixed',value};
 });
}
// "tailLength" → "Tail length", "rate" → "Rate".
export const argLabel=k=>{const s=String(k).replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();return s.charAt(0).toUpperCase()+s.slice(1)};

// The bar over the stage. Output armed but failing (runtime.output.failing): it says packets are not getting out, with the
// reason, and cannot be dismissed. Output off while something is lit or playing: the "Output is off" hint (dismissible).
export function outputBar(o,driving,dismissed){
 if(o?.armed&&o.failing)return {show:true,failing:true,dismissible:false,pill:'LIVE · NOT SENDING',title:'Output is armed, but packets are not getting out',
  detail:`${o.lastError??'Art-Net send failed'} · ${o.recovering?'reopening the network socket':'still trying'}${o.sendErrors?` · ${o.sendErrors} failed sends`:''}. The rig is not receiving changes.`};
 return {show:!o?.armed&&!!driving&&!dismissed,failing:false,dismissible:true,pill:o?.armed?'LIVE':'Output off',title:'Output is off',detail:'The rig is not receiving anything. What you see here is preview only.'};
}

// runtime.showUndo.label in words: "cue.delete" → "delete cue"; "undo of cue.delete" (the next press redoes) → redo.
export function undoText(label){
 if(!label)return null;const n=(label.match(/^(undo of )+/i)?.[0].length??0)/8,redo=n%2===1,raw=label.slice(n*8);
 const words=/^[a-z]+(\.[a-z_]+)+$/i.test(raw)?(([noun,...verb])=>[...verb,noun].join(' ').replace(/_/g,' '))(raw.split('.')):raw;
 return {redo,words,menu:`${redo?'Redo':'Undo'}: ${words}`};
}
