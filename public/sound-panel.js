// The sound trigger section of a master's editor (docs/MIDI-AND-SOUND.md), loaded only while the sound module is on.
// Choose the input channel, band and mode, then set the sensitivity against the live meter. Flash on hits: each hit
// above the line flashes the master. Follow the level: the master brightens as the channel gets louder, from the line
// (dark) to the second marker (full). Metering runs only while this panel is open (sound.meter).
const BANDS=[['kick','Kick'],['snare','Snare'],['hat','Hat'],['full','Full']];
const thresholdDb=s=>-6-54*(s??.5);
const pct=db=>Math.max(0,Math.min(100,(db+60)/60*100));
export function mountSoundPanel(el,{slot,command,quiet,esc,icon,fillIcons,slotOf,cueOf,getRuntime}){
 let alive=true,adding=false;
 // How long after the hold ends the cue's first light comes (0 when its saved look already lights something).
 const late=(m,s)=>{const c=cueOf?.(m?.cue);if(!c||(c.look??[]).some(e=>(e.values.intensity??0)>0))return 0;const first=Math.min(...c.tracks.map(t=>t.start),Infinity);return Number.isFinite(first)?Math.max(0,first-(s.holdMs??80)/1000):0};
 const draw=async()=>{
  const st=await command('sound.status').catch(()=>null);if(!alive||!st)return;const m=slotOf(slot),s=m?.sound,follow=s?.mode==='follow',dev=st.devices.find(d=>d.name===st.device);
  // No trigger on this master: just the switch. Turning it on opens the set-up; nothing is saved until a channel is picked.
  if(!s&&!adding){
   el.innerHTML=`<h4>${icon('wave')}Sound trigger<label class="switch small" title="Turn on to drive this master from an audio input"><input type="checkbox" id="sdAdd"><span></span></label></h4><p class="hint">Off. Turn it on to flash this master on drum hits, or have it follow an instrument's level.</p>`;
   fillIcons(el);el.querySelector('#sdAdd').onchange=()=>{adding=true;draw()};return;
  }
  const cancel=()=>{const x=el.querySelector('#sdAdd');if(x)x.onchange=()=>{adding=false;draw()}};
  // No device yet: choose it right here (the same setting as Settings → Modules → Sound triggers).
  if(!st.device){
   el.innerHTML=`<h4>${icon('wave')}Sound trigger${s?'':'<label class="switch small" title="Cancel"><input type="checkbox" id="sdAdd" checked><span></span></label>'}</h4><label class="mini"><span>First, the audio input the drum comes in on</span><select id="sdDevice"><option value="">Choose an input…</option>${st.devices.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}${d.device?` (now ${esc(d.device)})`:''} · ${d.inputs} in</option>`).join('')}</select></label><p class="hint">Dante, an interface, a virtual device or the laptop mic. Used by every sound trigger.</p>`;
   fillIcons(el);cancel();el.querySelector('#sdDevice').onchange=e=>{if(e.target.value)quiet(command('modules.set',{sound:{enabled:true,device:e.target.value}}).then(draw))};return;
  }
  const on=!!s&&s.enabled!==false;
  el.innerHTML=`<h4>${icon('wave')}Sound trigger${s?`<label class="switch small" title="${on?'Listening: turn off to stop (settings are kept)':'Off: turn on to listen again'}"><input type="checkbox" id="sdOn" ${on?'checked':''}><span></span></label>`:'<label class="switch small" title="Cancel"><input type="checkbox" id="sdAdd" checked><span></span></label>'}</h4>
   ${s&&!on?`<p class="hint">Off: this master ignores the input. Its settings are kept (input ${s.channel}, ${s.band??'kick'}, ${s.mode==='follow'?'follow the level':'flash on hits'}).</p><button class="ghost-button small" id="sdRemove"><span data-icon="trash"></span>Remove the sound trigger</button>`:`
   <label class="mini"><span>Audio input (every sound trigger)</span><select id="sdDevice">${st.devices.map(d=>`<option value="${esc(d.name)}" ${d.name===st.device?'selected':''}>${esc(d.name)}${d.device?` (now ${esc(d.device)})`:''} · ${d.inputs} in</option>`).join('')}${dev?'':`<option selected value="${esc(st.device)}">${esc(st.device)} · not connected</option>`}</select></label>
   <div class="mp-row"><label class="mini"><span>Channel</span><select id="sdChannel">${s?'':'<option value="">Choose a channel…</option>'}${Array.from({length:Math.max(dev?.inputs??0,s?.channel??0)},(_,i)=>`<option value="${i+1}" ${s?.channel===i+1?'selected':''}>Input ${i+1}</option>`).join('')}</select></label>
   <div class="segmented small" id="sdBand">${BANDS.map(([b,l])=>`<button data-band="${b}" class="${(s?.band??'kick')===b?'active':''}" ${s?'':'disabled'}>${l}</button>`).join('')}</div></div>
   ${s?`<div class="segmented small sd-mode"><button data-sdmode="hit" class="${follow?'':'active'}"><span data-icon="bolt"></span>Flash on hits</button><button data-sdmode="follow" class="${follow?'active':''}"><span data-icon="wave"></span>Follow the level</button></div>
   <p class="hint">${follow?'The lights breathe with the sound: brighter as it gets louder, fading as it fades. For guitar, keys, pads and vocals.':'Each hit flashes the master. For drums and rhythmic parts.'}</p>
   <label class="mini"><span>${follow?'Sensitivity: the lights start at the line and are full at the second mark':'Sensitivity: hits above the line flash the master'}</span><input id="sdSens" type="range" min="0" max="1" step=".01" value="${s.sensitivity??.5}"></label><div class="sd-meter"><i></i><b></b>${follow?'<b class="full"></b>':''}<span>no signal</span></div>
   ${follow?`<div class="mp-row three"><label class="mini"><span>Range · dB</span><input id="sdRange" type="number" min="6" max="60" step="1" value="${s.rangeDb??24}"></label><label class="mini"><span>Attack · ms</span><input id="sdAttack" type="number" min="1" max="2000" step="5" value="${s.attackMs??30}"></label><label class="mini"><span>Release · ms</span><input id="sdRelease" type="number" min="10" max="5000" step="10" value="${s.releaseMs??300}"></label></div>`
    :`<div class="mp-row"><label class="mini"><span>Hold · ms</span><input id="sdHold" type="number" min="10" max="2000" step="10" value="${s.holdMs??80}"></label><label class="mini"><span>Gap between hits · ms</span><input id="sdGap" type="number" min="20" max="2000" step="10" value="${s.gapMs??90}"></label></div>`}
   ${!follow&&late(m,s)>0?`<p class="warning sd-late">${icon('warning')}<span>This cue's first light comes ${late(m,s).toFixed(2)} s in, after the ${s.holdMs??80} ms hold, so a hit may show nothing. Use a short look cue for hits, or raise Hold.</span></p>`:''}
   <div class="sd-actions"><button class="chip-button" id="sdTest"><span data-icon="wave"></span>${follow?'Test swell':'Test hit'}</button><button class="ghost-button small" id="sdRemove" title="Remove the sound trigger from this master"><span data-icon="trash"></span>Remove</button></div>`:'<p class="hint">Pick the channel the instrument is on, for example the kick on Dante input 1.</p>'}`}`;
  fillIcons(el);cancel();
  const save=patch=>quiet(command('masters.assign',{slot,sound:{channel:s?.channel??1,band:s?.band??'kick',sensitivity:s?.sensitivity??.5,holdMs:s?.holdMs??80,gapMs:s?.gapMs??90,...(s?.mode?{mode:s.mode}:{}),...(s?.rangeDb?{rangeDb:s.rangeDb}:{}),...(s?.attackMs?{attackMs:s.attackMs}:{}),...(s?.releaseMs?{releaseMs:s.releaseMs}:{}),...patch}}).then(draw));
  if(el.querySelector('#sdOn'))el.querySelector('#sdOn').onchange=e=>save({enabled:e.target.checked});
  if(el.querySelector('#sdRemove'))el.querySelector('#sdRemove').onclick=()=>quiet(command('masters.assign',{slot,clearSound:true}).then(draw));
  if(s&&!on)return;
  el.querySelector('#sdDevice').onchange=e=>quiet(command('modules.set',{sound:{enabled:true,device:e.target.value}}).then(draw));
  el.querySelector('#sdChannel').onchange=e=>e.target.value?save({channel:+e.target.value}):quiet(command('masters.assign',{slot,clearSound:true}).then(draw));
  el.querySelectorAll('[data-band]').forEach(b=>b.onclick=()=>save({band:b.dataset.band}));if(!s)return;
  el.querySelectorAll('[data-sdmode]').forEach(b=>b.onclick=()=>save({mode:b.dataset.sdmode}));
  const sens=el.querySelector('#sdSens'),range=()=>+(el.querySelector('#sdRange')?.value||s.rangeDb||24),line=()=>{const floor=thresholdDb(+sens.value);el.querySelector('.sd-meter b').style.left=pct(floor)+'%';const full=el.querySelector('.sd-meter b.full');if(full)full.style.left=pct(floor+range())+'%'};
  line();sens.oninput=line;sens.onchange=()=>save({sensitivity:+sens.value});
  const num=(id,key,min,max,dflt)=>{const x=el.querySelector(id);if(x)x.onchange=e=>save({[key]:Math.max(min,Math.min(max,Math.round(+e.target.value||dflt)))})};
  num('#sdHold','holdMs',10,2000,80);num('#sdGap','gapMs',20,2000,90);num('#sdRange','rangeDb',6,60,24);num('#sdAttack','attackMs',1,2000,30);num('#sdRelease','releaseMs',10,5000,300);
  if(el.querySelector('#sdRange'))el.querySelector('#sdRange').oninput=line;
  el.querySelector('#sdTest').onclick=()=>quiet(command('sound.test',{slot}));
 };
 draw();quiet(command('sound.meter',{on:true}));
 // The meter reads the runtime stream ten times a second and re-arms metering before its 30 s timeout.
 let ticks=0;const timer=setInterval(()=>{
  const bar=el.querySelector('.sd-meter');if(++ticks%200===0)quiet(command('sound.meter',{on:true}));if(!bar)return;const r=getRuntime(),db=r?.sound?.meter?.[slot];
  bar.querySelector('i').style.width=(db===undefined?0:pct(db))+'%';bar.classList.toggle('hit',!!r?.masters?.held?.includes(slot));bar.querySelector('span').textContent=db===undefined?'no signal':`${Math.round(db)} dB`;
 },100);
 return ()=>{alive=false;clearInterval(timer);quiet(command('sound.meter',{on:false}))};
}
