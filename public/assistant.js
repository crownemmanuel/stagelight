// The built-in assistant chat (docs/ASSISTANT.md). Everything goes through engine commands (assistant.status,
// assistant.configure, assistant.send, assistant.stop, assistant.clear, assistant.models), the same ones agents use over
// MCP. The panel re-reads assistant.status whenever runtime.assistant.revision moves. Its open state is a per-viewer
// convenience in browser storage; the conversation lives in the engine.
const SUGGESTIONS=[
 'Build a slow blue and violet tide on the backlights and preview it',
 'Make a white strobe chase on the movers at 128 BPM and put it on master 1',
 'Create a warm worship base scene and make it active',
 'Make a page called Opening with an intro, a build and a big chorus cue',
];
const PROVIDER_NAMES={anthropic:'Anthropic (Claude)',openai:'OpenAI'};
const KEY_HELP={anthropic:'console.anthropic.com → API keys',openai:'platform.openai.com → API keys'};

// A small, safe Markdown subset: escape first, then bold, inline code, lists and paragraphs.
function markdown(text,esc){
 const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
 const out=[];let list=null;
 for(const line of String(text??'').split('\n')){
  const item=/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
  if(item){if(!list){list=[];out.push(list)}list.push(inline(item[1]));continue}
  list=null;if(line.trim())out.push(`<p>${inline(line)}</p>`);
 }
 return out.map(x=>Array.isArray(x)?`<ul>${x.map(i=>`<li>${i}</li>`).join('')}</ul>`:x).join('');
}

