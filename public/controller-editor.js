// Visual APC40 mkII profile editor (docs/MIDI-AND-SOUND.md), loaded only when opened from Settings → Modules. The board
// is drawn from the profile's own control table and mirrors the LEDs StageLight sends; pressing a real control lights
// it here. Click a control to choose what it does; Test runs it as if pressed. Saved with controller.save, the same
// command agents use, so the profile travels with the show.
const NAMES={none:'Nothing','master.press':'Press a master','master.release':'Release a master','master.level':'Master level (fader)','master.sound':'Sound trigger on/off (master)','bank.sound':'Sound trigger on/off (fader bank)','bank.press':'Press the fader bank’s master','bank.release':'Release the fader bank’s master','bank.level':'Fader bank level','bank.prev':'Fader bank ◀','bank.next':'Fader bank ▶',scene:'Scene (press again to release)','scene.release':'Release the scene',grand:'Grand master',go:'GO',back:'Back',stop:'Stop all cues',clear:'Clear manual changes',highlight:'Highlight',blackout:'Blackout',tap:'Tap tempo','tempo.nudge':'Nudge the tempo','tempo.half':'Half time','tempo.double':'Double time','tempo.reset':'Back to the cue’s own tempo','tempo.fine':'Fine tempo'};
const PRESS=['none','master.press','master.release','master.sound','bank.press','bank.release','bank.sound','scene','scene.release','go','back','stop','clear','highlight','blackout','tap','tempo.nudge','tempo.half','tempo.double','tempo.reset','bank.prev','bank.next'];
const FOR={pad:PRESS,button:PRESS,fader:['none','master.level','bank.level','grand'],knob:['none','master.level','bank.level','grand'],encoder:['none','tempo.fine']};
const W=112,H=74,SHOWS={auto:'Auto',on:'On',off:'Off'};
import {SWATCHES} from './pad-colors.js';
export async function openControllerEditor(ctx){
 const {dialog,command,quiet,toast,esc,icon,fillIcons,back,getShow}=ctx;let st,sel=null,shift=false,lastAt=0,timer=null,colorAt=null;
 try{st=await command('midi.status')}catch{return}
 const key=id=>(shift?'shift-':'')+id,act=id=>st.profile.map[key(id)]??(shift?{do:'none'}:{do:'none'});
 const midiText=c=>c.midi.type==='note'?`Note ${c.midi.number}${c.midi.channel!==undefined?` · channel ${c.midi.channel+1}`:''}`:`CC ${c.midi.number}${c.midi.channel!==undefined?` · channel ${c.midi.channel+1}`:''}`;
 // An LED's look from the messages StageLight sends: RGB velocity → palette colour; a second message means it pulses.
 const look=c=>{const msgs=st.leds?.[c.id];if(!msgs||!msgs.length||msgs[0][0]>>4===8)return {};if(c.led==='rgb')return {color:st.palette[msgs[0][2]],pulse:msgs.length>1};return {on:msgs[0][2]>0}};
 const board=()=>st.controls.map(c=>{const l=look(c),a=act(c.id),style=`left:${c.x/W*100}%;top:${c.y/H*100}%;width:${c.w/W*100}%;height:${c.h/H*100}%;${l.color?`--led:${l.color}`:''}`;
  return `<button class="apc-c ${c.kind} ${l.color?'lit':''} ${l.pulse?'pulse':''} ${l.on?'on':''} ${a.do==='none'?'unmapped':''} ${sel===c.id?'selected':''}" data-c="${c.id}" style="${style}" title="${esc(c.label)} · ${esc(NAMES[a.do]??a.do)}${a.n?' '+a.n:''}">${c.kind==='fader'?'<i></i>':''}</button>`}).join('');
 // Master colours (masters.assign color, read back from midi.status masterColors): the pads and the desk's masters show them.
 const bankNo=()=>st.controller?.bank??0;
 const masterFor=id=>{const a=act(id);if(!/^(master|bank)\.(press|release|level|sound)$/.test(a.do)||!a.n)return null;return a.do.startsWith('bank.')?bankNo()*8+a.n:a.n};
 const slotName=n=>{const sh=getShow?.(),m=sh?.masters.slots[n-1];return m?m.label??sh.cues.find(c=>c.id===m.cue)?.name??'empty':''};
 const swatches=n=>{const mc=st.masterColors?.[n-1];if(!mc)return `<p class="hint">There is no master ${n} yet: add it under the stage.</p>`;
  return `<div class="apc-swatches">${SWATCHES.map(h=>`<button class="apc-sw ${mc.pad.toLowerCase()===h.toLowerCase()?'active':''}" data-sw="${h}" data-swn="${n}" style="--sw:${h}" title="${h}" aria-label="Colour ${h}"></button>`).join('')}<label class="apc-sw custom" title="Any colour: the pad shows the nearest it can"><input type="color" data-swc="${n}" value="${mc.color}"></label></div>${mc.own?`<button class="chip-button" data-swpage="${n}">Back to its automatic colour</button>`:''}`};
 const seg=(k,v)=>`<div class="segmented apc-seg">${Object.entries(SHOWS).map(([x,l])=>`<button data-desk="${k}" data-v="${x}" class="${v===x?'active':''}">${l}</button>`).join('')}</div>`;
 const desk=()=>{const b=bankNo(),p=st.profile;
  return `<h3>Masters on the desk</h3><p class="hint">Auto: only while the APC40 is connected.</p>
   <label class="mini"><span>Track numbers 1–8 instead of keys</span>${seg('deskNumbers',p.deskNumbers)}</label>
   <label class="mini"><span>Pad colours</span>${seg('deskColors',p.deskColors)}</label>
   <h3>Colours · fader bank ${b+1}</h3><div class="apc-mcolors">${Array.from({length:8},(_,k)=>{const n=b*8+k+1,mc=st.masterColors?.[n-1];return mc?`<button class="apc-mc ${colorAt===n?'active':''}" data-mc="${n}" style="--sw:${mc.pad}" title="Master ${n} · ${esc(slotName(n))}"><b>${k+1}</b></button>`:''}).join('')}</div>
   ${colorAt?`<p class="hint">Master ${colorAt} · ${esc(slotName(colorAt))}</p>${swatches(colorAt)}`:'<p class="hint">Pick a number to change that master’s colour. The pads show it, and so does the desk.</p>'}`};
 const panel=()=>{
  const c=st.controls.find(x=>x.id===sel);if(!c)return `<p class="hint">Click any control on the board, or press one on the APC40, to see and change what it does.</p>${desk()}`;const mn=masterFor(c.id);
  const a=act(c.id),list=FOR[c.kind]??PRESS,needsN=/^(master|bank)\.(press|release|level|sound)$|^scene$/.test(a.do),max=a.do.startsWith('bank.')?8:a.do==='scene'?Math.max(5,st.scenes??5):60;
  return `<h3>${esc(c.label)}</h3><p class="hint">${midiText(c)}</p>${c.kind==='button'||c.kind==='pad'?`<label class="check-row"><input type="checkbox" id="edShift" ${shift?'checked':''}> With Shift held</label>`:''}
   <label class="mini"><span>Does</span><select id="edDo">${list.map(d=>`<option value="${d}" ${a.do===d?'selected':''}>${esc(NAMES[d])}</option>`).join('')}</select></label>
   ${needsN?`<label class="mini"><span>${a.do.startsWith('bank.')?'Fader bank column':a.do==='scene'?'Scene':'Master'}</span><select id="edN">${Array.from({length:max},(_,i)=>`<option value="${i+1}" ${a.n===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label>`:''}
   ${a.do==='tempo.nudge'?`<label class="mini"><span>BPM per press</span><input id="edDelta" type="number" step=".5" min="-20" max="20" value="${a.delta??1}"></label>`:''}
   ${mn?`<label class="field-label">Master ${mn} colour${slotName(mn)?' · '+esc(slotName(mn)):''}</label>${swatches(mn)}`:''}
   <div class="dialog-actions"><button class="ghost-button" id="edTest"><span data-icon="play"></span>Test</button><button class="ghost-button" id="edDefault">Default</button><button class="ghost-button" id="edDesk">Desk and colours</button></div>`;
 };
 const draw=()=>{
  dialog('APC40 mkII',`<div class="apc-editor"><div class="apc-wrap"><div class="apc-board">${board()}<span class="apc-logo">APC40 mkII</span></div><p class="hint apc-status">${st.controller?`${icon('check')} Connected · fader bank ${st.controller.bank+1}`:`${icon('warning')} Not connected: plug it in over USB. You can still change the profile.`}</p></div><aside class="apc-side" id="apcSide">${panel()}</aside></div>
   <div class="dialog-actions"><button class="ghost-button" id="apcBack"><span data-icon="left"></span>Settings</button><button class="ghost-button danger" id="apcReset">Reset whole profile</button></div>`);
  $('#dialog').classList.add('wide');bind();
 };
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const save=async(map)=>{try{await command('controller.save',{id:'apc40mk2',map});st=await command('midi.status');refreshBoard()}catch{}};
 // Structural redraw: after a selection or a saved change. The poll below only repaints LEDs in place.
 const refreshBoard=()=>{const b=$('.apc-board');if(!b)return;b.innerHTML=board()+'<span class="apc-logo">APC40 mkII</span>';$$('[data-c]').forEach(x=>x.onclick=()=>{sel=x.dataset.c;shift=false;refreshSide()});const side=$('#apcSide');if(side){side.innerHTML=panel();fillIcons(side);bindSide()}};
 const refreshSide=()=>{refreshBoard()};
 const paintBoard=()=>{for(const c of st.controls){const el=document.querySelector(`[data-c="${c.id}"]`);if(!el)continue;const l=look(c);el.classList.toggle('lit',!!l.color);el.classList.toggle('pulse',!!l.pulse);el.classList.toggle('on',!!l.on);if(l.color)el.style.setProperty('--led',l.color);else el.style.removeProperty('--led')}};
 const reread=async()=>{st=await command('midi.status');refreshBoard()};
 const color=(n,args)=>quiet(command('masters.assign',{slot:st.masterColors[n-1].slot,...args}).then(reread));
 const bindSide=()=>{
  $$('[data-sw]').forEach(b=>b.onclick=()=>color(+b.dataset.swn,{color:b.dataset.sw.toLowerCase()}));
  $$('[data-swc]').forEach(x=>x.onchange=()=>color(+x.dataset.swc,{color:x.value}));
  $$('[data-swpage]').forEach(b=>b.onclick=()=>color(+b.dataset.swpage,{clearColor:true}));
  $$('[data-mc]').forEach(b=>b.onclick=()=>{colorAt=+b.dataset.mc===colorAt?null:+b.dataset.mc;refreshSide()});
  $$('[data-desk]').forEach(b=>b.onclick=()=>quiet(command('controller.save',{id:'apc40mk2',[b.dataset.desk]:b.dataset.v}).then(reread)));
  const c=st.controls.find(x=>x.id===sel);if(!c)return;const a=act(c.id);
  $('#edDesk').onclick=()=>{sel=null;refreshSide()};
  if($('#edShift'))$('#edShift').onchange=e=>{shift=e.target.checked;refreshSide()};
  $('#edDo').onchange=e=>{const d=e.target.value,n=/^(master|bank)\.|^scene$/.test(d)?(a.n??1):undefined;save({[key(c.id)]:{do:d,...(n?{n}:{}),...(d==='tempo.nudge'?{delta:1}:{})}})};
  if($('#edN'))$('#edN').onchange=e=>save({[key(c.id)]:{...a,n:+e.target.value}});
  if($('#edDelta'))$('#edDelta').onchange=e=>save({[key(c.id)]:{...a,delta:Math.max(-20,Math.min(20,+e.target.value||1))}});
  $('#edTest').onclick=()=>quiet(command('controller.test',{id:'apc40mk2',control:c.id,value:1}).then(()=>toast(`Ran: ${NAMES[a.do]??a.do}${a.n?' '+a.n:''}`)));
  $('#edDefault').onclick=()=>{const d=st.defaults[key(c.id)]??{do:'none'};save({[key(c.id)]:d})};
 };
 const bind=()=>{
  fillIcons($('#dialogBody'));refreshBoard();
  $('#apcBack').onclick=()=>{clearInterval(timer);back()};
  $('#apcReset').onclick=async()=>{await quiet(command('controller.reset',{id:'apc40mk2'}));st=await command('midi.status');refreshBoard();toast('Profile reset to the default map.')};
 };
 draw();
 // While the editor is open: mirror LEDs and light the control last pressed on the unit (it is also selected).
 timer=setInterval(async()=>{
  if(!$('#dialog').open||!$('.apc-board')){clearInterval(timer);return}
  try{const next=await command('midi.status');const pressed=next.last&&next.last.at!==lastAt?next.last:null;st=next;
   if(pressed){lastAt=pressed.at;if(sel!==pressed.control){sel=pressed.control;shift=false;refreshBoard()}else paintBoard();const el=$(`[data-c="${pressed.control}"]`);el?.classList.add('hit');setTimeout(()=>el?.classList.remove('hit'),250)}
   else paintBoard();const s=$('.apc-status');if(s)s.innerHTML=st.controller?`${icon('check')} Connected · fader bank ${st.controller.bank+1}`:`${icon('warning')} Not connected: plug it in over USB. You can still change the profile.`}catch{}
 },400);
}