export function mountAssistant({command,esc,icon,fillIcons,toast,store}){
 const panel=document.getElementById('assistantPanel'),button=document.getElementById('assistantButton');
 let open=store.get('assistant.open','0')==='1',view='chat',st=null,seen=0,loading=false,draft='';
 const q=s=>panel.querySelector(s);
 const place=()=>{const w=document.querySelector('.workspace')?.getBoundingClientRect();if(!w)return;panel.style.top=(w.top+10)+'px';panel.style.bottom=Math.max(10,innerHeight-w.bottom+10)+'px'};
 addEventListener('resize',()=>{if(open)place()});
 // A background refresh never redraws the settings form under the operator's typing.
 const load=async(background=false)=>{if(loading)return;loading=true;try{st=await command('assistant.status');seen=st.revision;const typing=view==='settings'&&panel.contains(document.activeElement)&&document.activeElement.matches('input,textarea');if(!(background&&typing))draw()}catch{}finally{loading=false}};
 const setOpen=v=>{open=v;store.set('assistant.open',v?'1':'0');panel.hidden=!v;button.setAttribute('aria-pressed',String(v));if(v){place();load().then(()=>{if(view==='chat')q('#asInput')?.focus()})}};
 button.onclick=()=>setOpen(!open);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false)}});

 function header(){
  const p=st?.providers?.[st.provider];
  return `<header class="as-head"><span class="as-mark" data-icon="spark"></span><div class="as-title"><h2>Assistant</h2><small>${st?.configured?`${esc(PROVIDER_NAMES[st.provider])} · ${esc(st.model)}${st.effort!=='default'?' · '+esc(st.effort):''}`:'Not set up yet'}</small></div>
   <button class="round-button small" id="asNew" title="New chat" aria-label="New chat" data-icon="plus" ${st?.busy||!st?.messages?.length?'disabled':''}></button>
   <button class="round-button small ${view==='settings'?'active':''}" id="asSettings" title="Assistant settings" aria-label="Assistant settings" data-icon="settings"></button>
   <button class="round-button small" id="asClose" title="Close (Esc)" aria-label="Close assistant" data-icon="close"></button></header>`;
 }
 function messages(){
  const list=(st?.messages??[]).filter(m=>m.role!=='assistant'||m.text||m.tools?.length);
  if(!list.length)return `<div class="as-empty"><p>Ask for any look, effect, cue, scene, page or master. I build it with the same commands as the desk and MCP, and preview before anything goes live.</p><div class="as-suggest">${SUGGESTIONS.map(s=>`<button class="as-chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
  return list.map(m=>{
   if(m.role==='user')return `<div class="as-msg user">${markdown(m.text,esc)}</div>`;
   if(m.role==='error')return `<div class="as-msg error"><span data-icon="warning"></span><div>${esc(m.text)}</div></div>`;
   if(m.role==='note')return `<div class="as-msg note">${esc(m.text)}</div>`;
   const tools=m.tools?.length?`<div class="as-tools">${m.tools.map(t=>`<details class="as-tool ${t.ok===null?'run':t.ok?'ok':'bad'}"><summary><span data-icon="${t.ok===null?'clock':t.ok?'check':'close'}"></span><code>${esc(t.name)}</code></summary><pre>${esc(t.args)}</pre>${t.result?`<pre class="res">${esc(t.result)}</pre>`:''}</details>`).join('')}</div>`:'';
   return `<div class="as-msg bot">${tools}${markdown(m.text,esc)}</div>`;
  }).join('')+(st?.busy?`<div class="as-typing"><i></i><i></i><i></i><span>${st.messages.at(-1)?.tools?.some(t=>t.ok===null)?'Running commands…':'Thinking…'}</span></div>`:'');
 }
 function chat(){
  if(!st?.configured)return `<div class="as-body"><div class="as-empty"><p>Add an Anthropic or OpenAI API key to start. The assistant builds effects, cues, scenes, pages and masters for you through the desk's own commands.</p><button class="primary" id="asSetup"><span data-icon="key"></span>Set up the assistant</button></div></div>`;
  return `<div class="as-body" id="asLog" aria-live="polite">${messages()}</div>
   <form class="as-compose" id="asForm"><textarea id="asInput" rows="2" placeholder="Describe a look, effect or cue…" aria-label="Message the assistant">${esc(draft)}</textarea>
   ${st.busy?`<button type="button" class="round-button as-send stop" id="asStop" title="Stop" aria-label="Stop the reply" data-icon="stop"></button>`:`<button type="submit" class="round-button as-send" title="Send (Enter)" aria-label="Send" data-icon="send"></button>`}</form>
   <p class="as-foot">${st.allowLive?'Can change the live rig while output is armed.':'Builds and previews; never arms output. Live commands are refused while armed.'}</p>`;
 }
 function settings(){
  const p=st.providers[st.provider],options=[...new Set([p.model,...(p.models??p.suggested)])];
  return `<div class="as-body as-settings">
   <section><h3>Provider</h3><div class="segmented">${Object.keys(st.providers).map(k=>`<button data-provider="${k}" class="${k===st.provider?'active':''}">${esc(PROVIDER_NAMES[k])}${st.providers[k].configured?' ✓':''}</button>`).join('')}</div>
    <p class="hint">Switching provider starts a new conversation.</p></section>
   <section><h3>API key</h3><div class="as-row"><input id="asKey" type="password" autocomplete="off" spellcheck="false" placeholder="${p.configured?'Saved ('+esc(p.keyHint)+'). Paste a new key to replace it':'Paste your '+esc(PROVIDER_NAMES[st.provider])+' API key'}"><button class="chip-button accent" id="asSaveKey">Save</button></div>
    <div class="as-row"><button class="chip-button" id="asCheck" ${p.configured?'':'disabled'}><span data-icon="check"></span>Check key</button>${p.configured?`<button class="chip-button" id="asRemoveKey"><span data-icon="trash"></span>Remove key</button>`:''}<span class="as-check" id="asCheckResult"></span></div>
    <p class="hint">Get one at ${esc(KEY_HELP[st.provider])}. The key stays on this Mac in the data folder (an owner-only file). It is never saved in the show, its versions or exports, and only the last 4 characters are ever shown. Requests go straight from this Mac to ${esc(PROVIDER_NAMES[st.provider])} and are billed to that key.</p></section>
   <section><h3>Model</h3><div class="as-row"><select id="asModel" ${p.configured?'':'disabled'}>${options.map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${esc(m)}</option>`).join('')}</select><button class="round-button small" id="asRefresh" title="Reload models from ${esc(PROVIDER_NAMES[st.provider])}" aria-label="Reload models" data-icon="restore" ${p.configured?'':'disabled'}></button></div>
    <p class="hint" id="asModelHint">${!p.configured?'Add a key to load the models it can use.':p.models?`${p.models.length} models from ${esc(PROVIDER_NAMES[st.provider])}.`:'Loading models from '+esc(PROVIDER_NAMES[st.provider])+'…'}</p></section>
   <section><h3>Reasoning level</h3><div class="segmented as-effort">${p.efforts.map(e=>`<button data-effort="${e}" class="${e===p.effort?'active':''}">${e==='default'?'Auto':e==='xhigh'?'Extra high':e[0].toUpperCase()+e.slice(1)}</button>`).join('')}</div>
    <p class="hint">Higher levels think longer before building: better for big multi-cue requests, but slower and more expensive. Auto lets the model decide.</p></section>
   <section><label class="as-toggle"><span><h3>Let the assistant run the live rig</h3><small class="hint">While output is armed, allow it to play cues, change masters, scenes and fixture values. It can never arm output.</small></span><span class="switch"><input type="checkbox" id="asLive" ${st.allowLive?'checked':''}><span></span></span></label></section>
   <section><h3>House rules for this show</h3><textarea id="asNotes" rows="4" maxlength="4000" placeholder="e.g. Face lights never above 12%. Keep the house lights off in cues.">${esc(st.instructions)}</textarea><div class="as-row"><button class="chip-button" id="asSaveNotes">Save rules</button></div>
    <p class="hint">Saved in the show and followed in every cue, scene and effect the assistant builds.</p></section>
   <button class="ghost-button" id="asBack"><span data-icon="left"></span>Back to the chat</button></div>`;
 }
 function draw(){
  if(!open||!st)return;
  const keepInput=document.activeElement?.id==='asInput';
  const log=q('#asLog'),stick=!log||log.scrollHeight-log.scrollTop-log.clientHeight<60;
  panel.innerHTML=header()+(view==='settings'?settings():chat());fillIcons(panel);wire();
  const nl=q('#asLog');if(nl&&stick)nl.scrollTop=nl.scrollHeight;
  if(keepInput){const t=q('#asInput');t?.focus();t?.setSelectionRange(t.value.length,t.value.length)}
 }
 const configure=async(args,msg)=>{try{st=await command('assistant.configure',args);seen=st.revision;if(msg)toast(msg);draw()}catch{}};
 // Fills the model dropdown from the provider (once per provider, or on demand); it also proves the key works.
 let fetching=null;
 async function loadModels(force){
  if(fetching===st.provider&&!force)return;fetching=st.provider;const out=q('#asCheckResult');if(out){out.textContent='Checking…';out.className='as-check'}
  try{const r=await command('assistant.models');st=await command('assistant.status');seen=st.revision;draw();const o=q('#asCheckResult');if(o){o.textContent=`Key works · ${r.models.length} models`;o.className='as-check ok'}}
  catch(e){const o=q('#asCheckResult'),h=q('#asModelHint');if(o){o.textContent=e.message;o.className='as-check bad'}if(h)h.textContent='Could not load models: check the key.'}
 }
 async function send(text){
  text=text.trim();if(!text||st?.busy)return;draft='';
  try{await command('assistant.send',{message:text});await load()}catch{draft=text;draw()}
 }
 function wire(){
  q('#asClose').onclick=()=>setOpen(false);
  q('#asSettings').onclick=()=>{view=view==='settings'?'chat':'settings';draw()};
  q('#asNew').onclick=async()=>{try{await command('assistant.clear');await load()}catch{}};
  const setup=q('#asSetup');if(setup)setup.onclick=()=>{view='settings';draw();q('#asKey')?.focus()};
  for(const b of panel.querySelectorAll('[data-suggest]'))b.onclick=()=>send(b.dataset.suggest);
  const input=q('#asInput');
  if(input){input.oninput=()=>{draft=input.value};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(input.value)}}}
  const form=q('#asForm');if(form)form.onsubmit=e=>{e.preventDefault();send(input.value)};
  const stop=q('#asStop');if(stop)stop.onclick=()=>command('assistant.stop').catch(()=>{});
  if(view!=='settings')return;
  for(const b of panel.querySelectorAll('[data-provider]'))b.onclick=()=>{if(b.dataset.provider!==st.provider){fetching=null;configure({provider:b.dataset.provider})}};
  q('#asSaveKey').onclick=()=>{const v=q('#asKey').value.trim();if(v.length<8)return toast('Paste the whole API key');fetching=null;configure({apiKey:v},'API key saved on this Mac')};
  const remove=q('#asRemoveKey');if(remove)remove.onclick=()=>configure({clearKey:true},'API key removed');
  q('#asCheck').onclick=()=>loadModels(true);
  q('#asModel').onchange=e=>configure({model:e.target.value},'Model set to '+e.target.value);
  q('#asRefresh').onclick=()=>loadModels(true);
  for(const b of panel.querySelectorAll('[data-effort]'))b.onclick=()=>configure({effort:b.dataset.effort},'Reasoning level: '+b.textContent);
  if(st.providers[st.provider].configured&&!st.providers[st.provider].models)loadModels();
  q('#asLive').onchange=e=>configure({allowLive:e.target.checked});
  q('#asSaveNotes').onclick=()=>configure({instructions:q('#asNotes').value},'House rules saved in the show');
  q('#asBack').onclick=()=>{view='chat';draw()};
 }
 if(open)setOpen(true);
 return {
  paint(r){const a=r?.assistant;if(!a)return;button.classList.toggle('busy',a.busy);if(open&&a.revision!==seen)load(true)},
 };
}
