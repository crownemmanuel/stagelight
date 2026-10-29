import {outputRGB,COLOR_WHEELS,fixtureWheel,bandSwatch} from './fixture-colors.js';
import {wheelEntries,sharedWheelColors} from './wheel-selection.js';
import {aimAngles} from './aim.js?v=ui-2';
import {Stage} from './stage.js?v=ui-2';
import {mountJoystick} from './joystick.js';
import {createLiveControl} from './live-controls.js';
import {uid} from './ids.js';
import {visibleFixtures,hiddenFixtureIds} from './visibility.js';
import {icon,ICONS} from './icons.js?v=ui-2';
import {goboIcon,goboName,GOBOS} from './gobos.js?v=ui-2';
import {keyOf,keyLabel,reservedReason} from './keys.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k,d){try{return localStorage.getItem('lights.'+k)??d}catch{return d}},set(k,v){try{localStorage.setItem('lights.'+k,v)}catch{}}};
const MOVERS=['rogue','mh7','beam200','beam7r'],WHEEL=['beam200','beam7r'];
const PAGE_COLORS=['#8bc9d0','#eac28a','#c99ae8','#7fc79a','#ee8f8f','#7da6f0','#f0b46b','#d8d8d8'];
// UI state. Engine state (show, runtime) is read back; nothing here is authoritative.
let show,runtime,schema,token,stage,toastTimer,rev=0;
let mode=store.get('mode','show'),pageId=store.get('page',null),standby=null,selected=[],group=null;
let railTab=store.get('railTab','pages'),pane=store.get('bottomPane',store.get('fixtureChips','shown')==='hidden'?'none':'fixtures'),sceneKey='';
let fxMode=store.get('fxMode','preview'),ovTab='props',stageView=store.get('stageView','stage'),viewSource='live',selectionRevision=0,side='cues',progTab='look',editingEntry=null,ledOpen=false,positionMode='joystick',joystickSpeed=.1,destroyJoystick=null,aligning=null,liveKey='';
const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const hexOf=c=>'#'+c.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
function fillIcons(root=document){for(const el of root.querySelectorAll('[data-icon]'))if(!el.firstElementChild||el.firstElementChild.tagName!=='svg')el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon))}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000)}
function setText(el,value){if(el&&el.textContent!==value)el.textContent=value}
async function command(name,args={}){try{const r=await fetch('/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command:name,args})});const v=await r.json();if(!r.ok)throw Error(v.error);if(v.runtime){if(v.runtime.revision!==rev)await refresh();else paint(v.runtime)}return v}catch(e){toast(e.message);throw e}}
const quiet=p=>p.catch(()=>{});
async function refresh(){const v=await fetch('/api/state').then(r=>r.json());show=v.show;runtime=v.runtime;rev=runtime.revision;if(!show.pages.some(p=>p.id===pageId))pageId=runtime.stack?.page??show.pages[0]?.id??null;selected=selected.filter(id=>show.fixtures.some(f=>f.id===id));if(stage){stage.setFixtures(visibleFixtures(show));syncLedWall()}drawAll();paint(runtime)}
function drawAll(){drawPages();drawGroups();drawChips();drawMasters();applyPane();if(mode==='library'){if(libCue&&!show.cues.some(c=>c.id===libCue))libCue=null;$('#libraryView').innerHTML='';applyStageView()}drawSide();drawSelectionBar();drawLedTray();setText($('#showName'),show.name.split('·')[0].trim())}
// Fixture lookup indexed per show object: paint() asks for hundreds of fixtures ten times a second.
let fixtureIndex=null,fixtureIndexFor=null;const fixture=id=>{if(fixtureIndexFor!==show?.fixtures){fixtureIndexFor=show?.fixtures;fixtureIndex=new Map((show?.fixtures??[]).map(f=>[f.id,f]))}return fixtureIndex.get(id)};
// Styles cost layout and paint even when unchanged, so each live dot remembers what it last showed.
const paintDot=(el,dot,shown,intensity,glow,overridden)=>{const sig=shown+'|'+intensity.toFixed(3)+'|'+(overridden?1:0);if(el.dataset.sig===sig)return;el.dataset.sig=sig;dot.style.background=shown;dot.style.opacity=.25+.75*intensity;dot.style.boxShadow=intensity>.1?`0 0 ${glow}px ${shown}80`:'none';if(overridden!==undefined)el.classList.toggle('overridden',overridden)};
const page=()=>show.pages.find(p=>p.id===pageId);
const cueOf=entry=>show.cues.find(c=>c.id===entry?.cue);
const entryName=e=>e?.label??cueOf(e)?.name??e?.cue??'—';
const mediaList=()=>[...(schema?.media??[]),...(show?.media??[])];
const progFrames=r=>r.blind?.enabled&&r.previewFrames?r.previewFrames:r.frames,progOverrides=r=>r.blind?.enabled?r.blind.overrides:r.overrides;
function current(){return progFrames(runtime).find(f=>f.id===selected[0])??{color:[1,1,1],intensity:0,pan:.5,tilt:.5,zoom:.5,focus:.5,frost:0,gobo:0,prism:0}}
function ensureStageView(){if(stage?.mode==='reference'){stage.setView('front');$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='front'))}}

// ── Mode ──
function setMode(m){if(m==='library'&&mode!=='library')libPeek=false;mode=m;store.set('mode',m);document.body.dataset.mode=m;$$('.mode-switch [data-mode]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mode===m)));if(m==='show'&&side==='program')side=selected.length?'override':'cues';if(m==='build'&&side==='override')side='program';cancelAlignment();drawAll();applyStageView();paint(runtime)}

// ── Pages rail ──
function drawPages(){
 drawRailTabs();if(railTab==='scenes')return drawScenes();
 $('#pageList').innerHTML=show.pages.map(p=>`<button class="page-tile ${p.id===pageId?'selected':''}" data-page="${esc(p.id)}" style="--page:${esc(p.color??'#8bc9d0')}"><i></i><span><strong>${esc(p.name)}</strong><small>${p.cues.length} cue${p.cues.length===1?'':'s'}</small></span><b class="live-dot" title="Running"></b></button>`).join('')||`<p class="empty">No pages yet.${mode==='build'?'':' Switch to Build to create one.'}</p>`;
 $$('[data-page]').forEach(b=>b.onclick=()=>{pageId=b.dataset.page;store.set('page',pageId);standby=null;editingEntry=null;if(mode==='build')side='cues';else if(side!=='override')side='cues';drawPages();drawSide();paint(runtime)});
}

function drawRailTabs(){$$('[data-rail]').forEach(b=>{const on=b.dataset.rail===railTab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});$('#newPage').style.display=railTab==='pages'?'':'none'}
// Scenes (docs/MASTERS-AND-SCENES.md): a saved look that stays on underneath every cue (scene.go / scene.release, the
// same commands agents use). Stopping or releasing the last cue fades back to it. Right-click a scene to edit it.
function drawScenes(){
 const active=runtime?.scene?.id??'';sceneKey=active;
 $('#pageList').innerHTML=show.scenes.map(sc=>`<div class="page-tile scene-tile ${sc.id===active?'selected running':''}" role="button" tabindex="0" data-scene="${esc(sc.id)}" style="--page:${esc(sc.color??'#eac28a')}" title="${sc.id===active?'Active: on underneath every cue · right-click to edit':'Click to make this the scene underneath every cue · right-click to edit'}"><i></i><span><strong>${esc(sc.name)}</strong><small>${sc.id===active?'Active scene':sc.look.length+' fixtures'}</small></span>${sc.id===active?`<button class="round-button small" data-scene-release title="Release the scene" aria-label="Release ${esc(sc.name)}" data-icon="close"></button>`:''}</div>`).join('')
  +`<button class="add-button scene-add" id="sceneCapture"><span data-icon="record"></span>Save look as scene</button>`+(show.scenes.length?'':'<p class="empty">A scene is a look that stays on underneath every cue. Stop the cues and the rig fades back to it instead of going dark.</p>');
 fillIcons($('#pageList'));
 $$('[data-scene]').forEach(t=>{const id=t.dataset.scene;t.onclick=e=>{if(!e.target.closest('[data-scene-release]')&&runtime.scene?.id!==id)quiet(command('scene.go',{id}))};t.onkeydown=e=>{if(e.key==='Enter')t.click()};t.oncontextmenu=e=>{e.preventDefault();openSceneMenu(id,e.clientX,e.clientY)}});
 $$('[data-scene-release]').forEach(b=>b.onclick=()=>quiet(command('scene.release',{})));
 $('#sceneCapture').onclick=()=>sceneDialog(null);
}
function sceneDialog(sc){
 let color=sc?.color??PAGE_COLORS[(show.scenes.length+1)%PAGE_COLORS.length];
 dialog(sc?'Edit scene':'Save look as scene',`${sc?'':`<p class="hint">${runtime.blind?.enabled?'Saves the <strong>blind</strong> look (not what is live)':'Saves every patched fixture as it looks right now'}: colours, beams and positions. Click it in Scenes to make it active; it then stays on underneath every cue.</p>`}<label class="mini"><span>Name</span><input id="sceneName" type="text" maxlength="100" value="${esc(sc?.name??'')}" placeholder="e.g. Warm base"></label><div class="page-colors">${PAGE_COLORS.map(c=>`<button class="dot ${c===color?'active':''}" data-scene-color="${c}" style="background:${c}" aria-label="Scene colour"></button>`).join('')}</div><div class="dialog-actions"><button id="sceneSave" class="primary"><span data-icon="${sc?'save':'record'}"></span>${sc?'Save':'Save scene'}</button></div>`);
 $('#sceneName').focus();$$('[data-scene-color]').forEach(b=>b.onclick=()=>{color=b.dataset.sceneColor;$$('[data-scene-color]').forEach(x=>x.classList.toggle('active',x===b))});
 $('#sceneSave').onclick=async()=>{const name=$('#sceneName').value.trim();if(!name)return toast('Name the scene first.');try{if(sc)await command('scene.save',{scene:{...structuredClone(sc),name,color}});else{await command('scene.capture',{id:uid('scene'),name,color});railTab='scenes';store.set('railTab',railTab);drawPages()}$('#dialog').close();toast(sc?'Scene saved.':`Scene “${name}” saved. Click it to put it underneath every cue.`)}catch{}};
}
function openSceneMenu(id,x,y){
 const sc=show.scenes.find(s=>s.id===id),active=runtime.scene?.id===id,item=(act,ic,label,danger=false)=>`<button role="menuitem" data-ctx="${act}" class="${danger?'danger':''}"><span data-icon="${ic}"></span>${label}</button>`;
 $('#ctxMenu').innerHTML=`<div class="ctx-title">${esc(sc.name)}</div>`+(active?item('release','close','Release scene'):item('go','scene','Make it the active scene'))+item('update','record','Update from the current look')+item('edit','edit','Rename or recolour…')+'<hr>'+item('delete','trash','Delete scene',true);
 showCtxMenu(x,y);
 const run={go:()=>quiet(command('scene.go',{id})),release:()=>quiet(command('scene.release',{})),update:()=>quiet(command('scene.capture',{id,name:sc.name}).then(()=>toast(`“${sc.name}” updated from the current look.`))),edit:()=>sceneDialog(sc),
  delete:()=>confirmDialog(`Delete “${sc.name}”?`,active?'It is the active scene, so the rig fades out of it first. Cues are unchanged.':'The scene is removed. Cues are unchanged.','Delete scene',()=>command('scene.delete',{id}))};
 $$('[data-ctx]').forEach(b=>b.onclick=()=>{closeMenu();run[b.dataset.ctx]()});
}

// ── Groups & selection ──
const GROUP_ORDER=['movers','backlights','rogues','mh7s','audience','grid','rear-heads'];
function sortedGroups(){return [...show.groups].sort((a,b)=>{const ia=GROUP_ORDER.indexOf(a.id),ib=GROUP_ORDER.indexOf(b.id);return (ia<0?99:ia)-(ib<0?99:ib)})}
function idsForGroup(id=group){return id==='all'?show.fixtures.filter(f=>f.enabled).map(f=>f.id):show.groups.find(g=>g.id===id)?.fixtures??[]}
// Show mode can swap the 3D stage for big group tiles; the visualizer is fully paused while hidden. Library mode puts
// the cue library in the stage's place until a cue is previewed (libPeek), which shows the stage again.
function applyStageView(){
 const lib=mode==='library'&&!libPeek;document.body.classList.toggle('lib-view',lib);$('#libraryView').hidden=!lib;$('#libBack').hidden=!(mode==='library'&&libPeek);if(lib)drawLibraryView();
 const grid=!lib&&(stageView==='groups'||visOut());document.body.classList.toggle('vis-out',visOut());
 const pop=$('#popoutButton');if(pop){pop.classList.toggle('active',visOut());pop.title=visOut()?'Bring the visualizer back into this window':'Pop out the visualizer into its own window (drag it to another screen)';pop.innerHTML=icon(visOut()?'dock':'popout')}document.body.classList.toggle('grid-view',grid);$('#groupGrid').hidden=!grid;
 $$('[data-stage-view]').forEach(b=>b.classList.toggle('active',b.dataset.stageView===(grid?'groups':'stage')));stage?.setPaused(grid||lib);if(grid)drawGroupGrid();
}
// ── Visualizer pop-out: a second window (another screen) runs its own 3D stage from the same engine stream ──
let visWin=null,visSource='';
function visOut(){try{return !!visWin&&!visWin.closed}catch{return false}}
function popOutVisualizer(){
 if(visOut()){try{visWin.close()}catch{}return dockVisualizer()}
 visWin=window.open('/visualizer.html','stagelight-visualizer','popup,width=1280,height=760');
 if(!visWin)return toast('The visualizer window was blocked. Allow pop-ups for this page.');
 visSource='';applyStageView();toast('Visualizer popped out. Drag its window to the other screen.');
}
function dockVisualizer(){visWin=null;visSource='';applyStageView()}
// Tell the pop-out which frames this window is looking at (live, or preview/blind) whenever that changes.
function syncPopout(){if(!visOut()||visSource===viewSource)return;visSource=viewSource;try{visWin.postMessage({type:'view-source',source:viewSource},location.origin)}catch{}}
window.addEventListener('message',e=>{
 if(e.origin!==location.origin)return;const type=e.data?.type;
 if(type==='visualizer-hello'){if(e.source!==visWin){visWin=e.source;applyStageView()}visSource=''}
 else if(type==='visualizer-closed'&&e.source===visWin)dockVisualizer();
});
setInterval(()=>{if(visWin&&!visOut())dockVisualizer()},1000);
function drawGroupGrid(){
 if(!show||$('#groupGrid').hidden)return;const tiles=[{id:'all',name:'Every patched fixture',fixtures:show.fixtures.filter(f=>f.enabled).map(f=>f.id)},...sortedGroups()];
 $('#groupGrid').innerHTML=`<div class="tile-grid">${tiles.map(g=>`<button class="group-tile ${g.id===group?'active':''}" data-tile="${esc(g.id)}" title="Click to select · Shift-click to add"><div class="tile-head"><strong>${esc(g.id==='all'?'All':shortGroup(g))}</strong><span>${g.fixtures.length}</span></div><small>${esc(g.name)}</small><div class="tile-dots">${g.fixtures.slice(0,32).map(id=>`<i data-tile-dot="${esc(id)}"></i>`).join('')}${g.fixtures.length>32?`<em>+${g.fixtures.length-32}</em>`:''}</div><div class="tile-foot"><div class="tile-level"><i data-tile-level="${esc(g.id)}"></i></div><b data-tile-pct="${esc(g.id)}">0%</b></div></button>`).join('')}<button class="group-tile new-tile" id="newGroupTile"><span>${icon('plus')}</span><strong>New group</strong><small>${selected.length?`From the ${selected.length} selected, or pick fixtures`:'Pick fixtures'}</small></button></div>`;
 $('#newGroupTile').onclick=()=>groupEditor(null);$$('[data-tile]').forEach(b=>bindGroupMenu(b,b.dataset.tile));
 $$('[data-tile]').forEach(b=>b.onclick=e=>{if(b.dataset.longPress){delete b.dataset.longPress;return}const id=b.dataset.tile;if(!e.shiftKey)return selectGroup(id);const ids=[...new Set([...selected,...idsForGroup(id)])];applySelection(ids);quiet(command('selection.set',{ids}))});
 liveKey='';paint(runtime);
}
function paintGroupGrid(frames){
 const byId=new Map(frames.map(f=>[f.id,f]));
 for(const el of $$('[data-tile-dot]')){const f=byId.get(el.dataset.tileDot);if(!f)continue;const fx=fixture(f.id),shown=hexOf(outputRGB(fx?.profile,f.color,f.white,fx,f)),sig=shown+'|'+f.intensity.toFixed(3);if(el.dataset.sig===sig)continue;el.dataset.sig=sig;el.style.background=f.intensity>.01?shown:'';el.style.opacity=.35+.65*f.intensity;el.style.boxShadow=f.intensity>.1?`0 0 8px ${shown}90`:'none'}
 for(const el of $$('[data-tile-level]')){const id=el.dataset.tileLevel,ids=idsForGroup(id).filter(x=>fixture(x)?.enabled),avg=ids.length?ids.reduce((n,x)=>n+(byId.get(x)?.intensity??0),0)/ids.length:0,pct=Math.round(avg*100)+'%';if(el.dataset.pct===pct)continue;el.dataset.pct=pct;el.style.width=pct;setText($(`[data-tile-pct="${CSS.escape(id)}"]`),pct)}
}
function drawGroups(){
 const groups=sortedGroups(),pills=groups.map(g=>`<button class="pill ${g.id===group?'active':''}" data-group="${esc(g.id)}" title="${esc(g.name)}">${esc(shortGroup(g))}<span>${g.fixtures.length}</span></button>`).join('');
 $('#groupPills').innerHTML=`<button class="pill ${group==='all'?'active':''}" data-group="all"><span class="pill-icon" data-icon="group"></span>All</button>${pills}<button class="pill ghost build-only" id="groupsManage" title="New group" data-icon="plus"></button>`;
 fillIcons($('#groupPills'));drawGroupGrid();$$('[data-group]').forEach(b=>{b.onclick=()=>{if(b.dataset.longPress){delete b.dataset.longPress;return}selectGroup(b.dataset.group)};bindGroupMenu(b,b.dataset.group)});$('#groupsManage').onclick=()=>groupEditor(null);
}
const shortGroup=g=>({movers:'Movers',rogues:'Beams',mh7s:'MH7s',backlights:'Backlights',audience:'Audience',grid:'Grid','rear-heads':'Rear heads'}[g.id]??g.name.split('·')[0].trim());
// Selection lives in the engine so agents (selection.set/group) and the UI stay in step.
function applySelection(ids,context){cancelAlignment();group=context??null;const next=ids.filter(id=>fixture(id)),changed=next.length!==selected.length||next.some(id=>!selected.includes(id));selected=next;afterSelection(changed)}
function selectGroup(id){applySelection(idsForGroup(id),id);quiet(command('selection.group',{group:id}))}
function selectFixture(id,event={}){
 cancelAlignment();if(!fixture(id)){if(id==null&&!event.shiftKey&&(selected.length||group)){applySelection([]);quiet(command('selection.set',{ids:[]}))}return}
 const ids=event.shiftKey?(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]):[id],context=group&&idsForGroup().includes(id)?group:undefined;
 applySelection(ids,context);quiet(command('selection.set',{ids,...(context?{group:context}:{})}));
}
// A new selection opens its settings in the right panel (Show and Build); clearing it returns to the cue list.
// Engine echoes of an unchanged selection leave the panel alone, so “back to cues” sticks.
function afterSelection(changed=true){
 if(selected.length){if(changed)side=mode==='show'?'override':'program'}else if(side!=='cues')side='cues';
 stage?.select(selected);drawGroups();drawChips();drawSelectionBar();drawSide();
}
// The fixture buttons under the stage list the chosen group (plus any extra picks); with no group they list only what
// is selected, and with nothing selected the strip closes.
function drawChips(){
 const ids=group?[...new Set([...idsForGroup(),...selected])]:selected;$('.fixture-strip').classList.toggle('empty',!ids.length);
 $('#fixtureChips').innerHTML=ids.map(id=>`<button class="fixture-chip ${selected.includes(id)?'active':''}" data-fixture="${esc(id)}" aria-pressed="${selected.includes(id)}" title="${esc(fixture(id)?.name)}"><i></i>${esc(id)}</button>`).join('');
 $$('[data-fixture]').forEach(b=>b.onclick=e=>selectFixture(b.dataset.fixture,e));
}
function selectionTitle(){if(!selected.length)return 'Nothing selected';if(selected.length===1){const f=fixture(selected[0]);return f?(f.colorSlots?.length?f.name.replace(' · color slots pending',''):f.name):selected[0]}const g=show.groups.find(g=>g.id===group);return g&&g.fixtures.length===selected.length?g.name:`${selected.length} fixtures`}
function drawSelectionBar(){
 const bar=$('#selectionBar');bar.hidden=!selected.length;if(!selected.length)return;
 const action=mode==='show'&&side!=='override'?`<button id="selOverride" class="chip-button accent"><span data-icon="sliders"></span>Override</button>`:'';
 bar.innerHTML=`<span class="sel-count">${selected.length}</span><span class="sel-name">${esc(selectionTitle())}</span>${action}<button id="selClear" class="round-button small" aria-label="Clear selection" data-icon="close"></button>`;fillIcons(bar);
 if($('#selOverride'))$('#selOverride').onclick=()=>{side='override';drawSide()};
 $('#selClear').onclick=()=>{applySelection([]);quiet(command('selection.set',{ids:[]}))};
}
// Groups: right-click (or long-press) any group tile or pill for edits; the editor creates and edits members.
// Everything goes through group.save / group.edit / group.delete, the same commands agents use.
function openGroupMenu(id,x,y){
 const g=show.groups.find(g=>g.id===id),sel=selected.length,item=(act,ic,label,dis=false,danger=false)=>`<button role="menuitem" data-ctx="${act}" ${dis?'disabled':''} class="${danger?'danger':''}"><span data-icon="${ic}"></span>${label}</button>`;
 const inGroup=g?selected.filter(x=>g.fixtures.includes(x)).length:0;
 $('#ctxMenu').innerHTML=`<div class="ctx-title">${esc(g?g.name:'All fixtures')}</div>`+item('select','target','Select')+item('add-select','plus','Add to selection')+'<hr>'+
  (g?item('add','plus',`Add ${sel} selected to group`,!sel||inGroup===sel)+item('remove','close',`Remove ${inGroup} selected from group`,!inGroup||inGroup===g.fixtures.length)+item('replace','group',`Set group to the ${sel} selected`,!sel)+'<hr>'+item('rename','edit','Rename…')+item('edit','sliders','Edit fixtures…')+'<hr>'+item('delete','trash','Delete group',false,true)
   :item('new','plus',`New group from ${sel} selected`,!sel));
 showCtxMenu(x,y);
 const run={select:()=>selectGroup(id),'add-select':()=>{const ids=[...new Set([...selected,...idsForGroup(id)])];applySelection(ids);quiet(command('selection.set',{ids}))},
  add:()=>quiet(command('group.edit',{id,add:selected}).then(()=>toast(`Added to ${g.name}.`))),remove:()=>quiet(command('group.edit',{id,remove:selected.filter(x=>g.fixtures.includes(x))})),
  replace:()=>quiet(command('group.save',{id,name:g.name,fixtures:selected})),rename:()=>renameGroup(g),edit:()=>groupEditor(id),new:()=>groupEditor(null),
  delete:()=>confirmDialog(`Delete “${g.name}”?`,'The group is removed. Fixtures, cues and positions are unchanged. A group used by a cue or saved effect cannot be deleted.','Delete group',async()=>{await command('group.delete',{id});if(group===id)group=null;drawGroups()})};
 $$('[data-ctx]').forEach(b=>b.onclick=()=>{closeMenu();run[b.dataset.ctx]()});
}
function showCtxMenu(x,y){const m=$('#ctxMenu');m.hidden=false;fillIcons(m);const r=m.getBoundingClientRect();m.style.left=Math.min(x,innerWidth-r.width-8)+'px';m.style.top=Math.min(y,innerHeight-r.height-8)+'px'}
function closeMenu(){$('#ctxMenu').hidden=true}
function bindGroupMenu(el,id){
 el.oncontextmenu=e=>{e.preventDefault();openGroupMenu(id,e.clientX,e.clientY)};
 let timer;el.onpointerdown=e=>{if(e.pointerType!=='touch')return;timer=setTimeout(()=>{el.dataset.longPress='1';openGroupMenu(id,e.clientX,e.clientY)},550)};el.onpointerup=el.onpointerleave=()=>clearTimeout(timer);
}
function renameGroup(g){
 dialog('Rename group',`<div class="inline-form"><input id="groupRename" type="text" maxlength="100" value="${esc(g.name)}" aria-label="Group name"><button id="groupRenameSave" class="primary">Save</button></div>`);
 $('#groupRename').select();const save=async()=>{const name=$('#groupRename').value.trim();if(!name)return toast('Name the group first.');await command('group.edit',{id:g.id,name});$('#dialog').close()};$('#groupRenameSave').onclick=save;$('#groupRename').onkeydown=e=>{if(e.key==='Enter')save()};
}
const FAMILY={colorado:'Backlights · COLORado',pendant4:'House lights · RGBW pendant',reveE3:'Face lights · Rêve E-3',q120:'Ceiling grid · Q120',rogue:'Rogue R3 beams',mh7:'MH7 Hybrid',beam7r:'7R Beam',beam200:'200W Beam',unknown:'Unverified'};
function groupEditor(id){
 const g=id?show.groups.find(g=>g.id===id):null;let members=g?[...g.fixtures]:[...selected];
 const fams=Object.entries(FAMILY).map(([p,label])=>[label,show.fixtures.filter(f=>f.profile===p)]).filter(([,list])=>list.length);
 dialog(g?'Edit group':'New group',`<label class="mini"><span>Name</span><input id="groupEditName" type="text" maxlength="100" value="${esc(g?.name??'')}" placeholder="e.g. Downstage movers"></label><div class="editor-tools"><span id="groupEditCount" class="hint"></span><button class="ghost-button small" id="groupUseSel" ${selected.length?'':'disabled'}>${icon('target')}Use selection (${selected.length})</button><button class="ghost-button small" id="groupNone">${icon('close')}None</button></div><div class="family-list">${fams.map(([label,list])=>`<div class="family"><div class="family-head"><strong>${esc(label)}</strong><button class="text-button" data-family-all="${esc(label)}">All</button></div><div class="family-chips">${list.map(f=>`<button class="fixture-chip" data-member="${esc(f.id)}" title="${esc(f.name)}"><i></i>${esc(f.id)}</button>`).join('')}</div></div>`).join('')}</div><p class="hint">Order matters for chases and waves: fixtures play in the order you add them.</p><div class="dialog-actions">${g?`<button class="ghost-button danger-text" id="groupEditDelete">${icon('trash')}Delete</button>`:''}<button class="primary" id="groupEditSave">${icon('save')}${g?'Save group':'Create group'}</button></div>`);
 const sync=()=>{$$('[data-member]').forEach(b=>{const on=members.includes(b.dataset.member);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});setText($('#groupEditCount'),`${members.length} fixture${members.length===1?'':'s'} in group`)};sync();
 $$('[data-member]').forEach(b=>b.onclick=()=>{const m=b.dataset.member;members=members.includes(m)?members.filter(x=>x!==m):[...members,m];sync()});
 $$('[data-family-all]').forEach(b=>b.onclick=()=>{const ids=fams.find(([l])=>l===b.dataset.familyAll)[1].map(f=>f.id),all=ids.every(x=>members.includes(x));members=all?members.filter(x=>!ids.includes(x)):[...members,...ids.filter(x=>!members.includes(x))];sync()});
 $('#groupUseSel').onclick=()=>{members=[...selected];sync()};$('#groupNone').onclick=()=>{members=[];sync()};
 if($('#groupEditDelete'))$('#groupEditDelete').onclick=()=>{$('#dialog').close();openGroupMenu(id,innerWidth/2,innerHeight/2);$('[data-ctx="delete"]').click()};
 $('#groupEditSave').onclick=async()=>{const name=$('#groupEditName').value.trim();if(!name)return toast('Name the group first.');if(!members.length)return toast('Add at least one fixture.');const gid=g?.id??uid('group');await command('group.save',{id:gid,name,fixtures:members});$('#dialog').close();toast(g?'Group saved.':'Group created — it’s in the pills and Groups view.');if(!g)selectGroup(gid)};
 if(!g)$('#groupEditName').focus();
}

// ── Side panel ──
function drawSide(){
 destroyJoystick?.();destroyJoystick=null;const el=$('#sidePanel');
 if(mode==='show'&&side==='override'&&selected.length)el.innerHTML=overridePanel();
 else if(mode==='build'){if(side==='override')side='program';el.innerHTML=`<div class="side-tabs"><button data-side="cues" class="${side!=='program'?'active':''}"><span data-icon="list"></span>Cue list</button><button data-side="program" class="${side==='program'?'active':''}"><span data-icon="sliders"></span>Programmer${selected.length?`<b>${selected.length}</b>`:''}</button></div>`+(side==='program'?programmerPanel():cueListPanel(true))}
 else if(mode==='library')el.innerHTML=cueSheet();
 else el.innerHTML=cueListPanel(false);
 fillIcons(el);bindSide();drawSelectionBar();liveKey='';paint(runtime);
}
function bindSide(){
 $$('[data-side]').forEach(b=>b.onclick=()=>{side=b.dataset.side;drawSide()});
 bindCueList();bindProgrammer();bindLibrary();
}

// ── Cue list ──
function badges(e,cue){
 const fade=e.fade>0?`<span class="badge" title="Crossfade ${e.fade}s"><span data-icon="fade"></span>${e.fade}s</span>`:`<span class="badge" title="Hard cut"><span data-icon="cut"></span>Cut</span>`;
 const follow=e.follow==='auto'?`<span class="badge auto" title="Auto-follow to the next cue"><span data-icon="auto"></span>${e.wait!==undefined?e.wait+'s':format(cue?.duration??0)}</span>`:'';
 const kind=cue?.tracks?.length?`<span class="badge muted" title="Contains effects"><span data-icon="spark"></span></span>`:'';
 return fade+follow+kind;
}
function cueListPanel(build){
 const p=page();if(!p)return `<div class="panel-empty">${icon('pages')}<p>Create a page to start a cue list.</p>${build?'<button class="primary" id="emptyNewPage">New page</button>':''}</div>`;
 const head=build?`<div class="page-head"><input id="pageName" value="${esc(p.name)}" aria-label="Page name"><div class="page-colors">${PAGE_COLORS.map(c=>`<button class="dot ${c===p.color?'active':''}" data-page-color="${c}" style="background:${c}" aria-label="Page color"></button>`).join('')}</div><button id="deletePage" class="round-button small danger" aria-label="Delete page" data-icon="trash"></button></div>`
  :`<div class="page-head show"><i style="background:${esc(p.color??'#8bc9d0')}"></i><h2>${esc(p.name)}</h2><span class="count">${p.cues.length}</span></div>`;
 const rows=p.cues.map((e,i)=>{const cue=cueOf(e),open=build&&editingEntry===e.id;return `<div class="cue-item ${open?'open':''}" data-entry-row="${esc(e.id)}"><button class="cue-row" data-entry="${esc(e.id)}" ${build?'':'title="Click to stand by · ▶ or double-click to GO now"'}><span class="cue-num">${i+1}</span><span class="cue-main"><strong>${esc(entryName(e))}</strong><span class="badges">${badges(e,cue)}</span></span><span class="cue-state"></span><span class="cue-progress"><i></i></span></button>${build?`<div class="row-actions"><button class="round-button small eye" data-preview-entry="${esc(e.id)}" title="Preview in the visualizer only" aria-label="Preview ${esc(entryName(e))}" data-icon="eye"></button><button class="round-button small danger stop-entry" data-stop-entry="${esc(e.cue)}" title="Stop this cue · others keep running" aria-label="Stop ${esc(entryName(e))}" data-icon="stop" hidden></button><button class="round-button small" data-go-entry="${esc(e.id)}" title="Run this cue" data-icon="play"></button><button class="round-button small" data-edit-entry="${esc(e.id)}" title="Edit" data-icon="edit"></button></div>`:`<div class="row-actions"><button class="round-button eye" data-preview-entry="${esc(e.id)}" title="Preview in the visualizer only — not live" aria-label="Preview ${esc(entryName(e))}" data-icon="eye"></button><button class="round-button danger stop-entry" data-stop-entry="${esc(e.cue)}" title="Stop this cue · others keep running" aria-label="Stop ${esc(entryName(e))}" data-icon="stop" hidden></button><button class="round-button go-now" data-go-entry="${esc(e.id)}" title="GO this cue now" aria-label="GO ${esc(entryName(e))} now" data-icon="go"></button></div>`}${open?entryEditor(p,e,i):''}</div>`}).join('');
 const add=build?`<div class="add-bar"><button id="addRecord" class="add-button"><span data-icon="record"></span>Record look</button><button id="addLibrary" class="add-button"><span data-icon="library"></span>Library</button></div>`:'';
 return `<div class="cue-panel">${head}<div class="cue-list">${rows||`<div class="panel-empty small"><p>${build?'Add cues with Record look, Effect or Library.':'This page has no cues yet. Build them in Build mode.'}</p></div>`}</div>${add}</div>`;
}
function entryEditor(p,e,i){
 return `<div class="entry-editor"><label class="field-label">Name on this page</label><input id="entryLabel" value="${esc(e.label??'')}" placeholder="${esc(cueOf(e)?.name??'')}">
 <label class="field-label">Cue</label><select id="entryCue">${show.cues.map(c=>`<option value="${esc(c.id)}" ${c.id===e.cue?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
 <label class="field-label">Into this cue</label><div class="seg-row"><div class="segmented"><button data-transition="cut" class="${e.fade>0?'':'active'}"><span data-icon="cut"></span>Cut</button><button data-transition="fade" class="${e.fade>0?'active':''}"><span data-icon="fade"></span>Fade</button></div><label class="num ${e.fade>0?'':'hidden'}"><input id="entryFade" type="number" min="0.1" max="60" step="0.5" value="${e.fade||2}">s</label></div>
 <label class="field-label">Then</label><div class="seg-row"><div class="segmented"><button data-follow="manual" class="${e.follow==='auto'?'':'active'}"><span data-icon="hand"></span>Wait for GO</button><button data-follow="auto" class="${e.follow==='auto'?'active':''}"><span data-icon="auto"></span>Auto-follow</button></div><label class="num ${e.follow==='auto'?'':'hidden'}" title="Seconds after this cue starts"><input id="entryWait" type="number" min="0" max="3600" step="0.5" value="${e.wait??cueOf(e)?.duration??10}">s</label></div>
 ${entrySendsHTML(e)}<div class="editor-actions"><button class="round-button small" data-move="-1" ${i===0?'disabled':''} aria-label="Move up" data-icon="up"></button><button class="round-button small" data-move="1" ${i===p.cues.length-1?'disabled':''} aria-label="Move down" data-icon="down"></button><button class="text-button" id="editCueContent"><span data-icon="edit"></span>Edit cue content</button><button class="round-button small danger" id="removeEntry" aria-label="Remove from page" data-icon="trash"></button></div></div>`;
}
const savePage=p=>command('page.save',{page:p});
function bindCueList(){
 if($('#emptyNewPage'))$('#emptyNewPage').onclick=newPage;
 const p=page();if(!p)return;
 $$('[data-entry]').forEach(b=>{b.onclick=()=>{if(mode==='build'){editingEntry=editingEntry===b.dataset.entry?null:b.dataset.entry;drawSide()}else{standby=b.dataset.entry;paint(runtime)}};b.ondblclick=()=>{if(mode==='show')go(b.dataset.entry)}});
 $$('[data-go-entry]').forEach(b=>b.onclick=()=>{const st=b.dataset.run,id=b.dataset.cue;if(st==='playing'||st==='paused')quiet(command('cue.pause',{id,paused:st==='playing'}));else go(b.dataset.goEntry)});
 $$('[data-stop-entry]').forEach(b=>b.onclick=()=>quiet(command('cue.release',{id:b.dataset.stopEntry})));
 entryControlsKey=null;
 $$('[data-preview-entry]').forEach(b=>b.onclick=()=>{const r=runtime.preview;if(r&&r.page===p.id&&r.entry===b.dataset.previewEntry)stopPreview();else previewCue({page:p.id,entry:b.dataset.previewEntry})});
 $$('[data-edit-entry]').forEach(b=>b.onclick=()=>{editingEntry=editingEntry===b.dataset.editEntry?null:b.dataset.editEntry;drawSide()});
 if($('#pageName'))$('#pageName').onchange=e=>{const name=e.target.value.trim();if(name)quiet(savePage({...structuredClone(p),name}))};
 $$('[data-page-color]').forEach(b=>b.onclick=()=>quiet(savePage({...structuredClone(p),color:b.dataset.pageColor})));
 if($('#deletePage'))$('#deletePage').onclick=()=>confirmDialog(`Delete “${p.name}”?`,'The page and its cue list are removed. Cues stay in the library.','Delete page',async()=>{await command('page.delete',{id:p.id});pageId=show.pages[0]?.id??null;drawAll()});
 if($('#addRecord'))$('#addRecord').onclick=recordDialog;if($('#addLibrary'))$('#addLibrary').onclick=()=>setMode('library');
 const e=p.cues.find(x=>x.id===editingEntry);if(!e||!$('#entryLabel'))return;
 const update=fn=>{const next=structuredClone(p),entry=next.cues.find(x=>x.id===e.id);fn(entry,next);quiet(savePage(next))};
 $('#entryLabel').onchange=ev=>update(x=>{const v=ev.target.value.trim();if(v)x.label=v;else delete x.label});
 $('#entryCue').onchange=ev=>update(x=>{x.cue=ev.target.value});
 $$('[data-transition]').forEach(b=>b.onclick=()=>update(x=>{x.fade=b.dataset.transition==='cut'?0:(+$('#entryFade').value||2)}));
 $('#entryFade').onchange=ev=>update(x=>{x.fade=Math.max(.1,Math.min(60,+ev.target.value||2))});
 $$('[data-follow]').forEach(b=>b.onclick=()=>update(x=>{x.follow=b.dataset.follow;if(x.follow==='manual')delete x.wait}));
 $('#entryWait').onchange=ev=>update(x=>{x.wait=Math.max(0,Math.min(3600,+ev.target.value||0))});
 $$('[data-move]').forEach(b=>b.onclick=()=>update((x,next)=>{const i=next.cues.findIndex(y=>y.id===x.id),j=i+ +b.dataset.move;[next.cues[i],next.cues[j]]=[next.cues[j],next.cues[i]]}));
 $('#removeEntry').onclick=()=>update((x,next)=>{next.cues=next.cues.filter(y=>y.id!==x.id);editingEntry=null});
 $('#editCueContent').onclick=()=>editCue(e.cue);
 $$('[data-del-send]').forEach(b=>b.onclick=()=>update(x=>{x.send.splice(+b.dataset.delSend,1);if(!x.send.length)delete x.send}));
 if($('#addSend'))$('#addSend').onclick=()=>{const target=$('#sendTarget').value,message=$('#sendMessage').value;if(!target)return toast('Add a target in ☰ → Network & triggers first.');
  const item={target,message};if(message==='preset'){const preset=$('#sendPresetId').value.trim();if(!preset)return toast('Pick or type the preset id in that app.');item.preset=preset;const fade=$('#sendPresetFade').value.trim();if(fade!=='')item.fade=Math.max(0,Math.min(600,+fade||0))}
  if(message==='osc'){const address=$('#sendAddress').value.trim();if(!address.startsWith('/'))return toast('An OSC address starts with /');item.address=address;const args=$('#sendArgs').value.trim();if(args)item.args=args.split(',').map(a=>a.trim()).filter(Boolean).map(a=>/^-?\d+(\.\d+)?$/.test(a)?+a:a)}
  update(x=>{x.send=[...(x.send??[]),item]})};
 // Preset picker: the list the target app published (target.presets); opening it or Refresh asks the app again.
 const fillPresets=async(refresh=false)=>{const id=$('#sendTarget')?.value;if(!id)return;try{const r=await command('target.presets',{id,refresh});if(!$('#sendPresetList'))return;$('#sendPresetList').innerHTML=r.presets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.description?' — '+esc(p.description):''}</option>`).join('');$('#sendPresetId').placeholder=r.presets.length?`${r.presets.length} published presets — pick or type an id`:'Preset id in that app'}catch{}};
 const askPresets=()=>{fillPresets(true);setTimeout(()=>{if($('#sendPresetList'))fillPresets()},1200)};
 if($('#sendMessage'))$('#sendMessage').onchange=e=>{$('#sendCustom').hidden=e.target.value!=='osc';$('#sendPreset').hidden=e.target.value!=='preset';if(e.target.value==='preset')askPresets()};
 if($('#sendTarget'))$('#sendTarget').onchange=()=>{if($('#sendMessage').value==='preset')askPresets()};
 if($('#sendPresetRefresh'))$('#sendPresetRefresh').onclick=askPresets;
}
async function go(entry){
 const p=page();if(!p)return toast('Choose a page first.');
 try{cancelAlignment();ensureStageView();await command('page.go',{id:p.id,...(entry?{entry}:{}),requestId:uid('ui')});standby=null;paint(runtime)}catch{}
}
// Preview playback lives in the engine (preview.cue); the stage just chooses which frames to draw.
async function previewCue(args){try{ensureStageView();await command('preview.cue',args);viewSource='preview';paint(runtime)}catch{}}
async function stopPreview(){viewSource='live';try{await command('preview.stop')}catch{}paint(runtime)}
async function sendPreviewLive(){try{await command('preview.go_live',{requestId:uid('ui')});viewSource='live';standby=null;paint(runtime)}catch{}}
// One banner for both: Preview (amber) shows a cue that is not live; Blind (violet) shows edits that are not live.
function drawPreviewBanner(r){
 const banner=$('#previewBanner'),p=r.preview,b=r.blind?.enabled,changed=r.blind?.fixtures.length??0,fxp=r.fxPreview;
 if(fxp){document.body.classList.toggle('viewing-preview',viewSource==='preview');document.body.classList.toggle('blind',!!b);document.body.classList.add('fx-preview');banner.hidden=false;
  const key=['fx',fxp.preset,fxp.fixtures.length,viewSource].join('|');if(banner.dataset.key!==key){banner.dataset.key=key;
   banner.innerHTML=`<span class="pv-tag fx">${icon('spark')}Effect</span><span class="pv-name"><strong>${esc(fxp.name)}</strong><small>${fxp.fixtures.length} fixture${fxp.fixtures.length===1?'':'s'} · not live</small></span><div class="segmented small"><button data-source="live" class="${viewSource==='live'?'active':''}">Live</button><button data-source="preview" class="${viewSource==='preview'?'active':''}">Preview</button></div><button class="chip-button go" id="fxBannerApply">${icon('go')}Apply live</button><button class="round-button small" id="fxBannerCancel" aria-label="Discard effect preview" title="Discard">${icon('close')}</button>`;
   $$('[data-source]').forEach(x=>x.onclick=()=>{viewSource=x.dataset.source;paint(runtime)});$('#fxBannerApply').onclick=applyFxPreview;$('#fxBannerCancel').onclick=cancelFx}
  return}
 document.body.classList.remove('fx-preview');
 if(!p&&!b&&viewSource==='preview')viewSource='live';
 document.body.classList.toggle('viewing-preview',!!(p||b)&&viewSource==='preview');document.body.classList.toggle('blind',!!b);banner.hidden=!(p||b);if(!(p||b))return;
 const name=p?(p.page?entryName(show.pages.find(x=>x.id===p.page)?.cues.find(e=>e.id===p.entry))??p.name:p.name):'Over the live look';
 const key=[p?.id,p?.entry,p?.saved,b,changed>0,viewSource].join('|');if(banner.dataset.key!==key){banner.dataset.key=key;
  banner.innerHTML=`<span class="pv-tag ${b?'blind':''}">${icon(b?'blind':'eye')}${b?'Blind':'Preview'}</span><span class="pv-name"><strong>${esc(name)}</strong><small id="pvMeta"></small></span><div class="segmented small"><button data-source="live" class="${viewSource==='live'?'active':''}">Live</button><button data-source="preview" class="${viewSource==='preview'?'active':''}">${b?'Blind':'Preview'}</button></div>${b&&page()?`<button class="chip-button" id="pvRecord" title="Record the blind look into ${esc(page().name)}">${icon('record')}Record</button>`:''}${b?`<button class="chip-button go" id="pvApply" ${changed?'':'disabled'} title="Fade the blind changes onto the live lights">${icon('go')}Apply live</button>`:p?.saved?`<button class="chip-button go" id="pvLive">${icon('go')}Send to live</button>`:''}<button class="round-button small" id="pvClose" aria-label="${b?'Leave blind':'Stop preview'}" title="${b?'Leave blind (changes are kept)':'Stop preview'}">${icon('close')}</button>`;
  $$('[data-source]').forEach(x=>x.onclick=()=>{viewSource=x.dataset.source;paint(runtime)});
  if($('#pvLive'))$('#pvLive').onclick=sendPreviewLive;if($('#pvRecord'))$('#pvRecord').onclick=recordDialog;
  if($('#pvApply'))$('#pvApply').onclick=()=>quiet(command('blind.apply',{}).then(()=>toast(show.playback.blindFade?`Blind changes fading onto the live lights over ${show.playback.blindFade} s.`:'Blind changes are live.')));
  $('#pvClose').onclick=b?()=>setBlind(false):stopPreview}
 setText($('#pvMeta'),b?`${changed} fixture${changed===1?'':'s'} changed${p?' · over '+p.name:''} · not live`:`${p.fading?'Fading in · ':''}${format(p.elapsed)} / ${format(p.duration)} · not live`);
}
async function setBlind(on){try{await command('blind.set',{enabled:on});viewSource=on?'preview':(runtime.preview?'preview':'live');if(!on&&runtime.blind.fixtures.length)toast('Blind changes are kept. Turn Blind on again to continue, or Clear them.');drawSide();paint(runtime)}catch{}}
async function newPage(){const id=uid('page');await command('page.save',{page:{id,name:`Page ${show.pages.length+1}`,color:PAGE_COLORS[show.pages.length%PAGE_COLORS.length],cues:[]}});pageId=id;store.set('page',id);if(mode!=='build')setMode('build');side='cues';drawAll();setTimeout(()=>$('#pageName')?.select(),50)}

// ── Programmer (build) and override (show) ──
function selectionInfo(){
 const fixtures=show.fixtures.filter(f=>selected.includes(f.id)),movers=fixtures.filter(f=>MOVERS.includes(f.profile)),profiles=[...new Set(movers.map(f=>f.profile))];
 return {fixtures,one:fixtures.length===1?fixtures[0]:null,movers,hasMover:movers.length>0,hasMH7:profiles.includes('mh7'),has200:profiles.includes('beam200'),has7R:profiles.includes('beam7r'),wheelFixtures:fixtures.filter(f=>WHEEL.includes(f.profile)),lampFixtures:fixtures.filter(f=>schema.profiles[f.profile]?.lampControl),moverProfile:profiles.length===1?profiles[0]:null,washes:fixtures.filter(f=>!MOVERS.includes(f.profile)),st:current()};
}
function programmerPanel(){
 if(!selected.length)return `<div class="panel-empty">${icon('target')}<p>Click fixtures on the stage, or pick a group above it.</p></div>`;
 const info=selectionInfo();
 if(info.fixtures.every(f=>f.profile==='unknown')&&progTab!=='patch'&&progTab!=='stage')return headerHTML(info)+`<div class="prog-tabs"><button data-prog="look" class="active"><span data-icon="info"></span><span>Status</span></button><button data-prog="stage"><span data-icon="stage"></span><span>Stage</span></button><button data-prog="patch"><span data-icon="patch"></span><span>Patch</span></button></div><div class="prog-body"><div class="panel-empty">${icon('warning')}<p>Patch recorded. The channel personality is unverified, so physical output is disabled. Use the working Hog DMX values or an exact profile to identify dimmer, shutter, color, movement and control channels.</p></div></div>`;
 if(aligning&&info.one?.id===aligning.id)return headerHTML(info)+alignmentHTML(info.one);
 if(aligning)cancelAlignment();
 const tabs=[['look','palette','Look'],...(info.hasMover?[['beam','beam','Beam'],['position','position','Position']]:[]),['effects','spark','Effects'],['stage','stage','Stage'],['patch','patch','Patch']];
 if(!tabs.some(t=>t[0]===progTab))progTab='look';
 const body={look:()=>secIntensity(info)+secColor(info),beam:()=>secBeam(info)+secLamp(info),position:()=>secPosition(info,true),effects:()=>secEffects(info),stage:()=>secStage(info),patch:()=>secPatch(info)}[progTab]();
 return headerHTML(info)+`<div class="prog-tabs">${tabs.map(([id,ic,label])=>`<button data-prog="${id}" class="${progTab===id?'active':''}" title="${label}"><span data-icon="${ic}"></span><span>${label}</span></button>`).join('')}</div><div class="prog-body">${body}</div>`;
}
function overridePanel(){
 const info=selectionInfo(),tabs=`<div class="prog-tabs two">${[['props','sliders','Properties'],['effects','spark','Effects']].map(([id,ic,l])=>`<button data-ovtab="${id}" class="${ovTab===id?'active':''}"><span data-icon="${ic}"></span><span>${l}</span></button>`).join('')}</div>`;
 return headerHTML(info,true)+tabs+`<div class="prog-body override">${ovTab==='effects'?secEffects(info):secIntensity(info)+secColor(info,true)+(info.hasMover?secPosition(info,false)+secBeam(info,true):'')}</div>`;
}
// ── Effects: layered on the current look; preview first (visualizer only) or straight to live ──
// Built-ins from the schema plus the show's custom presets (custom:true), same shape as the engine's allPresets().
function allPresets(){const cat={intensity:'intensity',color:'color',position:'movement'},out={};for(const [k,v] of Object.entries(schema.presets))if(!v.custom)out[k]=v;for(const p of show.presets??[]){const layer=schema.effects[p.effect]?.layer;out[p.id]={duration:20,loop:true,...p,category:cat[layer],movers:layer==='position',custom:true}}return out}
const fxPresetsFor=info=>Object.entries(allPresets()).filter(([,p])=>{const layer=schema.effects[p.effect]?.layer;return layer&&(layer!=='position'||info.hasMover)});
const fxSlider=(key,label,ic,value,[min,max])=>`<div class="slider"><span class="slider-icon" data-icon="${ic}"></span><div class="slider-body"><div class="slider-head"><label>${label}</label></div><input type="range" data-fxparam="${key}" min="${min}" max="${max}" step="${(max-min)/200}" value="${value}"></div></div>`;
function secEffects(info){
 const presets=fxPresetsFor(info),pv=runtime.fxPreview,running=runtime.fx.filter(x=>x.fixtures.some(id=>selected.includes(id)));
 const active=new Set(running.map(x=>x.preset));
 let html=`<div class="seg-row"><div class="segmented wide"><button data-fxmode="preview" class="${fxMode==='preview'?'active':''}">${icon('eye')}Preview first</button><button data-fxmode="live" class="${fxMode==='live'?'active':''}">${icon('go')}Straight to live</button></div></div>`;
 html+=[['intensity','Intensity'],['color','Color'],['movement','Movement']].map(([c,label])=>{const list=presets.filter(([,p])=>p.category===c);return list.length?`<h4 class="fx-cat">${label}</h4><div class="fx-grid">${list.map(([id,p])=>`<button class="fx-tile ${active.has(id)?'active':''} ${pv?.preset===id?'previewing':''} ${p.custom?'custom':''}" data-fx="${esc(id)}" title="${esc((p.custom?'Custom · ':'')+(p.description??schema.effects[p.effect].description))}${p.custom?' · right-click to delete':''}">${icon(p.icon)}<span>${esc(p.name)}</span>${p.custom?'<b class="custom-dot" aria-label="custom"></b>':''}</button>`).join('')}</div>`:''}).join('');
 if(!info.hasMover)html+=`<p class="hint">Movement effects appear when moving heads are selected.</p>`;
 const cur=pv??running.at(-1);
 if(cur){const params=cur.params,strobe=cur.effect==='strobe';
  html+=`<div class="fx-controls"><div class="fx-now"><strong>${esc(cur.name)}</strong><small class="${pv?'pv':'live'}">${pv?'Previewing · not live':'Live'} · ${cur.fixtures.length} fixtures</small></div>`
   +fxSlider('speed','Speed','speed',strobe?params.frequency??3:params.speed??1,strobe?[.25,6]:[.05,4])
   +(cur.layer==='position'?fxSlider('size','Size','zoom',params.panAmplitude??.04,[.005,.2]):fxSlider('brightness','Level','sun',params.brightness??.8,[0,1]))
   +(cur.layer==='color'&&cur.effect!=='rainbow'?`<div class="fx-colors"><label>${icon('palette')}A<input type="color" data-fxcolor="color" value="${esc(params.color??'#ffffff')}"></label><label>B<input type="color" data-fxcolor="secondary" value="${esc(params.secondary??'#9955ee')}"></label></div>`:'')
   +`<div class="editor-actions">${pv?`<button class="primary go-fill" id="fxApplyBtn">${icon('go')}Apply live</button><button class="ghost-button" id="fxDiscard">Discard</button>`:''}<button class="text-button" id="fxSaveCustom">${icon('save')}Save as custom effect</button></div></div>`}
 if(running.length)html+=`<h4 class="fx-cat">Running live</h4><div class="pool-list fx-running">${running.map(x=>`<div class="pool-row"><span class="pill-icon">${icon(allPresets()[x.preset]?.icon??'spark')}</span><strong>${esc(x.name)}</strong><small>${x.fixtures.length} fixtures</small><button class="round-button small danger" data-fx-stop="${esc(x.id)}" title="Stop this effect" aria-label="Stop ${esc(x.name)}">${icon('stop')}</button></div>`).join('')}</div>`;
 return section('Effects','spark',html+`<p class="hint">Effects layer on the current look: movement circles where heads already point, intensity pulses the current level, color recolors. Save (GO bar) adds them to the cue.</p>`);
}
// Save the effect being previewed (or the newest running one) as a custom preset in the show library.
function customEffectDialog(){
 const cur=runtime.fxPreview??runtime.fx.filter(x=>x.fixtures.some(id=>selected.includes(id))).at(-1);if(!cur)return toast('Preview or run an effect first.');
 const base=allPresets()[cur.preset];let chosen=base?.icon??'spark';
 dialog('Save custom effect',`<p class="hint">Saves ${esc(schema.effects[cur.effect].name)} with its current settings to this show's effects library. It shows up in the Effects tab for any matching selection, and agents can use it too.</p><label class="mini"><span>Name</span><input id="customName" type="text" maxlength="100" value="${esc(base&&!base.custom?base.name+' · mine':cur.name)}"></label><label class="mini"><span>Description</span><input id="customDesc" type="text" maxlength="300" placeholder="Optional"></label><h3>Icon</h3><div class="icon-picker">${ICONS.map(n=>`<button class="icon-pick ${n===chosen?'active':''}" data-icon-pick="${n}" title="${n}">${icon(n)}</button>`).join('')}</div><div class="dialog-actions"><button class="primary" id="customSave">${icon('save')}Save effect</button></div>`);
 $$('[data-icon-pick]').forEach(b=>b.onclick=()=>{chosen=b.dataset.iconPick;$$('[data-icon-pick]').forEach(x=>x.classList.toggle('active',x===b))});
 $('#customSave').onclick=async()=>{const name=$('#customName').value.trim();if(!name)return toast('Name the effect first.');const desc=$('#customDesc').value.trim();
  try{const id=uid('fx');await command('preset.save',{preset:{id,name,icon:chosen,effect:cur.effect,params:cur.params,...(desc?{description:desc}:{})}});$('#dialog').close();toast(`“${name}” saved to the effects library.`);drawSide()}catch{}};
}
async function runFx(preset){
 // Going straight to live drops any open preview so the controls follow the effect just touched.
 try{if(fxMode==='preview'){await command('fx.preview',{fixtures:selected,preset});viewSource='preview';ensureStageView()}else{if(runtime.fxPreview){await command('fx.cancel');viewSource=runtime.preview||runtime.blind?.enabled?'preview':'live'}await command('fx.apply',{fixtures:selected,preset})}drawSide()}catch{}
}
// Slider edits re-send the same effect: the engine keeps its phase, so it changes smoothly.
const liveFx=createLiveControl((_k,values)=>{const pv=runtime.fxPreview,cur=pv??runtime.fx.filter(x=>x.fixtures.some(id=>selected.includes(id))).at(-1);if(!cur)return Promise.resolve();
 const params={...cur.params};for(const [k,v] of Object.entries(values)){if(k==='speed'&&cur.effect==='strobe')params.frequency=v;else if(k==='size'){const ratio=(cur.params.tiltAmplitude??v*.6)/Math.max(.001,cur.params.panAmplitude??v);params.panAmplitude=v;params.tiltAmplitude=Math.min(.2,v*ratio)}else params[k]=v}
 return pv?command('fx.preview',{fixtures:cur.fixtures,...(cur.preset?{preset:cur.preset}:{effect:cur.effect}),params}):command('fx.apply',{fixtures:cur.fixtures,...(cur.preset?{preset:cur.preset}:{effect:cur.effect}),params,fade:0})});
async function applyFxPreview(){try{await command('fx.apply',{});viewSource=runtime.preview||runtime.blind?.enabled?'preview':'live';toast(show.playback.blindFade?`Effect fading in live over ${show.playback.blindFade} s.`:'Effect is live.');drawSide()}catch{}}
async function cancelFx(){try{await command('fx.cancel');viewSource=runtime.preview||runtime.blind?.enabled?'preview':'live';drawSide()}catch{}}
function headerHTML(info,override=false){
 const overridden=selected.filter(id=>progOverrides(runtime)[id]).length;
 return `<div class="prog-head">${override?`<button class="round-button small" id="backToCues" aria-label="Back to cue list" data-icon="left"></button>`:''}<div><h2>${esc(selectionTitle())}</h2><small>${overridden?`<span class="dot-live"></span>${overridden} ${runtime.blind?.enabled?'changed in blind':'overridden'}`:runtime.blind?.enabled?'Blind · edits are not live':mode==='show'?'Following the cue':'Following the cue'}</small></div><button class="chip-button" id="releaseSelected" ${overridden?'':'disabled'} title="Fade these fixtures back to the cue"><span data-icon="release"></span>Clear</button></div>`;
}
const attrRead=(key,value)=>key.startsWith('colorWheel')?`${Math.round(value)} DMX`:key==='pan'||key==='tilt'?String(Math.round(value*255)):Math.round(value*100)+'%';
const slider=(key,label,ic,value,{min=0,max=1,step=.01,big=false}={})=>{const pos=key==='pan'||key==='tilt',scale=pos?255:1;return `<div class="slider ${big?'big':''}"><span class="slider-icon" data-icon="${ic}" title="${label}"></span><div class="slider-body"><div class="slider-head"><label for="attr-${key}">${label}</label><output data-read="${key}">${attrRead(key,value)}</output></div><input id="attr-${key}" data-attr="${key}" type="range" min="${min*scale}" max="${max*scale}" step="${pos?1:step}" value="${value*scale}"></div></div>`};
const section=(title,ic,inner,extra='')=>`<section class="prop"><h3><span data-icon="${ic}"></span>${title}${extra}</h3>${inner}</section>`;
function secIntensity({st}){const v=progOverrides(runtime)[selected[0]]?.intensity??(runtime.master?st.intensity/runtime.master:0);return section('Intensity','sun',slider('intensity','Level','sun',v,{big:true})+`<div class="quick-levels">${[0,25,50,75,100].map(n=>`<button class="pill" data-level="${n/100}">${n?n+'%':'Off'}</button>`).join('')}</div>`)}
function secColor(info,compact=false){
 const {st,hasMover,moverProfile,washes}=info,wheel=hasMover&&!washes.length&&moverProfile?COLOR_WHEELS[moverProfile]:null;
 const swatch=(hex,title,attr='data-color')=>`<button class="swatch" ${attr}="${esc(hex)}" style="--c:${esc(hex)}" title="${esc(title)}" aria-label="${esc(title)}"></button>`;
 let html=wheel?`<div class="swatches">${wheel.map(([hex])=>swatch(hex,'Wheel color')).join('')}</div><p class="hint">Wheel colors this fixture can actually make.</p>`:'';
 if(!info.fixtures.every(f=>['beam200','beam7r'].includes(f.profile)))html+=`<div class="swatches">${[{id:'white',name:'White',color:'#ffffff'},...show.palettes.filter(p=>p.id!=='white'&&p.color.toLowerCase()!=='#ffffff')].map(p=>`<span class="palette-chip">${swatch(p.color,p.name)}${mode==='build'&&p.id!=='white'&&show.palettes.some(x=>x.id===p.id)?`<button class="x" data-delete-palette="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">×</button>`:''}</span>`).join('')}<label class="swatch custom" title="Custom color"><input id="color" type="color" value="${hexOf(st.color)}" aria-label="Custom color"></label>${mode==='build'?`<button class="swatch add" id="savePalette" title="Save this color" aria-label="Save this color">${icon('plus')}</button>`:''}</div>`;
 if(info.wheelFixtures.length){const target=info.wheelFixtures.find(f=>f.id===selected[0])??info.wheelFixtures[0],wheel=fixtureWheel(target,runtime.frames.find(f=>f.id===target.id)),shared=sharedWheelColors(info.fixtures);
  html+=`<div class="swatches wheel-swatches">${shared.some(c=>c.entries.every(e=>e.value===0&&(e.secondary??0)===0))?'':'<button class="swatch" data-wheel-neutral style="--c:#ffffff" title="White / open · wheel 0" aria-label="White / open wheel"></button>'}${shared.map((c,i)=>`<button class="swatch" data-wheel-slot="${i}" style="--c:${esc(bandSwatch(c.bands))}" title="${esc(c.name)} · ${c.entries.map(e=>esc(e.id)+': '+e.value).join(', ')}" aria-label="${esc(c.name)}"></button>`).join('')}${mode==='build'?`<button class="swatch add" id="saveWheelColor" title="Save the wheel color you see" aria-label="Save wheel color">${icon('save')}</button>`:''}</div><p class="hint">${shared.length?'Calibrated wheel colors for these heads.':'No wheel colors saved yet — move the wheel, then save what you see.'}</p>`;
  if(!compact)html+=slider('colorWheel',`Wheel · ch ${info.has200&&info.has7R?'9 / 1':info.has200?'9':'1'}`,'palette',wheel.value,{min:0,max:info.has7R?119:127,step:1})+(info.has200?slider('colorWheel2','Colour 2 · ch 10','palette',wheel.secondary,{min:0,max:255,step:1}):'');}
 if(washes.length&&!compact)html+=slider('white',washes.some(f=>f.profile==='q120')?'Warm white':'White','white',st.white??0)+(washes.some(f=>f.profile==='colorado')&&!hasMover?slider('zoom','Zoom','zoom',st.zoom):'');
 return section('Color','palette',html);
}
function secBeam(info,compact=false){
 const {st,hasMH7,moverProfile}=info;let html='';
 if(hasMH7&&!compact)html+=`<div class="seg-row"><div class="segmented wide"><button data-optical="beam" class="${st.opticalMode!=='spot'?'active':''}"><span data-icon="beam"></span>Beam</button><button data-optical="spot" class="${st.opticalMode==='spot'?'active':''}" title="Unverified on this rig"><span data-icon="target"></span>Spot<small>unverified</small></button></div></div>`;
 if(moverProfile){const slots=GOBOS[moverProfile]?.length??(schema.profiles[moverProfile].maxGobo??17)+1;html+=`<div class="gobo-grid ${compact?'compact':''}">${Array.from({length:slots},(_,i)=>`<button class="gobo-button ${(st.gobo??0)===i?'active':''}" data-gobo="${i}" title="${esc(goboName(moverProfile,i))}">${goboIcon(moverProfile,i)}<span>${i||'Open'}</span></button>`).join('')}</div>`}
 else html+=`<p class="hint">Select one fixture type to pick gobos — each model has its own wheel.</p>`;
 const {has200,has7R}=info,single=has200||has7R,prisms=[[0,'Single'],[1,hasMH7?'4-facet':has7R&&!has200?'8-face':has200&&!has7R?'3-face':'Prism 1'],...(single?[]:[[2,hasMH7?'8-facet':'Prism 2']]),...(hasMH7||single?[]:[[3,'Both']])];
 html+=`<div class="icon-choices">${prisms.map(([v,label])=>`<button class="choice ${(st.prism??0)===v?'active':''}" data-prism="${v}">${prismIcon(v)}<span>${label}</span></button>`).join('')}</div>`;
 if(!compact)html+=(hasMH7?slider('zoom','Zoom','zoom',st.zoom??.5):'')+slider('focus','Focus','focus',st.focus??.5)+slider('frost','Frost','frost',st.frost??0)+(has200||has7R?slider('goboShake','Gobo shake','twinkle',st.goboShake??0):'')+(hasMH7?`<details class="more"><summary>${icon('info')}MH7 notes</summary><p>Static gobos work in Beam mode; Spot parks the wheel. Frost switches on at 50%. Colors snap to the nearest wheel slot. Preview beams are illustrative.</p></details>`:'');
 return section('Beam','beam',html);
}
function prismIcon(v){const dots=v===0?[[12,12]]:v===1?[[8,8],[16,8],[8,16],[16,16]]:v===2?Array.from({length:8},(_,i)=>[12+6*Math.cos(i*Math.PI/4),12+6*Math.sin(i*Math.PI/4)]):[[12,12],...Array.from({length:6},(_,i)=>[12+7*Math.cos(i*Math.PI/3),12+7*Math.sin(i*Math.PI/3)])];return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${dots.map(([x,y])=>`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${v===0?4:2}" fill="currentColor"/>`).join('')}</svg>`}
function secLamp({lampFixtures}){
 if(!lampFixtures.length)return '';const armed=runtime.output.armed;
 return section('Lamp','flame',`<div class="lamp-buttons"><button class="lamp strike" data-lamp="strike" ${armed?'':'disabled'}>${icon('flame')}<span>Strike</span></button><button class="lamp douse" data-lamp="douse" ${armed?'':'disabled'}>${icon('flameOff')}<span>Douse</span></button></div><p id="lampStatus" class="hint">${armed?'Applies to selected lamp heads':'Arm output to control lamps'}</p><details class="more"><summary>${icon('info')}Lamp safety</summary><p>Lamp state is never confirmed — check the fixtures. MH7: allow 5 minutes after striking before dousing, and douse needs “Off via DMX” enabled. Follow each fixture's cooling time before restriking. Lamp commands are never saved in cues.</p></details>`);
}
function secPosition(info,full){
 const {st,one}=info,c=one?.calibration;
 const pool=show.points.map(p=>{const has=selected.some(id=>p.positions[id]);return `<span class="palette-chip"><button class="pool-button ${has?'':'dim'}" data-point="${esc(p.id)}" ${has?'':'disabled'} title="${Object.keys(p.positions).length} fixtures">${icon('target')}<span>${esc(p.name)}</span></button>${mode==='build'?`<button class="x" data-delete-point="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">×</button>`:''}</span>`}).join('');
 let html=`<div class="pool">${pool||'<p class="hint">No saved positions yet.</p>'}</div><div class="inline-form"><input id="pointName" type="text" placeholder="Position name" aria-label="Position name"><button id="capturePoint" class="chip-button"><span data-icon="save"></span>Save for ${info.movers.length}</button></div>`;
 html+=`<div class="seg-row"><div class="segmented"><button data-position-mode="joystick" class="${positionMode==='joystick'?'active':''}"><span data-icon="joystick"></span>Joystick</button><button data-position-mode="sliders" class="${positionMode==='sliders'?'active':''}"><span data-icon="sliders"></span>Fine</button></div>${positionMode==='joystick'?`<div class="segmented small">${[['.025','Fine'],['.1','Normal'],['.25','Fast']].map(([v,l])=>`<button data-joy-speed="${v}" class="${String(joystickSpeed)===v.replace(/^\./,'0.')||joystickSpeed===+v?'active':''}">${l}</button>`).join('')}</div>`:''}</div>`;
 html+=positionMode==='joystick'?`<div id="joystick" class="joystick" tabindex="0" role="group" aria-label="Pan and tilt joystick. Hold and drag, or hold arrow keys."><span class="joy-up">${icon('up')}</span><span class="joy-down">${icon('down')}</span><span class="joy-left">${icon('left')}</span><span class="joy-right">${icon('right')}</span><span class="joystick-knob"></span></div>`
  :slider('pan','Pan','orbit',st.pan,{min:c?.panRange[0]??0,max:c?.panRange[1]??1,step:.0001})+slider('tilt','Tilt','up',st.tilt,{min:c?.tiltRange[0]??0,max:c?.tiltRange[1]??1,step:.0001});
 if(full&&info.movers.some(f=>['rogue','beam200'].includes(f.profile)))html+=slider('movementSpeed','Motor speed','speed',st.movementSpeed??1);
 return section('Position','position',html);
}
function secStage({one,hasMover,st}){
 if(!one)return `<div class="panel-empty small"><p>Select a single fixture to place it on the stage model or align its beam.</p></div>`;
 const pos=one.position;
 let html=section('Placement','stage',`<div class="nudge"><div class="nudge-pad">${[['x',-1,'left','Stage left'],['z',-1,'up','Upstage'],['z',1,'down','Downstage'],['x',1,'right','Stage right']].map(([axis,dir,ic,label])=>`<button class="round-button" data-nudge="${axis}" data-dir="${dir}" title="${label}" aria-label="${label}">${icon(ic)}</button>`).join('')}<span class="nudge-center">${icon('target')}</span></div><div class="nudge-height"><button class="round-button" data-nudge="y" data-dir="1" title="Raise" aria-label="Raise">${icon('up')}</button><span>Height</span><button class="round-button" data-nudge="y" data-dir="-1" title="Lower" aria-label="Lower">${icon('down')}</button></div><div class="segmented small vertical">${['.1','.5','1'].map(v=>`<button data-step="${v}" class="${nudgeStep===+v?'active':''}">${v} m</button>`).join('')}</div></div><div class="xyz">${pos.map((v,i)=>`<label><span>${'XYZ'[i]}</span><input data-place="${i}" type="number" step=".1" min="-50" max="50" value="${v}"></label>`).join('')}</div><p class="hint">Meters · −Z is upstage. Moves the preview only; the real light and patch are unchanged.</p>`);
 if(hasMover){const c=one.calibration;html+=section('Beam alignment','target',`<button id="beginAlignment" class="chip-button wide"><span data-icon="target"></span>Hold real pose &amp; align preview</button><p class="hint">${c.alignment?'Aligned · '+esc(c.alignment.name):'Preview aim is not calibrated.'}</p><details class="more"><summary>${icon('sliders')}Limits &amp; home</summary><div class="two-col">${[['panMin','Pan min',c.panRange[0]],['panMax','Pan max',c.panRange[1]],['tiltMin','Tilt min',c.tiltRange[0]],['tiltMax','Tilt max',c.tiltRange[1]]].map(([id,l,v])=>`<label class="mini"><span>${l}</span><input id="${id}" type="number" step=".001" min="0" max="1" value="${v}"></label>`).join('')}</div><label class="check"><input id="reviewed" type="checkbox" ${c.reviewed?'checked':''}>Checked on the real fixture</label><button id="saveCalibration" class="chip-button wide"><span data-icon="save"></span>Save limits &amp; current home (tilt ${Math.round(st.tilt*255)})</button></details>`)}
 return html;
}
let nudgeStep=.1;
function secPatch({one}){
 if(!one)return `<div class="panel-empty small"><p>Select a single fixture to edit its patch.</p></div>`;
 return section('Patch','patch',`<div class="patch-card"><strong>${esc(schema.profiles[one.profile].name)}</strong><span class="${one.verified?'ok':'warn'}">${one.verified?'Verified profile':'Unverified · preview only'}</span></div><label class="mini"><span>Label</span><input id="patchName" type="text" value="${esc(one.name)}"></label><div class="two-col"><label class="mini"><span>Hog universe</span><input id="patchUniverse" type="number" min="0" max="512" value="${one.universe}"></label><label class="mini"><span>Start address</span><input id="patchAddress" type="number" min="0" max="512" value="${one.address}"></label></div><button id="savePatch" class="chip-button wide"><span data-icon="save"></span>Save patch</button><p class="hint">Patch edits need preview mode. Don't invent channel maps — verify against the manufacturer manual.</p>`);
}
const liveFixture=createLiveControl((ids,values)=>{ensureStageView();return command('fixture.set',{ids,values})});
const liveMaster=createLiveControl((_ids,values)=>command('master.set',{value:values.value}));
function bindProgrammer(){
 const info=show&&selected.length?selectionInfo():null;
 $$('[data-prog]').forEach(b=>b.onclick=()=>{progTab=b.dataset.prog;drawSide()});
 if($('#backToCues'))$('#backToCues').onclick=()=>{side='cues';drawSide()};
 if($('#releaseSelected'))$('#releaseSelected').onclick=()=>quiet(command('override.release',{ids:selected.filter(id=>progOverrides(runtime)[id])}).then(()=>drawSide()));
 $$('[data-ovtab]').forEach(b=>b.onclick=()=>{ovTab=b.dataset.ovtab;drawSide()});
 $$('[data-fxmode]').forEach(b=>b.onclick=()=>{fxMode=b.dataset.fxmode;store.set('fxMode',fxMode);drawSide()});
 $$('[data-fx]').forEach(b=>{b.onclick=()=>runFx(b.dataset.fx);const p=allPresets()[b.dataset.fx];if(p?.custom)b.oncontextmenu=e=>{e.preventDefault();confirmDialog(`Delete “${p.name}”?`,'This custom effect is removed from the library. Cues already made with it keep their effects.','Delete effect',()=>command('preset.delete',{id:b.dataset.fx}).then(drawSide))}});
 if($('#fxSaveCustom'))$('#fxSaveCustom').onclick=customEffectDialog;
 $$('[data-fxparam]').forEach(el=>el.oninput=()=>liveFx(['fx'],{[el.dataset.fxparam]:+el.value}));
 $$('[data-fxcolor]').forEach(el=>el.oninput=()=>liveFx(['fx'],{[el.dataset.fxcolor]:el.value}));
 if($('#fxApplyBtn'))$('#fxApplyBtn').onclick=applyFxPreview;if($('#fxDiscard'))$('#fxDiscard').onclick=cancelFx;
 $$('[data-fx-stop]').forEach(b=>b.onclick=()=>{const x=runtime.fx.find(x=>x.id===b.dataset.fxStop);if(x)quiet(command('fx.stop',{ids:x.fixtures}).then(drawSide))});
 if(!info)return;
 if(aligning){bindAlignment(info.one);return}
 $$('[data-attr]').forEach(el=>{const update=()=>{el.dataset.editedAt=String(performance.now());const key=el.dataset.attr,value=+el.value/(['pan','tilt'].includes(key)?255:1);setText($(`[data-read="${key}"]`),attrRead(key,value));const ids=key==='colorWheel2'?info.fixtures.filter(f=>f.profile==='beam200').map(f=>f.id):key==='colorWheel'?info.wheelFixtures.map(f=>f.id):selected;liveFixture(ids,{[key]:value})};el.oninput=update;el.onchange=update});
 $$('[data-level]').forEach(b=>b.onclick=()=>quiet(command('fixture.set',{ids:selected,values:{intensity:+b.dataset.level}}).then(drawSide)));
 if($('#color'))$('#color').oninput=e=>liveFixture(selected,{color:e.target.value});
 $$('[data-color]').forEach(b=>b.onclick=()=>quiet(command('fixture.set',{ids:selected,values:{color:b.dataset.color,...(b.dataset.color.toLowerCase()==='#ffffff'?{white:0}:{})}})));
 $$('[data-delete-palette]').forEach(b=>b.onclick=()=>quiet(command('palette.delete',{id:b.dataset.deletePalette})));
 if($('#savePalette'))$('#savePalette').onclick=()=>{dialog('Save color',`<div class="inline-form"><span class="swatch" style="--c:${esc($('#color').value)}"></span><input id="paletteName" type="text" placeholder="e.g. Dawn gold"><button id="paletteSave" class="primary">Save</button></div>`);$('#paletteSave').onclick=async()=>{const name=$('#paletteName').value.trim();if(!name)return toast('Name the color first.');await command('palette.save',{id:uid('palette'),name,color:hexOf(current().color)});$('#dialog').close()}};
 $$('[data-wheel-neutral]').forEach(b=>b.onclick=async()=>{try{await command('fixture.set',{ids:info.wheelFixtures.map(f=>f.id),values:{color:'#ffffff',colorWheel:0}});const extra=info.fixtures.filter(f=>f.profile==='beam200').map(f=>f.id);if(extra.length)await command('fixture.set',{ids:extra,values:{colorWheel2:0}});drawSide()}catch{}});
 $$('[data-wheel-slot]').forEach(b=>b.onclick=async()=>{const c=sharedWheelColors(info.fixtures)[+b.dataset.wheelSlot];try{for(const e of c.entries)await command('fixture.set',{ids:[e.id],values:{color:c.color,colorWheel:e.value,...(e.secondary===undefined?{}:{colorWheel2:e.secondary})}});drawSide()}catch{}});
 if($('#saveWheelColor'))$('#saveWheelColor').onclick=()=>{
  // One observation per fixture type; scope profile copies it to every head of that type.
  const sources=selected.map(id=>info.wheelFixtures.find(f=>f.id===id)).filter(Boolean).filter((f,i,all)=>all.findIndex(x=>x.profile===f.profile)===i);
  const entries=wheelEntries(sources,runtime.frames),targets=show.fixtures.filter(f=>sources.some(x=>x.profile===f.profile));
  dialog('Save wheel color',`<p class="hint">Saves the color you see for ${targets.length===1?'fixture '+esc(targets[0].id):'all '+targets.length+' matching heads'}. Each fixture type keeps its own wheel value: ${entries.map(e=>esc(e.id)+' → '+e.value+(e.secondary===undefined?'':' / '+e.secondary)).join(' · ')}</p><div class="inline-form"><input id="wheelColorSwatch" type="color" value="#ffffff" aria-label="Observed color"><input id="wheelColorName" type="text" maxlength="100" placeholder="e.g. Deep blue" aria-label="Wheel color name"><button id="wheelColorSave" class="primary">Save</button></div>`);
  $('#wheelColorName').focus();$('#wheelColorSave').onclick=async()=>{const name=$('#wheelColorName').value.trim();if(!name)return toast('Name this color first.');try{await command('fixture.colors.save',{entries,scope:'profile',name,color:$('#wheelColorSwatch').value});$('#dialog').close();toast(`Wheel color saved for ${targets.length} fixture${targets.length===1?'':'s'}, cues and agents.`)}catch{}};
 };
 const moverIds=info.movers.map(f=>f.id);
 $$('[data-optical]').forEach(b=>b.onclick=()=>quiet(command('fixture.set',{ids:info.fixtures.filter(f=>f.profile==='mh7').map(f=>f.id),values:{opticalMode:b.dataset.optical}}).then(drawSide)));
 $$('[data-gobo]').forEach(b=>b.onclick=()=>quiet(command('fixture.set',{ids:moverIds,values:{gobo:+b.dataset.gobo}}).then(drawSide)));
 $$('[data-prism]').forEach(b=>b.onclick=()=>quiet(command('fixture.set',{ids:moverIds,values:{prism:+b.dataset.prism}}).then(drawSide)));
 $$('[data-lamp]').forEach(b=>b.onclick=()=>quiet(command('fixture.lamp',{ids:info.lampFixtures.map(f=>f.id),action:b.dataset.lamp}).then(()=>toast('Lamp command sent for 5 seconds — check the actual lamps.'))));
 $$('[data-point]').forEach(b=>b.onclick=()=>quiet(command('point.recall',{id:b.dataset.point,ids:selected})));
 $$('[data-delete-point]').forEach(b=>b.onclick=()=>quiet(command('point.delete',{id:b.dataset.deletePoint})));
 if($('#capturePoint'))$('#capturePoint').onclick=async()=>{const name=$('#pointName').value.trim();if(!name)return toast('Name this position first.');if(!moverIds.length)return toast('Select moving heads first.');await command('point.save',{id:uid('point'),name,fixtures:moverIds});toast(`“${name}” saved for ${moverIds.length} heads.`)};
 $$('[data-position-mode]').forEach(b=>b.onclick=()=>{positionMode=b.dataset.positionMode;drawSide()});
 $$('[data-joy-speed]').forEach(b=>b.onclick=()=>{joystickSpeed=+b.dataset.joySpeed;drawSide()});
 if($('#joystick'))destroyJoystick=mountJoystick($('#joystick'),{getSpeed:()=>joystickSpeed,getTargets:()=>selected.map(id=>{const f=fixture(id),p=runtime.frames.find(f=>f.id===id);return MOVERS.includes(f?.profile)&&p?{id,position:{pan:p.pan,tilt:p.tilt},calibration:f.calibration}:null}).filter(Boolean),onMove:(id,position)=>liveFixture([id],position)});
 const one=info.one;
 $$('[data-step]').forEach(b=>b.onclick=()=>{nudgeStep=+b.dataset.step;drawSide()});
 $$('[data-nudge]').forEach(b=>b.onclick=()=>{const i='xyz'.indexOf(b.dataset.nudge),position=[...one.position];position[i]=Math.round((position[i]+nudgeStep*+b.dataset.dir)*100)/100;quiet(command('fixture.place',{id:one.id,position}))});
 $$('[data-place]').forEach(el=>el.onchange=()=>quiet(command('fixture.place',{id:one.id,position:$$('[data-place]').map(e=>+e.value)})));
 if($('#beginAlignment'))$('#beginAlignment').onclick=()=>beginAlignment(one).catch(e=>toast(e.message));
 if($('#saveCalibration'))$('#saveCalibration').onclick=async()=>{const f=structuredClone(one);f.calibration.panRange=[+$('#panMin').value,+$('#panMax').value];f.calibration.tiltRange=[+$('#tiltMin').value,+$('#tiltMax').value];f.calibration.home=[current().pan,current().tilt];f.calibration.reviewed=$('#reviewed').checked;await command('fixture.patch',{fixture:f});toast('Calibration saved.')};
 if($('#savePatch'))$('#savePatch').onclick=async()=>{const f=structuredClone(one);f.name=$('#patchName').value;f.address=+$('#patchAddress').value;f.universe=+$('#patchUniverse').value;await command('fixture.patch',{fixture:f});toast('Patch saved.')};
}

// ── Beam alignment (build › Stage) ──
function cancelAlignment(){aligning=null;if(stage)stage.alignmentPreview=null}
async function beginAlignment(f){
 destroyJoystick?.();destroyJoystick=null;await command('calibration.hold',{id:f.id});
 const st=runtime.frames.find(x=>x.id===f.id),a=f.calibration.alignment;
 aligning={id:f.id,actual:[st.pan,st.tilt],virtual:aimAngles(f,st.pan,st.tilt),panSign:a?.panSign??1,tiltSign:a?.tiltSign??1};
 ensureStageView();stage.alignmentPreview=aligning;drawSide();
}
function alignmentHTML(f){
 const a=aligning;
 return `<div class="prog-body">${section('Match the real beam','target',`<p class="hint">Real pose held at pan ${Math.round(a.actual[0]*255)}, tilt ${Math.round(a.actual[1]*255)}. Let the head settle, then aim the virtual beam to match. Preview only.</p>${[0,1].map(i=>`<div class="slider"><span class="slider-icon" data-icon="${i?'up':'orbit'}"></span><div class="slider-body"><div class="slider-head"><label>${i?'Virtual tilt · 0° down':'Virtual yaw'}</label><input class="deg" data-aim-number="${i}" type="number" min="-720" max="720" step=".5" value="${+a.virtual[i].toFixed(2)}"></div><input data-aim="${i}" type="range" min="-720" max="720" step=".5" value="${+a.virtual[i].toFixed(2)}"></div></div>`).join('')}<label class="mini"><span>Alignment name</span><input id="alignmentName" value="Stage alignment" maxlength="100"></label><details class="more"><summary>${icon('sliders')}Axis direction</summary>${['pan','tilt'].map(k=>`<label class="mini"><span>${k}</span><select id="align-${k}"><option value="1">Normal</option><option value="-1">Reverse</option></select></label>`).join('')}</details><div class="editor-actions"><button id="saveAlignment" class="primary"><span data-icon="check"></span>Calibrate &amp; save</button><button id="cancelAlignment" class="text-button">Cancel</button></div><p class="hint">One-point alignment; other angles use ${f.profile==='mh7'?250:270}° tilt / ${f.profile==='beam200'?450:540}° pan travel estimates.</p>`)}</div>`;
}
function bindAlignment(f){
 const a=aligning;for(const k of ['pan','tilt']){$('#align-'+k).value=String(a[k+'Sign']);$('#align-'+k).onchange=e=>a[k+'Sign']=+e.target.value}
 const move=(i,value)=>{if(!Number.isFinite(value)||Math.abs(value)>720)return;a.virtual[i]=value;$(`[data-aim="${i}"]`).value=value;$(`[data-aim-number="${i}"]`).value=value};
 $$('[data-aim]').forEach(el=>el.oninput=()=>move(+el.dataset.aim,+el.value));$$('[data-aim-number]').forEach(el=>el.oninput=()=>move(+el.dataset.aimNumber,+el.value));
 $('#cancelAlignment').onclick=()=>{cancelAlignment();drawSide()};
 $('#saveAlignment').onclick=async()=>{try{await command('calibration.align',{...a,name:$('#alignmentName').value.trim()||'Stage alignment'});cancelAlignment();drawSide();toast('Alignment saved in the show and available to agents.')}catch{}};
}

// ── LED wall ──
function syncLedWall(){const wall=show.ledWall,item=mediaList().find(m=>m.id===wall?.media);stage.setLedWall(wall,item)}
function drawLedTray(){
 const tray=$('#ledTray');tray.hidden=!ledOpen;$('#ledButton').classList.toggle('active',ledOpen);if(!ledOpen)return;
 const wall=show.ledWall,items=mediaList();
 const tile=m=>`<div class="media-tile ${wall.media===m.id?'active':''}"><button data-media="${esc(m.id)}" title="${esc(m.name)}">${m.kind==='video'?`<span class="video-thumb">${icon('video')}</span>`:`<img src="${esc(m.src)}" alt="">`}<span>${esc(m.name)}</span></button>${show.media.some(x=>x.id===m.id)&&mode==='build'?`<button class="x" data-delete-media="${esc(m.id)}" aria-label="Delete ${esc(m.name)}">×</button>`:''}</div>`;
 tray.innerHTML=`<div class="tray-head"><strong>${icon('screen')}LED wall</strong><span class="hint">Preview only${runtime?.output.armed?' · video paused while output is live':''}</span><div class="segmented small">${['cover','contain','stretch'].map(f=>`<button data-fit="${f}" class="${wall.fit===f?'active':''}">${f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div><label class="tray-bright" title="Brightness">${icon('sun')}<input id="ledBrightness" type="range" min="0" max="1" step=".01" value="${wall.brightness}"></label><button class="round-button small" id="ledClose" aria-label="Close" data-icon="close"></button></div><div class="media-strip"><div class="media-tile ${wall.media==='off'?'active':''}"><button data-media="off"><span class="video-thumb off">${icon('moon')}</span><span>Off</span></button></div>${items.map(tile).join('')}<div class="media-tile"><button id="addMedia"><span class="video-thumb add">${icon('upload')}</span><span>Add image or video</span></button></div></div>`;
 fillIcons(tray);
 $$('[data-media]').forEach(b=>b.onclick=()=>quiet(command('ledwall.set',{media:b.dataset.media})));
 $$('[data-delete-media]').forEach(b=>b.onclick=()=>quiet(command('media.delete',{id:b.dataset.deleteMedia})));
 $$('[data-fit]').forEach(b=>b.onclick=()=>quiet(command('ledwall.set',{fit:b.dataset.fit})));
 $('#ledBrightness').onchange=e=>quiet(command('ledwall.set',{brightness:+e.target.value}));$('#ledBrightness').oninput=e=>stage.setLedWall({...show.ledWall,brightness:+e.target.value},mediaList().find(m=>m.id===show.ledWall.media));
 $('#ledClose').onclick=()=>{ledOpen=false;drawLedTray()};$('#addMedia').onclick=()=>$('#mediaFile').click();
}
$('#mediaFile').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>500e6)return toast('Media file exceeds 500 MB.');
 toast(`Uploading ${file.name}…`);
 try{const r=await fetch(`/api/media?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/,'').slice(0,100)||'Media')}&file=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'x-lights-token':token,'content-type':file.type||'application/octet-stream'},body:file});const v=await r.json();if(!r.ok)throw Error(v.error);await refresh();await command('ledwall.set',{media:v.created.media});toast('On the LED wall.')}catch(err){toast(err.message)}
};

// ── Dialogs ──
function dialog(title,html){$('#dialog').classList.remove('wide');clearInterval(patchTimer);clearInterval(netTimer);$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;fillIcons($('#dialogBody'));if(!$('#dialog').open)$('#dialog').showModal()}
function confirmDialog(title,text,action,run){dialog(title,`<p>${esc(text)}</p><div class="dialog-actions"><button class="ghost-button" id="confirmNo">Cancel</button><button class="primary danger" id="confirmYes">${esc(action)}</button></div>`);$('#confirmNo').onclick=()=>$('#dialog').close();$('#confirmYes').onclick=async()=>{try{await run();$('#dialog').close()}catch{}}}
// Save: update the playing cue (merge changes, keep its effects) or save a copy as a new cue after it.
function saveDialog(){
 const pb=runtime.playback,cue=pb&&show.cues.find(c=>c.id===pb.id),stack=runtime.stack,pg=stack?show.pages.find(p=>p.id===stack.page):page();
 const b=runtime.blind?.enabled,changed=new Set([...Object.keys(progOverrides(runtime)),...(b?[]:runtime.fx.flatMap(x=>x.fixtures))]).size,effects=b?0:runtime.fx.length;
 const usedOn=cue?show.pages.filter(p=>p.cues.some(e=>e.cue===cue.id)).length:0,liveName=stack?entryName(pg?.cues.find(e=>e.id===stack.entry)):cue?.name;
 dialog('Save changes',`<p class="hint">${changed} fixture${changed===1?'':'s'} changed${effects?` · ${effects} effect${effects===1?'':'s'}`:''}${b?' in blind':''}.</p><div class="save-options">
  ${cue?`<button class="save-option" data-save="update">${icon('save')}<div><strong>Update “${esc(liveName)}”</strong><small>Adds your changes to this cue — its own effects keep running.${usedOn>1?` Used on ${usedOn} pages, all get the update.`:''}</small></div></button>`:''}
  <div class="save-option as-new">${icon('plus')}<div><strong>Save as new cue</strong><small>${cue?`A copy of “${esc(liveName)}” plus your changes`:'The current look'}${pg?`, placed ${stack?'right after it':'at the end of'} “${esc(pg.name)}”${stack?' and run':''}`:''}.</small><div class="inline-form"><input id="saveName" type="text" maxlength="100" value="${esc(cue?liveName+' · alt':'New look')}" aria-label="New cue name"><button class="primary" data-save="new">Save new</button></div></div></div></div>
  ${cue?`<details class="more"><summary>${icon('sliders')}More</summary><button class="ghost-button" data-save="replace">${icon('record')}Replace “${esc(liveName)}” with the whole current look</button><p class="hint">Freezes everything you see — including running effects — into a still look.</p></details>`:''}`);
 const after=()=>{$('#dialog').close();viewSource=runtime.preview?'preview':'live';drawSide()};
 $$('[data-save]').forEach(btn=>btn.onclick=async()=>{const kind=btn.dataset.save;try{
  if(kind==='update'){await command('cue.record',{id:cue.id});toast(`“${liveName}” updated.`)}
  else if(kind==='replace'){await command('cue.record',{id:cue.id,mode:'replace'});toast(`“${liveName}” replaced with the current look.`)}
  else{const name=$('#saveName').value.trim()||'New look';const r=await command('cue.record',{id:uid('cue'),name,...(pg?{page:pg.id}:{}),...(stack?{after:stack.entry,go:true}:{})});if(pg){pageId=pg.id;store.set('page',pageId)}toast(`Saved “${name}”${pg?' to '+pg.name:''}.`)}
  after()}catch{}});
}
function recordDialog(){
 dialog('Record look',`<p class="hint">${runtime.blind?.enabled?'Captures the <strong>blind</strong> look (not what is live)':'Captures every patched fixture as it looks right now'} — colors, beams and positions — and adds it to “${esc(page().name)}”.</p><label class="mini"><span>Cue name</span><input id="lookName" type="text" placeholder="e.g. Curtain call"></label><label class="mini"><span>Fade in · seconds (0 = cut)</span><input id="lookFade" type="number" min="0" max="60" step=".5" value="2"></label><div class="dialog-actions"><button id="saveLook" class="primary"><span data-icon="record"></span>Record</button></div>`);
 $('#lookName').focus();$('#saveLook').onclick=async()=>{const name=$('#lookName').value.trim();if(!name)return toast('Name the cue first.');await command('look.capture',{id:uid('look'),name,page:pageId,fade:Math.max(0,Math.min(60,+$('#lookFade').value||0))});$('#dialog').close();toast('Look recorded into the cue list.')};
}
function presetDialog(){
 const presets=Object.entries(allPresets()),cats=[['intensity','Intensity'],['color','Color'],['movement','Movement']];let chosen=presets[0][0];
 const defaultGroup=group&&group!=='all'?group:'backlights';
 dialog('Add an effect',`<div class="preset-cats">${cats.map(([c,label])=>`<h3>${label}</h3><div class="preset-grid">${presets.filter(([,p])=>p.category===c).map(([id,p])=>`<button class="preset ${id===chosen?'active':''}" data-preset="${id}" title="${esc(p.description??schema.effects[p.effect].description)}">${icon(p.icon)}<span>${esc(p.name)}</span></button>`).join('')}</div>`).join('')}</div>
 <div class="form-grid"><label class="mini"><span>Fixture group</span><select id="presetGroup">${sortedGroups().map(g=>`<option value="${esc(g.id)}" ${g.id===defaultGroup?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><label class="mini"><span>Name</span><input id="presetName" type="text" placeholder="Auto"></label><label class="mini color"><span>Colors</span><span class="color-pair"><input id="presetColor" type="color" value="#52d3ff"><input id="presetSecondary" type="color" value="#b758ef"></span></label><label class="mini"><span>Speed</span><input id="presetSpeed" type="range" min=".05" max="4" step=".05" value="1"></label><label class="mini"><span>Level</span><input id="presetLevel" type="range" min="0" max="1" step=".01" value=".85"></label><label class="mini"><span>Length · s</span><input id="presetDuration" type="number" min=".5" max="3600" step="1" value="20"></label><label class="mini"><span>Fade in · s</span><input id="presetFade" type="number" min="0" max="60" step=".5" value="2"></label></div>
 <p class="hint" id="presetHint"></p><div class="dialog-actions"><button id="presetCustom" class="ghost-button"><span data-icon="sliders"></span>Custom effect…</button><button id="presetPreview" class="ghost-button"><span data-icon="eye"></span>Preview</button><button id="presetAdd" class="primary"><span data-icon="plus"></span>Add to page</button></div>`);
 const pick=id=>{chosen=id;const p=allPresets()[id];$$('[data-preset]').forEach(b=>b.classList.toggle('active',b.dataset.preset===id));if(p.params.color)$('#presetColor').value=p.params.color;if(p.params.secondary)$('#presetSecondary').value=p.params.secondary;$('#presetSpeed').value=p.params.speed??1;$('#presetLevel').value=p.params.brightness??.85;$('#presetDuration').value=p.duration;$('#presetHint').textContent=(p.description??schema.effects[p.effect].description)+(p.movers?' Needs moving heads.':'')};pick(chosen);
 $$('[data-preset]').forEach(b=>b.onclick=()=>pick(b.dataset.preset));
 const args=()=>({preset:chosen,group:$('#presetGroup').value,color:$('#presetColor').value,secondary:$('#presetSecondary').value,speed:+$('#presetSpeed').value,brightness:+$('#presetLevel').value,duration:Math.max(.5,+$('#presetDuration').value||20),...($('#presetName').value.trim()?{name:$('#presetName').value.trim()}:{})});
 $('#presetPreview').onclick=()=>{const a=args(),p=allPresets()[a.preset],params={...p.params,color:a.color,secondary:a.secondary,speed:a.speed,brightness:a.brightness},fades=p.effect==='fade'?0:.7;previewCue({cue:{id:'preset-preview',name:`${p.name} · preview`,duration:a.duration,loop:p.loop,...(p.hold?{hold:true}:{}),tracks:[{group:a.group,effect:p.effect,start:0,duration:a.duration,params,fadeIn:fades,fadeOut:p.loop?fades:0}]}}).then(()=>toast('Previewing in the visualizer only.'))};
 $('#presetAdd').onclick=async()=>{await command('effect.apply',{...args(),page:pageId,fade:Math.max(0,Math.min(60,+$('#presetFade').value||0))});$('#dialog').close();toast('Effect added to the cue list.')};
 $('#presetCustom').onclick=designer;
}
// ── Library (docs/MASTERS-AND-SCENES.md): every saved cue as a tile in the stage's place; the right panel is the
// selected cue's sheet, like opening a cue on a Hog: what it holds, how it plays, and everything that fires it.
let libQuery='',libFilter='all',libKey='',libCue=null,libPeek=false;
const pagesOf=id=>show.pages.filter(pg=>pg.cues.some(e=>e.cue===id)),mastersOf=id=>slots().filter(m=>m.cue===id);
const cueFixtures=c=>new Set([...(c.look??[]).map(e=>e.id),...c.tracks.flatMap(t=>t.fixtures??show.groups.find(g=>g.id===t.group)?.fixtures??[])]);
// Named triggers that play the cue directly, or GO a page entry that holds it.
const triggersOf=id=>(show.triggers??[]).filter(t=>t.command==='cue.play'&&t.args?.id===id||t.command==='page.go'&&t.args?.entry&&show.pages.find(p=>p.id===t.args.id)?.cues.find(e=>e.id===t.args.entry)?.cue===id);
const cueKind=c=>c.tracks.length?(c.look?.length?'Look + effects':c.tracks.length===1?'Effect':`${c.tracks.length} effects`):'Look';
const cueEnds=c=>c.loop?'Loops':c.hold?'Holds at the end':'Stops at the end';
function drawLibraryView(){
 const el=$('#libraryView');if(!el||!show)return;const n=show.cues.length;
 if(!$('#libGrid'))el.innerHTML=`<div class="lib-view-head"><div class="lib-title"><h2>Cue library</h2><span id="libCount"></span></div><input id="libSearch" type="search" placeholder="Search ${n} cues" aria-label="Search cues"><div class="lib-filters">${[['all','All'],['unused','Unused'],['masters','On masters'],['page','This page'],['effects','Effects'],['looks','Looks']].map(([f,l])=>`<button class="pill" data-lib-filter="${f}">${l}</button>`).join('')}</div><div class="lib-make"><button id="libRecord" class="chip-button"><span data-icon="record"></span>Record look</button><button id="libEffect" class="chip-button"><span data-icon="spark"></span>Effect cue</button></div></div><div class="lib-grid" id="libGrid"></div><p class="hint lib-foot">Click a cue to open it on the right. Drag it onto a master below to put it on that key.</p>`;
 fillIcons(el);$('#libSearch').value=libQuery;$$('[data-lib-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.libFilter===libFilter);b.onclick=()=>{libFilter=b.dataset.libFilter;drawLibraryView()}});
 $('#libSearch').oninput=e=>{libQuery=e.target.value;drawLibraryGrid()};$('#libRecord').disabled=!page();$('#libEffect').disabled=!page();$('#libRecord').onclick=recordDialog;$('#libEffect').onclick=presetDialog;
 drawLibraryGrid();
}
function drawLibraryGrid(){
 const el=$('#libGrid');if(!el)return;const p=page(),q=libQuery.trim().toLowerCase();
 const keep=c=>({unused:()=>!pagesOf(c.id).length&&!mastersOf(c.id).length&&!triggersOf(c.id).length,masters:()=>mastersOf(c.id).length>0,page:()=>!!p?.cues.some(e=>e.cue===c.id),effects:()=>c.tracks.length>0,looks:()=>!c.tracks.length}[libFilter]??(()=>true))();
 const list=show.cues.filter(c=>(!q||c.name.toLowerCase().includes(q)||(c.description??'').toLowerCase().includes(q))&&keep(c));setText($('#libCount'),list.length===show.cues.length?`${list.length} cues`:`${list.length} of ${show.cues.length}`);
 el.innerHTML=list.map(c=>{const pgs=pagesOf(c.id),ms=mastersOf(c.id),tr=triggersOf(c.id);
  return `<div class="lib-tile ${c.id===libCue?'selected':''}" draggable="true" data-lib-cue="${esc(c.id)}" tabindex="0" title="${esc(c.description??c.name)}"><div class="lt-top"><span class="pill-icon" data-icon="${c.tracks.length?'spark':'palette'}"></span><b class="live-dot" title="Running"></b><button class="round-button small eye" data-lib-preview="${esc(c.id)}" title="Preview on the stage (not live)" aria-label="Preview ${esc(c.name)}" data-icon="eye"></button></div><strong>${esc(c.name)}</strong><small>${cueKind(c)} · ${format(c.duration)} · ${c.loop?'loop':c.hold?'hold':'once'}</small><span class="lib-tags">${ms.map(m=>`<span class="tag key" title="Master ${slotIndex(m.id)+1} · ${ACTIONS[m.action][1]}">${m.key?esc(keyLabel(m.key)):'M'+(slotIndex(m.id)+1)}</span>`).join('')}${pgs.map(pg=>`<span class="tag" style="--page:${esc(pg.color??'#8bc9d0')}" title="On ${esc(pg.name)}">${esc(pg.name)}</span>`).join('')}${tr.length?`<span class="tag" title="Named triggers">${tr.length} trigger${tr.length===1?'':'s'}</span>`:''}${pgs.length||ms.length||tr.length?'':'<span class="tag muted">unused</span>'}</span></div>`}).join('')
  ||`<div class="panel-empty small"><p>${show.cues.length?'No cue matches.':'No cues yet. Record a look or make an effect cue.'}</p></div>`;
 fillIcons(el);libKey='';if(runtime)paintLibrary(runtime);
 $$('[data-lib-cue]').forEach(t=>{t.onclick=e=>{if(e.target.closest('button'))return;libCue=t.dataset.libCue;$$('[data-lib-cue]').forEach(x=>x.classList.toggle('selected',x===t));drawSide()};t.onkeydown=e=>{if(e.key==='Enter')t.click()};
  t.ondragstart=e=>{e.dataTransfer.setData('text/x-cue',t.dataset.libCue);e.dataTransfer.effectAllowed='copy'}});
 $$('[data-lib-preview]').forEach(b=>b.onclick=()=>peekCue(b.dataset.libPreview));
}
// Previewing from the library shows the stage (visualizer only, not live); Back to the library returns.
function peekCue(id){libPeek=true;applyStageView();previewCue({id,fade:1}).then(()=>toast('Previewing on the stage only, not live.'))}
// The cue sheet: what the cue holds, how it plays, where it is used and what fires it, with its actions.
function cueSheet(){
 const c=show.cues.find(x=>x.id===libCue);if(!c)return `<div class="panel-empty">${icon('library')}<p>Click a cue in the library to open it here: what it holds, how it plays, and every page, master and trigger that fires it.</p></div>`;
 const pgs=show.pages.flatMap(pg=>pg.cues.map((e,i)=>({pg,e,i})).filter(x=>x.e.cue===c.id)),ms=mastersOf(c.id),tr=triggersOf(c.id),fx=cueFixtures(c),running=(runtime.running??[]).some(r=>r.id===c.id);
 const sec=(title,body,count)=>`<section class="sheet-sec"><h3>${title}${count!==undefined?`<span>${count}</span>`:''}</h3>${body}</section>`;
 const used=[...pgs.map(({pg,e,i})=>`<li><span class="tag" style="--page:${esc(pg.color??'#8bc9d0')}">${esc(pg.name)}</span><span>Cue ${i+1}${e.label?` · “${esc(e.label)}”`:''}</span><small>${e.fade>0?`Fade ${e.fade}s`:'Cut'} · ${e.follow==='auto'?`then auto-follow after ${e.wait!==undefined?+e.wait.toFixed(2)+' s':format(c.duration)}`:'waits for GO'}${e.send?.length?` · sends ${e.send.map(x=>`${x.message} → ${esc(show.targets.find(t=>t.id===x.target)?.name??x.target)}`).join(', ')}`:''}</small></li>`),
  ...ms.map(m=>`<li><span class="tag key">${m.key?esc(keyLabel(m.key)):'–'}</span><span>Master ${slotIndex(m.id)+1}${m.label?` · “${esc(m.label)}”`:''}</span><small>${ACTIONS[m.action][1]}: ${ACTIONS[m.action][2]}${m.fade?` Fade ${m.fade}s.`:''}</small></li>`),
  ...tr.map(t=>`<li><span class="tag">Trigger</span><span>${esc(t.name)}</span><small>OSC <code>/stagelight/trigger ${esc(t.name)}</code>${t.description?' · '+esc(t.description):''}</small></li>`)].join('');
 const tracks=c.tracks.map(t=>{const p=t.params??{},sw=[p.color,p.secondary].filter(Boolean).map(h=>`<i class="sw" style="background:${esc(h)}"></i>`).join('');return `<li><span class="pill-icon" data-icon="${esc(schema.effects[t.effect]?.icon??'spark')}"></span><span>${esc(schema.effects[t.effect]?.name??t.effect)} on ${t.group?esc(show.groups.find(g=>g.id===t.group)?.name??t.group):t.fixtures.length+' fixtures'}${sw}</span><small>${format(t.start)}–${format(t.start+t.duration)} · in ${t.fadeIn??0}s / out ${t.fadeOut??0}s${t.layer?' · on top of the '+t.layer:''}${p.speed!==undefined?` · speed ${p.speed}`:''}${p.brightness!==undefined?` · level ${Math.round(p.brightness*100)}%`:''}</small></li>`}).join('');
 const pct=v=>Math.round(v*100)+'%',extra=v=>[v.gobo?`gobo ${v.gobo}`:'',v.prism?`prism ${v.prism}`:'',v.frost?`frost ${pct(v.frost)}`:'',v.zoom!==undefined?`zoom ${pct(v.zoom)}`:'',v.white?`white ${pct(v.white)}`:'',v.opticalMode?v.opticalMode:''].filter(Boolean).join(' · ');
 const look=(c.look??[]).slice().sort((a,b)=>(b.values.intensity??0)-(a.values.intensity??0)),lit=look.filter(e=>(e.values.intensity??0)>0).length,cap=libShowAll?look.length:40;
 const lookRows=look.slice(0,cap).map(e=>{const v=e.values,f=fixture(e.id);return `<tr><td>${esc(e.id)}</td><td>${v.intensity!==undefined?pct(v.intensity):''}</td><td>${v.color?`<i class="sw" style="background:${esc(v.color)}"></i>`:''}</td><td>${v.pan!==undefined&&f&&MOVERS.includes(f.profile)?`${pct(v.pan)} / ${pct(v.tilt??0)}`:''}</td><td>${esc(extra(v))}</td></tr>`}).join('');
 return `<div class="cue-sheet"><div class="sheet-head"><span class="pill-icon" data-icon="${c.tracks.length?'spark':'palette'}"></span><div><input id="sheetName" value="${esc(c.name)}" aria-label="Cue name" maxlength="100"><small>${cueKind(c)} · ${fx.size} fixtures${running?' · <b class="go-text">running</b>':''}</small></div></div>
  <div class="sheet-actions"><button class="chip-button" id="sheetPreview"><span data-icon="eye"></span>Preview</button><button class="chip-button" id="sheetMaster"><span data-icon="masters"></span>Put on a master</button><button class="chip-button" id="sheetAdd" ${page()?'':'disabled'}><span data-icon="plus"></span>Add to ${esc(page()?.name??'page')}</button><button class="chip-button danger" id="sheetDelete"><span data-icon="trash"></span>Delete</button></div>
  <div class="sheet-body">${sec('How it plays',`<dl class="sheet-dl"><dt>Length</dt><dd>${format(c.duration)} (${+c.duration.toFixed(2)} s)</dd><dt>At the end</dt><dd>${cueEnds(c)}</dd><dt>Fixtures</dt><dd>${fx.size}${look.length?` · ${lit} lit in its look`:''}</dd>${c.description?`<dt>Notes</dt><dd>${esc(c.description)}</dd>`:''}</dl><p class="hint">Fade and follow are set where the cue is used: per page entry (fade, auto-follow, sends) and per master (action and fade).</p>`)}
  ${sec('Fired by',used?`<ul class="sheet-list">${used}</ul>`:'<p class="hint">Nothing fires this cue yet. Add it to a page, put it on a master, or name a trigger for it in Network &amp; triggers.</p>',pgs.length+ms.length+tr.length)}
  ${sec('Remote control',`<ul class="sheet-list"><li><span class="tag">OSC</span><span><code>/stagelight/play ${esc(c.id)}</code></span><small>Plays it outside any page, from LiveStage or another app (port ${show.settings.osc?.port??1461}).</small></li><li><span class="tag">MCP</span><span><code>lights_cue_play {id:"${esc(c.id)}"}</code></span><small>Cue ID for agents and triggers.</small></li></ul>`)}
  ${c.tracks.length?sec('Effects',`<ul class="sheet-list">${tracks}</ul>`,c.tracks.length):''}
  ${look.length?sec('Look',`<table class="sheet-table"><thead><tr><th>Fixture</th><th>Level</th><th>Colour</th><th>Pan / tilt</th><th>Beam</th></tr></thead><tbody>${lookRows}</tbody></table>${look.length>cap?`<button class="ghost-button small" id="sheetAll">Show all ${look.length} fixtures</button>`:''}`,look.length):''}</div></div>`;
}
let libShowAll=false;
function bindLibrary(){
 const c=mode==='library'&&show.cues.find(x=>x.id===libCue);if(!c||!$('#sheetName'))return;
 $('#sheetName').onchange=e=>{const name=e.target.value.trim();if(name&&name!==c.name)quiet(command('cue.save',{cue:{...structuredClone(c),name}}))};
 $('#sheetPreview').onclick=()=>peekCue(c.id);$('#sheetMaster').onclick=()=>masterPicker(c.id);
 $('#sheetAdd').onclick=async()=>{const pg=structuredClone(page());pg.cues.push({id:uid('entry'),cue:c.id,fade:2,follow:'manual'});await quiet(savePage(pg));toast(`Added to “${pg.name}”.`)};
 $('#sheetDelete').onclick=()=>{const n=pagesOf(c.id).length,m=mastersOf(c.id).length,t=triggersOf(c.id).length,uses=[n?`${n} page${n===1?'':'s'}`:'',m?`${m} master${m===1?'':'s'}`:'',t?`${t} trigger${t===1?'':'s'}`:''].filter(Boolean);
  confirmDialog(`Delete “${c.name}”?`,`It is removed from the library${uses.length?' and from '+uses.join(', '):''}.${t?' Triggers that play it will report an unknown cue.':''}`,'Delete cue',async()=>{await command('cue.delete',{id:c.id});libCue=null;drawSide()})};
 if($('#sheetAll'))$('#sheetAll').onclick=()=>{libShowAll=true;drawSide()};
}
function paintLibrary(r){
 if(mode!=='library')return;const ids=(r.running??[]).map(c=>c.id),key=ids.join('|');if(key===libKey)return;libKey=key;
 for(const t of $$('[data-lib-cue]'))t.classList.toggle('running',ids.includes(t.dataset.libCue));
}

// ── Masters (docs/MASTERS-AND-SCENES.md): slots under the stage that fire a cue from a key, through masters.trigger ──
// Flash (default) plays while the key is held; toggle, go, pause and release act on a press. The key sits bold in the
// slot's corner: click it and press another key to change it. A key someone else has gets a Swap / Take it choice.
const ACTIONS={flash:['bolt','Flash','Hold the key: the cue plays. Let go: it stops.'],toggle:['toggle','Toggle','Press: the cue plays. Press again: it stops.'],go:['play','Go','Press: the cue plays from the top. Pressing again restarts it.'],pause:['pause','Pause','Press: the running cue freezes. Press again: it carries on.'],release:['stop','Release','Press: the running cue stops, fading out over the fade time.']};
const DESK_NAMES={highlight:'Highlight',clear:'Clear',blackout:'Blackout'};
let learning=null,conflict=null,masterQueue=Promise.resolve();const heldMasters=new Set(),heldKeys=new Map();
const slots=()=>show?.masters?.slots??[],slotIndex=id=>slots().findIndex(m=>m.id===id),slotOf=id=>slots().find(m=>m.id===id);
const slotCue=m=>m?.cue?show.cues.find(c=>c.id===m.cue):null,slotName=m=>m.label??slotCue(m)?.name??'';
// The pane under the stage shows the fixture buttons or the masters (per viewer). Library mode always shows the masters.
const paneShown=()=>mode==='library'?'masters':pane;
function setPane(p){pane=p;store.set('bottomPane',p);applyPane()}
function applyPane(){
 const p=paneShown();$('.fixture-strip').hidden=p!=='fixtures';$('#mastersPane').hidden=p!=='masters';
 $$('[data-pane]').forEach(b=>{const on=b.dataset.pane===p;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));b.title=(on?'Hide the ':'Show the ')+(b.dataset.pane==='masters'?'masters':'fixture buttons')+' under the stage'});
 if(p==='masters')paintBank();
}
function drawMasters(){
 const el=$('#masterBank');if(!el||!show)return;
 el.innerHTML=slots().map((m,i)=>{const cue=slotCue(m),[ic,label,hint]=ACTIONS[m.action],learn=learning===m.id,c=conflict?.slot===m.id?conflict:null;
  return `<div class="master-slot ${cue?'':'empty'} ${learn?'learning':''}" data-master="${esc(m.id)}" title="Master ${i+1}${cue?` · ${label}: ${hint}`:' · click to choose a cue'}"><button class="m-key ${m.key?'':'none'}" data-master-key="${esc(m.id)}" title="${m.key?'Click, then press a new key':'Click, then press a key for this master'}">${learn?'Press a key…':m.key?esc(keyLabel(m.key)):'+ key'}</button>${cue?`<span class="m-action" title="${label}">${icon(ic)}</span>`:''}<button class="m-edit" data-master-edit="${esc(m.id)}" title="Cue, action, fade and key" aria-label="Edit master ${i+1}" data-icon="sliders"></button>${cue?`<strong class="m-name">${esc(slotName(m))}</strong><span class="m-state"><em></em><i><b></b></i></span>`:`<span class="m-empty">${icon('plus')}Assign cue</span>`}${c?`<div class="m-conflict" role="alert"><p><strong>${esc(keyLabel(c.key))}</strong> ${c.owner}</p><div>${c.swap?`<button class="chip-button" data-conflict="swap" title="${esc(c.swap)}">Swap</button>`:''}<button class="chip-button accent" data-conflict="take">Take it</button><button class="chip-button" data-conflict="cancel">Cancel</button></div></div>`:''}</div>`}).join('')
  +(slots().length<60?`<button class="master-slot add-slot" id="addMaster" title="Add a master">${icon('plus')}Add master</button>`:'');
 fillIcons(el);bindMasters();paintBank();if(runtime)paintMasters(runtime,true);
}
function bindMasters(){
 $$('[data-master]').forEach(el=>{const id=el.dataset.master,up=()=>releaseMaster(id);
  el.onpointerdown=e=>{if(e.button!==0||e.target.closest('button,.m-conflict')||!slotCue(slotOf(id)))return;e.preventDefault();el.setPointerCapture(e.pointerId);pressMaster(id)};
  el.onpointerup=up;el.onpointercancel=up;el.onlostpointercapture=up;
  el.onclick=e=>{if(!e.target.closest('button,.m-conflict')&&!slotCue(slotOf(id)))cuePicker(id)};
  el.oncontextmenu=e=>{e.preventDefault();openMasterPop(id,el)};
  el.ondragover=e=>{if(e.dataTransfer.types.includes('text/x-cue')){e.preventDefault();el.classList.add('drop')}};el.ondragleave=()=>el.classList.remove('drop');
  el.ondrop=e=>{el.classList.remove('drop');const cue=e.dataTransfer.getData('text/x-cue');if(cue){e.preventDefault();assignMaster(id,cue)}};
 });
 $$('[data-master-key]').forEach(b=>b.onclick=e=>{e.stopPropagation();startLearning(b.dataset.masterKey)});
 $$('[data-master-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openMasterPop(b.dataset.masterEdit,b.closest('[data-master]'))});
 $$('[data-conflict]').forEach(b=>b.onclick=e=>{e.stopPropagation();resolveConflict(b.dataset.conflict)});
 if($('#addMaster'))$('#addMaster').onclick=addMaster;
}
// Presses go out one after another, so a quick tap's let-go can never overtake its press.
function sendMaster(slot,down){masterQueue=masterQueue.then(()=>command('masters.trigger',{slot,down})).catch(()=>{});return masterQueue}
function pressMaster(id){if(heldMasters.has(id))return;heldMasters.add(id);sendMaster(id,true)}
function releaseMaster(id){if(heldMasters.delete(id))sendMaster(id,false)}
function releaseAllMasters(){heldKeys.clear();for(const id of [...heldMasters])releaseMaster(id)}
function assignMaster(id,cueId){const m=slotOf(id),cue=show.cues.find(c=>c.id===cueId);quiet(command('masters.assign',{slot:id,cue:cueId}).then(()=>toast(`Master ${slotIndex(id)+1}${m.key?` (${keyLabel(m.key)})`:''}: ${ACTIONS[m.action][1].toLowerCase()} “${cue.name}”.${m.key&&m.action==='flash'?` Hold ${keyLabel(m.key)} to flash it.`:''}`)))}
function addMaster(){const n=Math.max(0,...slots().map(m=>+(/^m(\d+)$/.exec(m.id)?.[1]??0)))+1;quiet(command('masters.save',{slots:[...structuredClone(slots()),{id:'m'+n,action:'flash',fade:0}]}).then(()=>$('#masterBank').scrollTo({left:1e6,behavior:'smooth'})))}
function cuePicker(id){
 const m=slotOf(id);
 dialog(`Cue for master ${slotIndex(id)+1}${m.key?' · '+keyLabel(m.key):''}`,`<input id="pickSearch" type="search" placeholder="Search the cue library" aria-label="Search cues"><div class="pool-list pick-list" id="pickList"></div><p class="hint">${ACTIONS[m.action][1]}: ${ACTIONS[m.action][2]} Change what it does with ${icon('sliders')} on the master.</p>`);
 const draw=()=>{const q=$('#pickSearch').value.trim().toLowerCase();$('#pickList').innerHTML=show.cues.filter(c=>!q||c.name.toLowerCase().includes(q)).map(c=>`<button class="pool-row" data-pick="${esc(c.id)}"><span class="pill-icon" data-icon="${c.tracks.length?'spark':'palette'}"></span><strong>${esc(c.name)}</strong><small>${format(c.duration)}${c.loop?' · loop':''}</small></button>`).join('')||'<p class="hint">No cue matches.</p>';fillIcons($('#pickList'));$$('[data-pick]').forEach(b=>b.onclick=()=>{$('#dialog').close();assignMaster(id,b.dataset.pick)})};
 $('#pickSearch').oninput=draw;draw();$('#pickSearch').focus();
}
function masterPicker(cueId){
 const cue=show.cues.find(c=>c.id===cueId);
 dialog(`Put “${cue.name}” on a master`,`<div class="slot-pick">${slots().map((m,i)=>`<button class="slot-choice ${m.cue?'':'free'}" data-pick-slot="${esc(m.id)}"><b>${m.key?esc(keyLabel(m.key)):'–'}</b><span>Master ${i+1}</span><small>${m.cue?esc(slotName(m)):'empty'}</small></button>`).join('')}</div><p class="hint">Masters flash by default: hold the key and the cue plays, let go and it stops.</p>`);
 $$('[data-pick-slot]').forEach(b=>b.onclick=()=>{$('#dialog').close();assignMaster(b.dataset.pickSlot,cueId)});
}
// Key learning: the next key pressed becomes the slot's key. Esc cancels, Delete or Backspace removes the key.
function startLearning(id){closeMasterPop();learning=id;conflict=null;if(paneShown()!=='masters')setPane('masters');drawMasters()}
function learnKey(e){
 const id=learning,m=slotOf(id);if(['Shift','Meta','Control','Alt','CapsLock'].includes(e.key))return;
 if(e.key==='Escape'||!m){learning=null;drawMasters();return}
 if(e.code==='Delete'||e.code==='Backspace'){learning=null;quiet(command('masters.key',{slot:id,clear:true}));drawMasters();return}
 const why=reservedReason(e);if(why)return toast(why+'. Press another key, or Esc to cancel.');
 const key=keyOf(e);learning=null;if(key===m.key)return drawMasters();
 const other=slots().find(x=>x.id!==id&&x.key===key),desk=Object.keys(show.masters.desk).find(k=>show.masters.desk[k]===key);
 if(!other&&!desk){quiet(command('masters.key',{slot:id,key}));return drawMasters()}
 const owner=other?`Master ${slotIndex(other.id)+1}`:DESK_NAMES[desk];
 conflict={slot:id,key,owner:other?`is on ${owner}${slotName(other)?' · '+esc(slotName(other)):''}.`:`is the ${owner} key. ${owner} keeps its button.`,swap:m.key?`${owner} gets ${keyLabel(m.key)}`:''};
 drawMasters();
}
function resolveConflict(how){const c=conflict;conflict=null;if(c&&how!=='cancel')quiet(command('masters.key',{slot:c.slot,key:c.key,conflict:how}));drawMasters()}
function openMasterPop(id,anchor){
 const m=slotOf(id),cue=slotCue(m),pop=$('#masterPop');if(!m)return;learning=null;
 pop.innerHTML=`<div class="mp-head"><strong>Master ${slotIndex(id)+1}</strong><button class="m-key ${m.key?'':'none'}" id="mpKey" title="Click, then press a key">${m.key?esc(keyLabel(m.key)):'+ key'}</button><button class="round-button small" id="mpClose" aria-label="Close" data-icon="close"></button></div>
  <label class="field-label">Cue</label><button class="chip-button wide mp-cue" id="mpCue"><span data-icon="${cue?.tracks?.length?'spark':'palette'}"></span><span>${cue?esc(cue.name):'Choose a cue…'}</span>${cue?'<small>Change</small>':''}</button>
  <label class="field-label">When the key is pressed</label><div class="segmented mp-actions">${Object.entries(ACTIONS).map(([a,[ic,label,hint]])=>`<button data-mp-action="${a}" class="${m.action===a?'active':''}" title="${esc(hint)}"><span data-icon="${ic}"></span>${label}</button>`).join('')}</div><p class="hint" id="mpHint">${ACTIONS[m.action][2]}</p>
  <div class="mp-row"><label class="mini"><span>Fade · s</span><input id="mpFade" type="number" min="0" max="60" step=".5" value="${m.fade??0}"></label><label class="mini"><span>Label</span><input id="mpLabel" type="text" maxlength="40" value="${esc(m.label??'')}" placeholder="${esc(cue?.name??'Cue name')}"></label></div>
  ${cue?`<button class="ghost-button small danger" id="mpClear"><span data-icon="trash"></span>Clear this master</button>`:''}`;
 pop.hidden=false;fillIcons(pop);
 const r=anchor.getBoundingClientRect(),pr=pop.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(r.left,innerWidth-pr.width-8))+'px';pop.style.top=Math.max(8,r.top-pr.height-10)+'px';
 $('#mpClose').onclick=closeMasterPop;$('#mpKey').onclick=()=>startLearning(id);$('#mpCue').onclick=()=>{closeMasterPop();cuePicker(id)};
 $$('[data-mp-action]').forEach(b=>b.onclick=()=>{$$('[data-mp-action]').forEach(x=>x.classList.toggle('active',x===b));setText($('#mpHint'),ACTIONS[b.dataset.mpAction][2]);quiet(command('masters.assign',{slot:id,action:b.dataset.mpAction}))});
 $('#mpFade').onchange=e=>quiet(command('masters.assign',{slot:id,fade:Math.max(0,Math.min(60,+e.target.value||0))}));
 $('#mpLabel').onchange=e=>quiet(command('masters.assign',{slot:id,label:e.target.value.trim()}));
 if($('#mpClear'))$('#mpClear').onclick=()=>{closeMasterPop();quiet(command('masters.assign',{slot:id,clear:true}))};
}
function closeMasterPop(){$('#masterPop').hidden=true}
// Bank paging: the arrow keys or the chevrons move by as many masters as fit.
function paintBank(){
 const el=$('#masterBank');if(!el||$('#mastersPane').hidden)return;const first=el.querySelector('.master-slot'),w=(first?.getBoundingClientRect().width??124)+8,n=slots().length;
 const from=Math.min(n,Math.round(el.scrollLeft/w)+1),to=Math.min(n,Math.floor((el.scrollLeft+el.clientWidth+8)/w));
 setText($('#bankCount'),n?`${from}–${Math.max(from,to)} of ${n}`:'');$('#bankPrev').disabled=el.scrollLeft<=2;$('#bankNext').disabled=el.scrollLeft+el.clientWidth>=el.scrollWidth-2;
}
function pageBank(dir){const el=$('#masterBank');el.scrollBy({left:dir*el.clientWidth,behavior:'smooth'})}
// Live state per slot: Held (a flash is down), Running, Paused, with the cue's progress. Only changed slots are touched.
function paintMasters(r,force=false){
 if(!show||$('#mastersPane').hidden)return;const running=new Map((r.running??[]).map(c=>[c.id,c])),held=new Set(r.masters?.held??[]);
 for(const el of $$('[data-master]')){const m=slotOf(el.dataset.master);if(!m?.cue)continue;const c=running.get(m.cue),st=held.has(m.id)?'held':c?(c.paused?'paused':'running'):'idle';
  if(force||el.dataset.st!==st){el.dataset.st=st;el.classList.toggle('held',st==='held');el.classList.toggle('running',st!=='idle'&&st!=='paused');el.classList.toggle('paused',st==='paused');setText(el.querySelector('.m-state em'),{held:'Held',running:'Running',paused:'Paused',idle:''}[st])}
  const bar=el.querySelector('.m-state b'),w=c?Math.min(100,c.elapsed/c.duration*100).toFixed(1)+'%':'0%';if(bar&&bar.style.width!==w)bar.style.width=w}
}
function designer(){
 dialog('Custom effect',`<div class="form-grid"><label class="mini"><span>Name</span><input id="fxName" value="My light study" type="text"></label><label class="mini"><span>Group</span><select id="fxGroup">${sortedGroups().map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></label><label class="mini"><span>Effect</span><select id="fxType">${Object.entries(schema.effects).map(([id,d])=>`<option value="${id}">${esc(d.name)}</option>`).join('')}</select></label><label class="mini"><span>Duration · s</span><input id="fxDuration" type="number" value="20" min="1" max="3600"></label><label class="mini color"><span>Colors</span><span class="color-pair"><input id="fxColor" type="color" value="#52d3ff"><input id="fxSecondary" type="color" value="#b758ef"></span></label><label class="mini"><span>Speed</span><input id="fxSpeed" type="range" min=".05" max="4" step=".05" value=".8"></label><label class="mini"><span>Level</span><input id="fxIntensity" type="range" min="0" max="1" step=".01" value=".7"></label></div><p class="hint">Agents can build any multi-track cue with lights_cue_save; this form covers one track.</p><div class="dialog-actions"><button id="fxPreview" class="ghost-button"><span data-icon="eye"></span>Preview</button><button id="fxSave" class="primary"><span data-icon="plus"></span>Save &amp; add to page</button></div>`);
 $('#fxGroup').value=group&&group!=='all'?group:'backlights';$('#fxType').value='chase';
 const params=()=>({color:$('#fxColor').value,secondary:$('#fxSecondary').value,speed:+$('#fxSpeed').value,brightness:+$('#fxIntensity').value});
 $('#fxPreview').onclick=()=>{const duration=+$('#fxDuration').value;previewCue({cue:{id:'custom-preview',name:$('#fxName').value||'Custom effect',duration,loop:true,tracks:[{group:$('#fxGroup').value,effect:$('#fxType').value,start:0,duration,params:params(),fadeIn:.7,fadeOut:.7}]}}).then(()=>toast('Previewing in the visualizer only.'))};
 $('#fxSave').onclick=async()=>{const name=$('#fxName').value,id=uid('cue'),g=$('#fxGroup').value,type=$('#fxType').value,duration=+$('#fxDuration').value,p=params();await command('cue.save',{cue:{id,name,duration,loop:true,tracks:[{group:g,effect:type,start:0,duration,params:p,fadeIn:.7,fadeOut:.7}]}});if(page()){const pg=structuredClone(page());pg.cues.push({id:uid('entry'),cue:id,fade:2,follow:'manual'});await savePage(pg)}$('#dialog').close();toast('Effect saved to the library and page.')};
}
function editCue(cueId){
 const cue=structuredClone(show.cues.find(c=>c.id===cueId));if(!cue)return;
 dialog('Edit cue',`<label class="mini"><span>Name</span><input id="editName" type="text" value="${esc(cue.name)}"></label><div class="form-grid"><label class="mini"><span>Length · s</span><input id="editDuration" type="number" min=".1" max="3600" step=".5" value="${cue.duration}"></label><label class="check"><input id="editLoop" type="checkbox" ${cue.loop?'checked':''}>Loop</label><label class="check"><input id="editHold" type="checkbox" ${cue.hold?'checked':''}>Hold last frame</label></div>${cue.tracks.length?`<label class="mini"><span>Track</span><select id="editTrack">${cue.tracks.map((t,i)=>`<option value="${i}">${t.start}s · ${esc(t.group)} · ${esc(schema.effects[t.effect]?.name??t.effect)}</option>`).join('')}</select></label><div id="trackFields"></div>`:'<p class="hint">A recorded still look. Adjust fixtures and record a new look to change it, or edit the definition below.</p>'}<details class="more"><summary>${icon('edit')}Full cue definition</summary><textarea id="cueJson" spellcheck="false">${esc(JSON.stringify(cue,null,2))}</textarea><button id="saveJson" class="ghost-button">Validate &amp; save definition</button></details><div class="dialog-actions"><button id="cueSave" class="primary"><span data-icon="save"></span>Save cue</button></div>`);
 const sync=()=>{$('#cueJson').value=JSON.stringify(cue,null,2)};
 const draw=()=>{const t=cue.tracks[+$('#editTrack').value];$('#trackFields').innerHTML=`<div class="form-grid"><label class="mini color"><span>Color</span><input id="editColor" type="color" value="${t.params.color??'#6ddcff'}"></label><label class="mini"><span>Speed</span><input id="editSpeed" type="number" min=".05" max="4" step=".05" value="${t.params.speed??1}"></label><label class="mini"><span>Level</span><input id="editIntensity" type="range" min="0" max="1" step=".01" value="${t.params.brightness??.8}"></label><label class="mini"><span>Position A</span><select id="editPoint"><option value="">Fixture home</option>${show.points.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label></div>`;$('#editPoint').value=t.params.pointA??'';for(const el of ['editColor','editSpeed','editIntensity','editPoint'])$('#'+el).onchange=()=>{t.params.color=$('#editColor').value;t.params.speed=+$('#editSpeed').value;t.params.brightness=+$('#editIntensity').value;if($('#editPoint').value)t.params.pointA=$('#editPoint').value;else delete t.params.pointA;sync()}};
 if(cue.tracks.length){draw();$('#editTrack').onchange=draw}
 $('#cueSave').onclick=async()=>{cue.name=$('#editName').value;cue.duration=+$('#editDuration').value;cue.loop=$('#editLoop').checked;if($('#editHold').checked)cue.hold=true;else delete cue.hold;for(const t of cue.tracks)if(t.start+t.duration>cue.duration)t.duration=Math.max(.1,cue.duration-t.start);await command('cue.save',{cue});$('#dialog').close();toast('Saved. The next GO uses the new version.')};
 $('#saveJson').onclick=async()=>{try{await command('cue.save',{cue:JSON.parse($('#cueJson').value)});$('#dialog').close();toast('Cue validated and saved.')}catch(e){toast(e.message)}};
}
function connection(){const o=runtime.output;dialog('Connection & diagnostics',`<div class="form-grid"><label class="mini"><span>Mac Ethernet address</span><select id="sourceIP">${[...new Set([show.settings.source,...o.interfaces.map(i=>i.address)])].map(ip=>`<option>${esc(ip)}</option>`).join('')}</select></label><label class="mini"><span>Hog FixtureNet address</span><input id="targetIP" type="text" value="${esc(show.settings.target)}"></label>${[1,2,3,4,5,6,7,8].map(u=>`<label class="mini"><span>Hog ${u} → Art-Net</span><input data-mapping="${u}" type="number" min="0" max="32767" placeholder="Not routed" value="${show.settings.mappings[u]??''}"></label>`).join('')}</div><button id="saveConnection" class="ghost-button"><span data-icon="save"></span>Save connection</button><dl class="diagnostic"><dt>Output</dt><dd>${o.armed?'Sending':'Disarmed'}</dd><dt>Receiver</dt><dd>Unconfirmed · UDP has no acknowledgment</dd><dt>Packets sent</dt><dd>${o.packets.toLocaleString()}</dd><dt>Last send error</dt><dd>${esc(o.lastError??'None')}</dd><dt>Engine delays</dt><dd>${runtime.slowFrames} intervals over 100 ms</dd><dt>Unreviewed movers</dt><dd>${show.fixtures.filter(f=>f.profile==='rogue'&&!f.calibration.reviewed).length} · spatial calibration pending</dd></dl><details class="more"><summary>${icon('list')}Recent events</summary><pre>${runtime.logs.map(l=>esc(l.at.slice(11,19)+' '+l.message)).join('\n')}</pre></details><p><a href="/help/hog-setup.html" target="_blank">Hog connection field guide ↗</a></p>`);$('#sourceIP').value=show.settings.source;$('#saveConnection').onclick=async()=>{await command('output.configure',{source:$('#sourceIP').value,target:$('#targetIP').value,mappings:Object.fromEntries($$('[data-mapping]').filter(e=>e.value.trim()!=='').map(e=>[e.dataset.mapping,+e.value]))});toast('Network settings saved.')}}
// Connect an agent: exact config for this Mac, copy buttons, and a live Connected state from agent.hello.
let connectInfo=null,connectClient=store.get('connectClient','claude-code');
const CLIENTS={
 'claude-code':{label:'Claude Code',where:'Run this once in a terminal. The agent picks it up in new sessions (or run /mcp in an open one).',snippet:c=>`claude mcp add ${c.name} -s user -e LIGHTS_URL=${c.url} -- "${c.node}" "${c.server}"`},
 'claude-desktop':{label:'Claude Desktop / Cursor',where:'Paste into Claude Desktop → Settings → Developer → Edit Config (claude_desktop_config.json), or Cursor’s ~/.cursor/mcp.json, then restart the app.',snippet:c=>JSON.stringify({mcpServers:{[c.name]:{command:c.node,args:[c.server],env:{LIGHTS_URL:c.url}}}},null,2)},
 'codex':{label:'Codex',where:'Add to ~/.codex/config.toml, then start a new Codex session.',snippet:c=>`[mcp_servers.${c.name}]\ncommand = "${c.node}"\nargs = ["${c.server}"]\nenv = { LIGHTS_URL = "${c.url}" }`},
 'other':{label:'Other',where:'Any MCP client that runs a local stdio server: command, arguments and one environment variable.',snippet:c=>`command: ${c.node}\nargs:    ${c.server}\nenv:     LIGHTS_URL=${c.url}`}
};
const agentBrief=()=>`You are connected to StageLight, a lighting desk, through its MCP server "stagelight" (tools named lights_*).
Start every session with lights_schema (commands, effects, presets, icons) and lights_status (show, pages, cue lists, fixtures, groups, what is live right now).
How the desk works: pages are scenes with cue lists (lights_page_save, lights_page_go). Effects layer on the current look (lights_fx_preview, then lights_fx_apply). Save changes into cues with lights_cue_record. Custom effects go in the library with lights_preset_save. lights_patch_report shows every fixture and its DMX.
Rules: preview first (lights_fx_preview, lights_preview_cue or lights_blind_set) and tell me what you see before anything goes live. Never call lights_output_arm unless I explicitly ask for physical output. A sent Art-Net packet is not proof a light responded. Do not invent fixture channel maps.`;
async function copyText(text,button){try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();document.execCommand('copy');t.remove()}const label=button.innerHTML;button.innerHTML=`${icon('check')}Copied`;setTimeout(()=>{if(button.isConnected)button.innerHTML=label},1500)}
async function agentHelp(){
 try{connectInfo??=await fetch('/api/connect').then(r=>r.json())}catch{return toast('Could not read connection details from the engine.')}
 const c=connectInfo,cl=CLIENTS[connectClient]??CLIENTS['claude-code'];
 dialog('Connect an agent',`<div id="agentStatus" class="agent-status"></div>
 <ol class="steps"><li><div class="step-head"><b>1</b><strong>Add StageLight to your agent</strong></div><div class="segmented small client-tabs">${Object.entries(CLIENTS).map(([k,v])=>`<button data-client="${k}" class="${k===connectClient?'active':''}">${esc(v.label)}</button>`).join('')}</div><p class="hint">${esc(cl.where)}</p><div class="copy-block"><pre id="clientSnippet">${esc(cl.snippet(c))}</pre><button class="chip-button accent" id="copySnippet">${icon('copy')}Copy</button></div></li>
 <li><div class="step-head"><b>2</b><strong>Reload the agent</strong></div><p class="hint">Restart it or reload its MCP servers. This window turns to <em>Connected</em> as soon as StageLight hears from it.</p></li>
 <li><div class="step-head"><b>3</b><strong>Give it its instructions</strong></div><p class="hint">Paste this as your first message so it knows how StageLight works and the safety rules.</p><div class="copy-block"><pre class="brief">${esc(agentBrief())}</pre><button class="chip-button accent" id="copyBrief">${icon('copy')}Copy instructions</button></div></li></ol>
 <details class="more"><summary>${icon('list')}All ${Object.values(schema.commands).filter(x=>!x.internal).length} tools</summary><pre id="mcpTools"></pre></details><p class="hint">Engine ${esc(c.url)} · MCP server ${esc(c.server)} · <a href="/help/agent-api.html" target="_blank">API and MCP reference ↗</a></p>`);
 $('#mcpTools').textContent=Object.entries(schema.commands).filter(([,x])=>!x.internal).map(([k])=>'lights_'+k.replaceAll('.','_')).join('\n');
 $$('[data-client]').forEach(b=>b.onclick=()=>{connectClient=b.dataset.client;store.set('connectClient',connectClient);agentHelp()});
 $('#copySnippet').onclick=e=>copyText(cl.snippet(c),e.currentTarget);$('#copyBrief').onclick=e=>copyText(agentBrief(),e.currentTarget);
 paintAgentStatus(runtime);
}
function paintAgentStatus(r){
 const agents=r?.agents??[];$('#agentChip').hidden=!agents.length;setText($('#agentChip span:last-child'),agents.length>1?`${agents.length} agents`:agents.length?'Agent connected':'');$('#agentChip').title=agents.map(a=>a.client+(a.version?' '+a.version:'')).join(', ');
 const el=$('#agentStatus');if(!el)return;const key=agents.map(a=>a.client+a.version).join('|');if(el.dataset.key===key&&el.innerHTML)return;el.dataset.key=key;
 el.className='agent-status '+(agents.length?'connected':'waiting');
 el.innerHTML=agents.length?`<span class="as-icon">${icon('check')}</span><div><strong>Connected</strong><small>${agents.map(a=>esc(a.client+(a.version?' '+a.version:''))).join(' · ')}</small></div><button class="primary" id="agentDone">Done</button>`:`<span class="as-icon"><i class="pulse-dot"></i></span><div><strong>Waiting for an agent…</strong><small>Follow the steps below. Nothing to press here — it updates by itself.</small></div>`;
 if($('#agentDone'))$('#agentDone').onclick=()=>$('#dialog').close();
}
function importDialog(){dialog('Import a show',`<p class="hint">Includes fixtures, placement, alignment, positions, groups, cues, pages and LED wall choice. Network settings stay. Output must be disarmed; the current show is backed up. Imported media files are not inside the show file.</p><input id="showFile" type="file" accept=".json,application/json" aria-label="Show file"><div class="dialog-actions"><button id="loadShow" class="primary"><span data-icon="upload"></span>Import</button></div>`);$('#loadShow').onclick=async()=>{try{const file=$('#showFile').files[0];if(!file)return toast('Choose an exported show file.');if(file.size>300000)throw Error('Show file is too large');await command('show.import',{show:JSON.parse(await file.text())});cancelAlignment();selected=[];group=null;$('#dialog').close();toast('Show imported. Output remains disarmed.')}catch(e){toast(e.message)}}}
function helpDialog(){dialog('Guides',`<div class="pool-list"><a class="pool-row link" href="/help/operator.html" target="_blank"><span class="pill-icon" data-icon="show"></span><strong>Running the show</strong><small>Pages, GO, overrides</small></a><a class="pool-row link" href="/help/hog-setup.html" target="_blank"><span class="pill-icon" data-icon="plug"></span><strong>Hog 4 setup</strong><small>Field guide</small></a><a class="pool-row link" href="/help/mh7.html" target="_blank"><span class="pill-icon" data-icon="beam"></span><strong>MH7 notes</strong><small>Verified behavior</small></a><a class="pool-row link" href="/help/triggers.html" target="_blank"><span class="pill-icon" data-icon="network"></span><strong>Triggers from other apps</strong><small>OSC setup</small></a><a class="pool-row link" href="/help/agent-api.html" target="_blank"><span class="pill-icon" data-icon="agent"></span><strong>Agent API</strong><small>HTTP, OSC, MCP</small></a></div><h3>Keys</h3><dl class="diagnostic"><dt>Space</dt><dd>GO</dd><dt>⌫</dt><dd>Back</dd>${Object.entries(DESK_NAMES).filter(([k])=>show.masters.desk[k]).map(([k,n])=>`<dt>${esc(keyLabel(show.masters.desk[k]))}</dt><dd>${n}</dd>`).join('')}<dt>← →</dt><dd>Page through the masters</dd><dt>Master keys</dt><dd>${esc(slots().filter(m=>m.key).slice(0,9).map(m=>keyLabel(m.key)).join(' '))}… shown on each master</dd><dt>Esc</dt><dd>Close panels</dd></dl><p class="hint">Version 0.2 prototype. The stage is an approximate spatial model, not a photometric simulator.</p>`)}
// Art-Net output: where the desk sends DMX and a check of the path (output.status / output.check / output.configure,
// the same commands agents use as lights_output_*). The check sends no DMX.
let lastCheck=null;
function outputSection(){
 const o=runtime.output,ips=[...new Set([show.settings.source,...o.interfaces.filter(i=>!i.internal).map(i=>i.address)])];
 const adapter=ip=>o.interfaces.find(i=>i.address===ip)?.name;
 return `<section class="prop net-settings"><h3><span data-icon="plug"></span>Art-Net output</h3>
 <div id="outState" class="out-state"></div>
 <div class="form-grid"><label class="mini"><span>This Mac's lighting network address</span><select id="outSource">${ips.map(ip=>`<option value="${esc(ip)}">${esc(ip)}${adapter(ip)?' · '+esc(adapter(ip)):' · not connected'}</option>`).join('')}</select></label>
 <label class="mini"><span>Console or Art-Net node IP</span><input id="outTarget" type="text" inputmode="decimal" spellcheck="false" value="${esc(show.settings.target)}" placeholder="10.0.0.1"></label></div>
 <div class="dialog-actions left"><button id="outCheck" class="ghost-button"><span data-icon="network"></span>Check connection</button><button id="outSave" class="ghost-button"><span data-icon="save"></span>Save addresses</button><button id="outMore" class="link-button">Universe mapping…</button></div>
 <ul id="outSteps" class="check-steps"></ul>
 <p class="hint">The check pings the address and asks it to identify itself over Art-Net. It sends no DMX. Agents: lights_output_status, lights_output_check.</p></section>`;
}
function paintOutputState(){
 const el=$('#outState');if(!el)return;const o=runtime.output,key=[o.armed,o.packets,o.lastError].join('|');if(el.dataset.key===key)return;el.dataset.key=key;
 el.className='out-state '+(o.armed?'live':'off');
 el.innerHTML=o.armed?`<i></i><div><strong>Output on</strong><small>Sending to ${esc(show.settings.target)} · ${o.packets.toLocaleString()} packets${o.lastError?' · '+esc(o.lastError):''}</small></div>`:`<i></i><div><strong>Output off</strong><small>Nothing is sent to the rig. The visualizer is preview only until you arm output.</small></div><button class="primary danger small" id="outArm">Arm output…</button>`;
 if($('#outArm'))$('#outArm').onclick=armDialog;
}
function paintChecks(c){
 const el=$('#outSteps');if(!el)return;if(!c){el.innerHTML='';return}
 el.innerHTML=c.steps.map(x=>`<li class="${x.ok?'ok':'bad'}">${icon(x.ok?'check':'warning')}<span>${esc(x.label)}</span></li>`).join('')+`<li class="muted"><span>Checked ${esc(new Date(c.at).toLocaleTimeString())} · ${esc(c.target)}</span></li>`;
}
function wireOutputSection(){
 $('#outSource').value=show.settings.source;paintOutputState();paintChecks(lastCheck&&lastCheck.target===show.settings.target?lastCheck:null);
 const addr=()=>({source:$('#outSource').value,target:$('#outTarget').value.trim()});
 $('#outCheck').onclick=async e=>{const b=e.currentTarget;b.disabled=true;$('#outSteps').innerHTML=`<li class="muted"><span>Checking ${esc(addr().target)}…</span></li>`;try{lastCheck=await command('output.check',addr());paintChecks(lastCheck)}catch{$('#outSteps').innerHTML=''}finally{if(b.isConnected)b.disabled=false}};
 $('#outSave').onclick=async()=>{if(runtime.output.armed)return toast('Disarm output before changing addresses.');try{await command('output.configure',{...addr(),mappings:show.settings.mappings});toast('Addresses saved.')}catch{}};
 $('#outMore').onclick=connection;
}
// Running cues (cue.pause / cue.release, docs/CUE-PLAYBACK.md) live on their own cue-list rows: while a cue runs, its
// play/GO button becomes Pause (Play again while paused) and a Stop button appears beside it. Rows change only when the
// running set or a paused state changes.
let entryControlsKey=null;
function paintRunning(r){
 const btn=$('#highlightButton');if(btn){btn.classList.toggle('active',!!r.highlight);btn.setAttribute('aria-pressed',r.highlight?'true':'false')}
 const running=new Map((r.running??[]).map(c=>[c.id,c])),key=[...running.values()].map(c=>c.id+(c.paused?'p':'')).join('|')+'#'+rev;
 if(key===entryControlsKey)return;entryControlsKey=key;
 $$('[data-entry-row]').forEach(row=>{const go=row.querySelector('[data-go-entry]'),stop=row.querySelector('[data-stop-entry]');if(!go)return;
  const cueId=stop?.dataset.stopEntry,c=cueId&&running.get(cueId),state=c?(c.paused?'paused':'playing'):'idle';
  go.dataset.icon0??=go.dataset.icon;go.dataset.title0??=go.title;go.dataset.cue=cueId??'';
  if(go.dataset.run!==state){go.dataset.run=state;go.innerHTML=icon(state==='playing'?'pause':state==='paused'?'play':go.dataset.icon0);go.title=state==='playing'?'Pause: freeze this cue where it is':state==='paused'?'Resume from where it paused':go.dataset.title0;go.classList.toggle('active',state!=='idle')}
  if(stop)stop.hidden=state==='idle';row.classList.toggle('running',state!=='idle');row.classList.toggle('paused',state==='paused')});
}
// The active scene shows under Now, and Stop says it fades back to it. The Scenes list redraws only when it changes.
function paintScene(r){
 const sc=r.scene,line=$('#sceneLine');if(line.hidden!==!sc)line.hidden=!sc;if(sc)setText(line.lastElementChild,'Scene · '+sc.name);
 $('#stopButton').title=sc?`Stop all running cues · fade back to scene ${sc.name}`:'Stop all running cues · fade to dark';
 if(railTab==='scenes'&&(sc?.id??'')!==sceneKey)drawPages();
}
// Shown over the stage while lights are being driven but output is off, so "the rig does nothing" is never a mystery.
let outputHintDismissed=false;
function paintOutputHint(r){
 const el=$('#outputHint');if(!el)return;if(r.output.armed)outputHintDismissed=false;
 const driving=!!r.playback||(r.frames??[]).some(f=>f.intensity>.01);const show_=!r.output.armed&&driving&&!outputHintDismissed;
 if(el.hidden!==!show_)el.hidden=!show_;
}
// Playback preferences live in the show (settings.set), so agents and every desk share them.
function settingsDialog(){
 const row=(key,title,hint)=>`<section class="prop"><h3><span data-icon="${key==='clearFade'?'release':'blind'}"></span>${title}</h3><p class="hint">${hint}</p><div class="seg-row"><div class="segmented">${[[0,'Instant'],[1,'1 s'],[2,'2 s'],[3,'3 s'],[5,'5 s']].map(([v,l])=>`<button data-setting="${key}" data-value="${v}" class="${show.playback[key]===v?'active':''}">${l}</button>`).join('')}</div><label class="num"><input data-setting-number="${key}" type="number" min="0" max="30" step=".5" value="${show.playback[key]}">s</label></div></section>`;
 dialog('Settings',outputSection()+row('clearFade','Clear','How long Clear (C) takes to fade manual changes back to the running cue. Instant is a hard cut.')+row('blindFade','Blind','How long clearing blind changes, and Apply live, take to fade. Instant is a hard cut.')+'<p class="hint">Saved in the show, so it travels with exports and agents see it (lights_settings_set).</p>');
 const save=async(key,value)=>{if(!Number.isFinite(value)||value<0||value>30)return toast('Use 0 to 30 seconds.');try{await command('settings.set',{[key]:value});settingsDialog()}catch{}};
 wireOutputSection();
 $$('[data-setting]').forEach(b=>b.onclick=()=>save(b.dataset.setting,+b.dataset.value));
 $$('[data-setting-number]').forEach(el=>el.onchange=()=>save(el.dataset.settingNumber,Math.round(+el.value*10)/10));
}
// Patch sheet (like a Hog fixture window), read from patch.report — the same readback agents get.
let patchTimer,patchOpen=new Set();
const FAMILY_COLOR={colorado:'#a78bfa',pendant4:'#94a3b8',reveE3:'#fde68a',q120:'#f2c27c',rogue:'#7fd3dc',mh7:'#ee8fc8',beam7r:'#9cc7ff',beam200:'#c084fc',unknown:'#5f7387'};
const PATCH_STATE={output:['Output','ok'],ready:['Ready','ok'],unrouted:['No route','warn'],unverified:['Unverified','muted'],disabled:['Disabled','muted']};
async function patchSheet(){
 dialog('Patch',`<div id="patchNet" class="patch-net"></div><div id="patchUniverses" class="universe-cards"></div><div id="patchIssues"></div><div class="patch-tools"><input id="patchSearch" type="text" placeholder="Search ID, name or type" aria-label="Search patch"><label class="check"><input id="patchAll" type="checkbox">Show disabled & unverified</label></div><div id="patchBody" class="patch-body"></div><p class="hint" id="patchNote"></p>`);
 $('#dialog').classList.add('wide');$('#patchSearch').oninput=drawPatch;$('#patchAll').onchange=drawPatch;
 await drawPatch();patchTimer=setInterval(()=>{if($('#dialog').open&&$('#patchBody'))drawPatch();else clearInterval(patchTimer)},1000);
}
async function drawPatch(){
 let r;try{r=await command('patch.report')}catch{return}if(!$('#patchBody'))return;
 const n=r.network;$('#patchNet').innerHTML=`<span>${icon('plug')}Mac <b>${esc(n.source)}</b></span><span class="arrow">${icon('right')}</span><span>Hog <b>${esc(n.target)}</b> · Art-Net UDP ${n.port}</span><span class="net-state ${n.armed?'live':''}">${n.armed?'Sending':'Output off'} · ${n.packets.toLocaleString()} packets</span>${n.lastError?`<span class="warn">${esc(n.lastError)}</span>`:''}`;
 $('#patchUniverses').innerHTML=r.universes.map(u=>`<div class="universe-card ${u.artnet===null?'unrouted':''}"><div class="uc-head"><strong>Hog ${u.hog}</strong><span>${u.artnet===null?'No Art-Net route':'→ Art-Net '+u.artnet}</span></div><div class="uc-bar">${u.ranges.map(x=>{const f=r.fixtures.find(f=>f.id===x.id);return `<i title="${esc(x.id)} · ${x.from}–${x.to}" style="left:${(x.from-1)/512*100}%;width:${Math.max(.4,(x.to-x.from+1)/512*100)}%;background:${FAMILY_COLOR[f?.profile]??'#5f7387'};opacity:${x.enabled?1:.35}"></i>`}).join('')}</div><small>${u.enabled} fixtures · ${u.channelsUsed} / 512 ch</small></div>`).join('');
 $('#patchIssues').innerHTML=r.issues.length?`<details class="more"><summary>${icon('warning')}${r.issues.length} routing note${r.issues.length===1?'':'s'}</summary><ul>${r.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></details>`:'';
 const q=$('#patchSearch').value.trim().toLowerCase(),all=$('#patchAll').checked,body=$('#patchBody'),top=body.scrollTop;
 const list=r.fixtures.filter(f=>(all||(f.enabled&&f.verified))&&(!q||[f.id,f.name,f.profileName].some(x=>x.toLowerCase().includes(q))));
 const fams=Object.keys(FAMILY).map(p=>[p,list.filter(f=>f.profile===p)]).filter(([,l])=>l.length);
 body.innerHTML=fams.map(([p,l])=>`<section class="patch-family"><h3><i style="background:${FAMILY_COLOR[p]}"></i>${esc(FAMILY[p])}<small>${esc(l[0].profileName)}${l[0].channels?` · ${l[0].channels} ch`:''}</small><span>${l.length}</span></h3><div class="patch-head"><span>ID</span><span>Name</span><span>Patch</span><span>Route</span><span>Status</span><span>Level</span><span></span></div>${l.map(f=>{const [label,cls]=PATCH_STATE[f.state];const open=patchOpen.has(f.id);return `<div class="patch-row ${open?'open':''}" data-patch-row="${esc(f.id)}"><span class="pid">${esc(f.id)}</span><span class="pname">${esc(f.name)}</span><span class="paddr">${f.end?`U${f.universe} · ${f.address}–${f.end}`:'Unpatched'}</span><span class="proute">${f.artnet===null?'—':'Art-Net '+f.artnet}</span><span class="pstate ${cls}">${label}</span><span class="plevel"><i style="width:${Math.round(f.intensity*100)}%"></i><b>${Math.round(f.intensity*100)}%</b></span><button class="round-button small" data-patch-edit="${esc(f.id)}" title="Edit in Build" aria-label="Edit ${esc(f.id)}">${icon('edit')}</button></div>${open?`<div class="dmx-bytes">${f.dmx?f.dmx.map((v,i)=>`<span><small>${f.address+i}</small><b>${v}</b></span>`).join(''):'<p class="hint">No DMX is built for this fixture ('+esc(label.toLowerCase())+').</p>'}</div>`:''}`}).join('')}</section>`).join('')||'<p class="hint">No fixtures match.</p>';
 body.scrollTop=top;setText($('#patchNote'),r.note);
 $$('[data-patch-row]').forEach(row=>row.onclick=e=>{if(e.target.closest('[data-patch-edit]'))return;const id=row.dataset.patchRow;patchOpen.has(id)?patchOpen.delete(id):patchOpen.add(id);drawPatch()});
 $$('[data-patch-edit]').forEach(b=>b.onclick=()=>{const id=b.dataset.patchEdit;$('#dialog').close();if(mode!=='build')setMode('build');progTab='patch';applySelection([id]);quiet(command('selection.set',{ids:[id]}));side='program';drawSide()});
}
// ── Other apps: what a cue sends when it GOes ──
const SEND_LABEL={look:'Look summary (colour temperature, level)',cue:'Cue announcement',preset:'Preset in that app',osc:'Custom OSC message'};
function entrySendsHTML(e){
 const targets=show.targets??[],sends=e.send??[];
 return `<label class="field-label">When this cue GOes, send</label><div class="send-list">${sends.map((x,i)=>{const t=targets.find(t=>t.id===x.target);return `<div class="pool-row"><span class="pill-icon">${icon('network')}</span><strong>${esc(t?.name??x.target)}</strong><small>${x.message==='osc'?esc(x.address+' '+(x.args??[]).join(' ')):x.message==='preset'?esc(`Preset ${x.preset}${x.fade!==undefined?` · ${x.fade} s`:''}`):SEND_LABEL[x.message]}</small><button class="round-button small danger" data-del-send="${i}" aria-label="Remove">${icon('close')}</button></div>`}).join('')||'<p class="hint">Nothing yet.</p>'}</div>
 ${targets.length?`<div class="send-add"><select id="sendTarget">${targets.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><select id="sendMessage">${Object.entries(SEND_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><button class="chip-button" id="addSend">${icon('plus')}Add</button></div><div id="sendCustom" class="send-add" hidden><input id="sendAddress" type="text" placeholder="/camera/preset"><input id="sendArgs" type="text" placeholder="args, comma separated"></div><div id="sendPreset" class="send-add" hidden><input id="sendPresetId" type="text" list="sendPresetList" placeholder="Preset id in that app"><datalist id="sendPresetList"></datalist><input id="sendPresetFade" type="number" min="0" max="600" step="0.1" placeholder="Fade s" title="Optional: seconds that app takes to recall it"><button class="ghost-button small" id="sendPresetRefresh" title="Ask that app for its preset list">Refresh</button></div>`:'<p class="hint">Add a target (camera app, LiveStage…) in ☰ → Network & triggers.</p>'}`;
}
// Look Link (docs/LOOK-LINK.md): zone roles, target modes, and one zone's figures in words.
const ZONE_ROLES=()=>schema?.commands?.['zone.save']?.schema.properties.zone.properties.role.enum??['face','front','back','top','side','effect','audience','other'];
const ROLE_LABEL={face:'Face / key',front:'Front',back:'Back / rim',top:'Top',side:'Side',effect:'Effects',audience:'Audience',other:'Other'};
const LOOK_MODE={off:'Only cue sends',cue:'Every GO',change:'GO + live changes'};
const zoneLine=z=>z.lit&&z.kelvin!==null?`${z.kelvin} K · Duv ${z.duv>=0?'+':''}${z.duv.toFixed(4)} · ${Math.round(z.level*100)}%${z.white?' · white':' · coloured'}${z.colorUnknown?` · ${z.colorUnknown} unknown wheel`:''}`:'dark';
// Network & triggers: listener, address reference, named triggers, zones, targets and the live message log (network.status).
let netTimer;
const TRIGGER_ACTIONS={'page.go':'GO a page / cue','page.back':'Back','cue.stop':'Stop (fade out)','override.release':'Clear changes','blackout.set':'Blackout','master.set':'Master level','ledwall.set':'LED wall','cue.play':'Play a library cue'};
function triggerSummary(t){const a=t.args??{},pg=show.pages.find(p=>p.id===a.id);switch(t.command){
 case 'page.go':return `GO ${pg?.name??a.id}${a.entry?' · cue '+(pg?pg.cues.findIndex(e=>e.id===a.entry)+1:a.entry):' · next'}`;case 'blackout.set':return a.enabled?'Blackout on':'Blackout off';case 'master.set':return `Master ${Math.round(a.value*100)}%`;
 case 'ledwall.set':return 'LED wall · '+(mediaList().find(m=>m.id===a.media)?.name??a.media);case 'cue.play':return 'Play '+(show.cues.find(c=>c.id===a.id)?.name??a.id);default:return TRIGGER_ACTIONS[t.command]??t.command}}
async function networkSheet(){
 dialog('Network & triggers',`<div id="netStatus" class="patch-net"></div>
 <section class="prop"><h3><span data-icon="network"></span>Allow other apps to trigger</h3><p class="hint">Other apps send OSC over UDP to this port to GO cues and fire triggers. Only allowed devices are heard; triggers can never arm output or change the patch. <a href="/help/triggers.html" target="_blank">How to set it up</a></p><div class="seg-row"><div class="segmented"><button data-bind="loopback">${icon('target')}This Mac only</button><button data-bind="lan">${icon('network')}Show network</button></div><label class="num">Port <input id="netPort" type="number" min="1024" max="65535"></label></div><div id="netAllowRow" class="inline-form"><input id="netAllow" type="text" placeholder="Allowed IPs, comma separated (e.g. 192.168.1.20) — * = any device"><button class="chip-button" id="netSave">${icon('save')}Save</button></div>
 <details class="more"><summary>${icon('list')}Addresses StageLight understands</summary><div id="netAddresses" class="addr-list"></div></details></section>
 <section class="prop"><h3><span data-icon="spark"></span>Named triggers</h3><p class="hint">Another app sends <code>/stagelight/trigger "name"</code>; StageLight decides what it does. Change the action here without touching the other app.</p><div id="netTriggers" class="pool-list"></div>
  <div class="trigger-form"><input id="trigName" type="text" placeholder="Trigger name, e.g. chorus"><select id="trigCommand">${Object.entries(TRIGGER_ACTIONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><span id="trigArgs"></span><button class="chip-button accent" id="trigAdd">${icon('plus')}Add trigger</button></div></section>
 <section class="prop"><h3><span data-icon="sun"></span>Look Link zones</h3><p class="hint">Camera and lighting apps get the colour temperature, tint (Duv) and level of each zone you send them. A <em>face</em> zone is what cameras white-balance to. Colour is nominal (what fixtures are told to make), not metered. <a href="/help/triggers.html#look-link" target="_blank">Look Link</a></p><div id="netZones" class="pool-list"></div>
  <div class="trigger-form"><input id="zoneName" type="text" placeholder="Zone name, e.g. Backlights"><select id="zoneRole">${ZONE_ROLES().map(r=>`<option value="${r}">${ROLE_LABEL[r]??r}</option>`).join('')}</select><input id="zoneFixtures" type="text" placeholder="Fixture IDs, comma separated (optional)"><button class="chip-button accent" id="zoneSave">${icon('plus')}Add zone</button><button class="ghost-button small" id="zoneCancel" hidden>Cancel</button></div>
  <div class="zone-groups">${show.groups.map(g=>`<button class="pill" data-zgroup="${esc(g.id)}" title="${g.fixtures.length} fixtures">${esc(g.name)}</button>`).join('')}</div></section>
 <section class="prop"><h3><span data-icon="right"></span>Send to</h3><p class="hint">Targets receive what cues send (look summaries for camera white balance, announcements, custom OSC). <em>Announce</em> tells a target about every GO.</p><div id="netTargets" class="pool-list"></div>
  <div class="trigger-form"><input id="tgtName" type="text" placeholder="Name, e.g. Camera control"><div class="segmented small"><button data-tkind="osc" class="active">OSC</button><button data-tkind="http">HTTP</button></div><input id="tgtHost" type="text" placeholder="IP, e.g. 127.0.0.1"><input id="tgtPort" type="number" placeholder="Port"><input id="tgtUrl" type="text" placeholder="http://… (JSON POST)" hidden><label class="check"><input id="tgtAnnounce" type="checkbox">Announce</label><button class="chip-button accent" id="tgtAdd">${icon('plus')}Add target</button></div><div id="tgtLookEdit"></div></section>
 <details class="more" open><summary>${icon('list')}Recent messages</summary><div class="net-log"><div><h4 class="fx-cat">In</h4><div id="netIn"></div></div><div><h4 class="fx-cat">Out</h4><div id="netOut"></div></div></div></details>`);
 $('#dialog').classList.add('wide');let kind='osc',bind=null;
 const drawArgs=()=>{const c=$('#trigCommand').value,pages=show.pages.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('#trigArgs').innerHTML=c==='page.go'?`<select id="trigPage">${pages}</select><select id="trigEntry"></select>`:c==='blackout.set'?'<select id="trigOn"><option value="1">On</option><option value="0">Off</option></select>':c==='master.set'?'<input id="trigLevel" type="number" min="0" max="100" value="100" style="width:80px">':c==='ledwall.set'?`<select id="trigMedia"><option value="off">Off</option>${mediaList().map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>`:c==='cue.play'?`<select id="trigCue">${show.cues.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>`:'';
  if($('#trigPage')){const fill=()=>{const p=show.pages.find(p=>p.id===$('#trigPage').value);$('#trigEntry').innerHTML='<option value="">Next cue</option>'+(p?.cues??[]).map((e,i)=>`<option value="${esc(e.id)}">${i+1} · ${esc(entryName(e))}</option>`).join('')};$('#trigPage').onchange=fill;fill()}};
 $('#trigCommand').onchange=drawArgs;drawArgs();
 // Zones: groups (toggle pills) plus explicit fixture IDs. Edit loads a zone into the form.
 let zoneEdit=null;const zoneGroups=new Set();
 const zoneForm=z=>{zoneEdit=z?.id??null;zoneGroups.clear();for(const g of z?.groups??[])zoneGroups.add(g);$('#zoneName').value=z?.name??'';$('#zoneRole').value=z?.role??'face';$('#zoneFixtures').value=(z?.fixtures??[]).join(', ');
  $$('[data-zgroup]').forEach(b=>b.classList.toggle('active',zoneGroups.has(b.dataset.zgroup)));$('#zoneSave').innerHTML=icon(z?'save':'plus')+(z?'Save zone':'Add zone');$('#zoneCancel').hidden=!z};
 $$('[data-zgroup]').forEach(b=>b.onclick=()=>{const g=b.dataset.zgroup;zoneGroups.has(g)?zoneGroups.delete(g):zoneGroups.add(g);b.classList.toggle('active',zoneGroups.has(g))});
 $('#zoneCancel').onclick=()=>zoneForm(null);
 $('#zoneSave').onclick=async()=>{const name=$('#zoneName').value.trim();if(!name)return toast('Name the zone first.');const fixtures=$('#zoneFixtures').value.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);if(!zoneGroups.size&&!fixtures.length)return toast('Pick groups below or type fixture IDs.');
  let id=zoneEdit??(name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,64)||uid('zone'));if(!zoneEdit&&(show.zones??[]).some(z=>z.id===id))id=uid('zone');
  const zone={id,name,role:$('#zoneRole').value,...(zoneGroups.size?{groups:show.groups.filter(g=>zoneGroups.has(g.id)).map(g=>g.id)}:{}),...(fixtures.length?{fixtures:[...new Set(fixtures)]}:{})};
  try{await command('zone.save',{zone});zoneForm(null);drawNet()}catch{}};
 // Per-target Look Link settings: mode, zones (none = every zone), per-fixture detail, heartbeat; preview = look.report.
 const lookEditor=id=>{const t=show.targets.find(t=>t.id===id);if(!t)return $('#tgtLookEdit').innerHTML='';const l=t.look??{},zones=show.zones??[],pick=new Set(l.zones??[]);let lmode=l.mode??'off';
  $('#tgtLookEdit').innerHTML=`<div class="look-edit"><h4 class="fx-cat">${esc(t.name)} · look</h4><div class="seg-row"><div class="segmented small">${Object.entries(LOOK_MODE).map(([k,v])=>`<button data-lmode="${k}" class="${lmode===k?'active':''}">${v}</button>`).join('')}</div></div>
   <p class="hint">Zones it gets (none picked = every zone):</p><div class="zone-groups">${zones.map(z=>`<button class="pill ${pick.has(z.id)?'active':''}" data-lzone="${esc(z.id)}">${esc(z.name)} · ${esc(z.role)}</button>`).join('')||'<span class="hint">No zones yet — add them above.</span>'}</div>
   <div class="trigger-form"><label class="check"><input id="lookMembers" type="checkbox" ${l.members?'checked':''}>Per-fixture detail</label><label class="num">Heartbeat <input id="lookHeartbeat" type="number" min="0" max="3600" value="${l.heartbeat??0}"> s</label><button class="chip-button accent" id="lookSave">${icon('save')}Save</button><button class="ghost-button small" id="lookPreview">Preview</button><button class="ghost-button small" id="lookSendNow">Send now</button><button class="ghost-button small" id="lookClose">Close</button></div><pre id="lookReport" class="look-report" hidden></pre></div>`;
  $$('[data-lmode]').forEach(b=>b.onclick=()=>{lmode=b.dataset.lmode;$$('[data-lmode]').forEach(x=>x.classList.toggle('active',x===b))});
  $$('[data-lzone]').forEach(b=>b.onclick=()=>{const z=b.dataset.lzone;pick.has(z)?pick.delete(z):pick.add(z);b.classList.toggle('active',pick.has(z))});
  $('#lookClose').onclick=()=>$('#tgtLookEdit').innerHTML='';
  $('#lookSendNow').onclick=()=>quiet(command('look.send',{target:t.id}).then(()=>toast('Look sent to '+t.name+'.')));
  $('#lookSave').onclick=async()=>{let hb=Math.max(0,Math.min(3600,+$('#lookHeartbeat').value||0));if(hb>0&&hb<1)hb=1;const look={mode:lmode,...(pick.size?{zones:zones.filter(z=>pick.has(z.id)).map(z=>z.id)}:{}),...($('#lookMembers').checked?{members:true}:{}),...(hb?{heartbeat:hb}:{})};
   try{await command('target.save',{target:{...structuredClone(t),look}});toast('Look settings saved for '+t.name+'.');drawNet()}catch{}};
  $('#lookPreview').onclick=async()=>{try{const r=await command('look.report',{target:t.id}),m=r.message,pct=v=>Math.round(v*100)+'%';
   $('#lookReport').textContent=[`${m.reason} · ${m.state} · output ${m.output.armed?'armed':'preview only'}${m.output.blackout?' · BLACKOUT':''} · master ${pct(m.output.master)}`,`overall: ${m.kelvin??'—'} K · ${pct(m.level)} · ${m.lit}/${m.fixtures} lit · ${m.color}`,...m.zones.map(z=>`${z.name} (${z.role}): ${zoneLine(z)}`),'',...r.osc.map(o=>`${o.address} ${o.types} ${o.args.join(' ')}`)].join('\n');$('#lookReport').hidden=false}catch{}};
 };
 $('#trigAdd').onclick=async()=>{const name=$('#trigName').value.trim();if(!name)return toast('Name the trigger first.');const c=$('#trigCommand').value;
  const args=c==='page.go'?{id:$('#trigPage').value,...($('#trigEntry').value?{entry:$('#trigEntry').value}:{})}:c==='blackout.set'?{enabled:$('#trigOn').value==='1'}:c==='master.set'?{value:Math.max(0,Math.min(100,+$('#trigLevel').value))/100}:c==='ledwall.set'?{media:$('#trigMedia').value}:c==='cue.play'?{id:$('#trigCue').value}:{};
  try{await command('trigger.save',{trigger:{id:name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,64)||uid('trigger'),name,command:c,args}});$('#trigName').value='';drawNet()}catch{}};
 $$('[data-tkind]').forEach(b=>b.onclick=()=>{kind=b.dataset.tkind;$$('[data-tkind]').forEach(x=>x.classList.toggle('active',x===b));$('#tgtHost').hidden=$('#tgtPort').hidden=kind!=='osc';$('#tgtUrl').hidden=kind!=='http'});
 $('#tgtAdd').onclick=async()=>{const name=$('#tgtName').value.trim();if(!name)return toast('Name the target first.');const target={id:uid('target'),name,kind,announce:$('#tgtAnnounce').checked,...(kind==='osc'?{host:$('#tgtHost').value.trim(),port:+$('#tgtPort').value}:{url:$('#tgtUrl').value.trim()})};
  try{await command('target.save',{target});$('#tgtName').value='';drawNet()}catch{}};
 $$('[data-bind]').forEach(b=>b.onclick=()=>{bind=b.dataset.bind;$$('[data-bind]').forEach(x=>x.classList.toggle('active',x===b));$('#netAllowRow').classList.toggle('dim',bind!=='lan')});
 $('#netSave').onclick=async()=>{const allow=$('#netAllow').value.split(',').map(s=>s.trim()).filter(Boolean),port=+$('#netPort').value||1461;try{await command('network.configure',{bind:bind??'loopback',port,allow});toast('Listener updated.');drawNet(true)}catch{}};
 await drawNet(true);netTimer=setInterval(()=>{if($('#dialog').open&&$('#netIn'))drawNet();else clearInterval(netTimer)},1000);
 async function drawNet(first=false){
  let r;try{r=await command('network.status')}catch{return}if(!$('#netIn'))return;const l=r.listener;
  $('#netStatus').innerHTML=`<span class="${l.listening?'ok-text':'warn'}">${icon(l.listening?'check':'warning')}${l.listening?'Listening':'Not listening'} on <b>${esc(l.address)}:${l.port}</b></span><span>${l.bind==='lan'?'Show network · '+(l.allow?.length?esc(l.allow.join(', ')):'no devices allowed yet'):'This Mac only'}</span><span class="net-state">${r.count.in} in · ${r.count.out} out${r.count.rejected?` · ${r.count.rejected} rejected`:''}</span>${l.error?`<span class="warn">${esc(l.error)}</span>`:''}`;
  if(first){bind=l.bind??'loopback';$$('[data-bind]').forEach(x=>x.classList.toggle('active',x.dataset.bind===bind));$('#netPort').value=l.port;$('#netAllow').value=(l.allow??[]).join(', ');$('#netAllowRow').classList.toggle('dim',bind!=='lan');
   $('#netAddresses').innerHTML=r.addresses.map(a=>`<div class="addr"><code>${esc(a.address)}</code><span>${esc(a.args)}</span><small>${esc(a.does)}</small></div>`).join('')}
  $('#netTriggers').innerHTML=r.triggers.map(t=>`<div class="pool-row"><span class="pill-icon">${icon('spark')}</span><strong>${esc(t.name)}</strong><small>${esc(triggerSummary(t))}</small><button class="round-button small" data-fire="${esc(t.id)}" title="Fire now">${icon('play')}</button><button class="round-button small danger" data-del-trigger="${esc(t.id)}" title="Delete">${icon('trash')}</button></div>`).join('')||'<p class="hint">No named triggers yet.</p>';
  let live=null;if(r.zones.length){try{live=(await command('look.report',{})).message.zones}catch{}}if(!$('#netZones'))return;
  $('#netZones').innerHTML=r.zones.map(z=>{const m=live?.find(x=>x.id===z.id),gs=(z.groups??[]).map(g=>show.groups.find(x=>x.id===g)?.name??g);return `<div class="pool-row"><span class="pill-icon">${icon('sun')}</span><strong>${esc(z.name)}</strong><small>${esc(ROLE_LABEL[z.role]??z.role)} · ${z.members.length} fixtures${gs.length?' · '+esc(gs.join(', ')):''}${m?' · '+esc(zoneLine(m)):''}</small><button class="round-button small" data-edit-zone="${esc(z.id)}" title="Edit">${icon('edit')}</button><button class="round-button small danger" data-del-zone="${esc(z.id)}" title="Delete">${icon('trash')}</button></div>`}).join('')||'<p class="hint">No zones yet. Pick groups (or type fixture IDs), give the zone a role and add it.</p>';
  $$('[data-edit-zone]').forEach(b=>b.onclick=()=>zoneForm(show.zones.find(z=>z.id===b.dataset.editZone)));$$('[data-del-zone]').forEach(b=>b.onclick=()=>quiet(command('zone.delete',{id:b.dataset.delZone}).then(()=>{if(zoneEdit===b.dataset.delZone)zoneForm(null);drawNet()})));
  $('#netTargets').innerHTML=r.targets.map(t=>`<div class="pool-row"><span class="pill-icon">${icon('network')}</span><strong>${esc(t.name)}</strong><small>${t.kind==='osc'?`OSC ${esc(t.host)}:${t.port}`:esc(t.url)}${t.announce?' · announces every GO':''}${t.look?.mode&&t.look.mode!=='off'?' · look '+esc(LOOK_MODE[t.look.mode]):''}${r.presets[t.id]?.presets.length?` · ${r.presets[t.id].presets.length} presets`:''}</small><button class="ghost-button small" data-look-target="${esc(t.id)}">Look</button><button class="ghost-button small" data-ping="${esc(t.id)}">Ping</button><button class="ghost-button small" data-sendlook="${esc(t.id)}">Send look</button><button class="round-button small danger" data-del-target="${esc(t.id)}" title="Delete">${icon('trash')}</button></div>`).join('')||'<p class="hint">No targets yet.</p>';
  // Outbound rows carry the app's answer: its HTTP reply summary and any later /stagelight/feedback.
  const said=x=>[x.reply?.summary||x.reply?.status?`↩ ${x.reply.status??(x.reply.ok===false?'not ok':'ok')}${x.reply.summary?' · '+x.reply.summary:''}`:'',x.feedback?`↩ ${x.feedback.status}${x.feedback.summary?' · '+x.feedback.summary:''}`:''].filter(Boolean).join(' · ');
  const row=x=>`<div class="net-row ${x.ok===false||String(x.result).startsWith('failed')||x.reply?.ok===false||x.feedback?.status==='failed'?'bad':''}"><span>${esc(x.at.slice(11,19))}</span><code>${esc(x.address??x.summary)}</code><small>${esc(x.from??x.target)}${x.ms!==undefined?` · ${x.ms} ms`:''} · ${esc(x.result??'')}${said(x)?' · '+esc(said(x)):''}</small></div>`;
  $('#netIn').innerHTML=r.inbound.slice(0,12).map(row).join('')||'<p class="hint">Nothing received yet. Try: /stagelight/ping</p>';$('#netOut').innerHTML=r.outbound.slice(0,12).map(row).join('')||'<p class="hint">Nothing sent yet.</p>';
  $$('[data-fire]').forEach(b=>b.onclick=()=>quiet(command('trigger.fire',{id:b.dataset.fire})));$$('[data-del-trigger]').forEach(b=>b.onclick=()=>quiet(command('trigger.delete',{id:b.dataset.delTrigger}).then(()=>drawNet())));
  $$('[data-ping]').forEach(b=>b.onclick=()=>quiet(command('target.test',{id:b.dataset.ping,message:'ping'})));$$('[data-sendlook]').forEach(b=>b.onclick=()=>quiet(command('target.test',{id:b.dataset.sendlook,message:'look'})));
  $$('[data-del-target]').forEach(b=>b.onclick=()=>quiet(command('target.delete',{id:b.dataset.delTarget}).then(()=>{lookEditor(null);drawNet()})));
  $$('[data-look-target]').forEach(b=>b.onclick=()=>lookEditor(b.dataset.lookTarget));
 }
}
// ── App updates (desktop app only): the app checks GitHub; installing is always the operator's call ──
// The app (src-tauri/src/updater.rs) refuses to install while output is armed and restarts the engine on the new code.
const shell=window.__TAURI_INTERNALS__;let update=null,updateBusy=false;
async function checkUpdate(quiet=true){
 if(!shell)return null;
 try{update=await shell.invoke('update_check')}catch(e){if(!quiet)throw e;return null}
 const v=update.version;$('#menuButton').classList.toggle('has-update',!!v);setText($('#updateLabel'),v?`Update to version ${v}…`:'Check for updates…');return update;
}
function updatesDialog(){
 dialog('App updates','<div id="updateBody"><p class="hint">Checking GitHub for a newer version…</p></div>');
 const draw=(err)=>{if(!$('#updateBody'))return;const u=update,armed=runtime.output.armed;
  if(err&&!u){$('#updateBody').innerHTML=`<p class="warning">${icon('warning')}${esc(err)}</p><div class="dialog-actions"><button id="updateRecheck" class="ghost-button">Check again</button></div>`}
  else if(!u.version)$('#updateBody').innerHTML=`<p>StageLight <strong>${esc(u.current)}</strong> is the latest version.</p><div class="dialog-actions"><button id="updateRecheck" class="ghost-button">Check again</button></div>`;
  else $('#updateBody').innerHTML=`<dl class="diagnostic"><dt>This app</dt><dd>${esc(u.current)}</dd><dt>New version</dt><dd><strong>${esc(u.version)}</strong></dd></dl>${u.notes?`<pre class="update-notes">${esc(u.notes)}</pre>`:''}
   <p class="hint">Installing stops the lighting engine, installs and reopens StageLight. It comes back with output off. Update on a rehearsal day, not right before a show.</p>
   ${u.dev?'<p class="warning">This is a development build: update it from git.</p>':armed?`<p class="warning">${icon('warning')}Physical output is armed. Disarm it to install the update.</p>`:''}${err?`<p class="warning">${icon('warning')}${esc(err)}</p>`:''}
   <div class="dialog-actions"><span id="updateProgress" class="hint"></span><button id="updateInstall" class="primary" ${u.dev||armed||updateBusy?'disabled':''}>Install ${esc(u.version)} and restart</button></div>`;
  fillIcons($('#updateBody'));
  if($('#updateRecheck'))$('#updateRecheck').onclick=()=>{$('#updateBody').innerHTML='<p class="hint">Checking…</p>';checkUpdate(false).then(()=>draw()).catch(e=>draw(e))};
  if($('#updateInstall'))$('#updateInstall').onclick=install;
 };
 async function install(){
  updateBusy=true;$('#updateInstall').disabled=true;const timer=setInterval(async()=>{try{const p=await shell.invoke('update_progress');setText($('#updateProgress'),p.total?`Downloading ${Math.round(p.done/1e6)} of ${Math.round(p.total/1e6)} MB`:p.done?`Downloading ${Math.round(p.done/1e6)} MB`:'Starting download…')}catch{}},300);
  try{await shell.invoke('update_install')}catch(e){clearInterval(timer);updateBusy=false;draw(String(e))}
 }
 checkUpdate(false).then(()=>draw()).catch(e=>draw(String(e)));
}
function armDialog(){if(runtime.output.armed){quiet(command('output.disarm'));return}dialog('Enable physical output?',`<p>This sends Art-Net to <strong>${esc(show.settings.target)}</strong>. Playback and overrides are stopped first. Verify the Hog handover.</p><p class="warning">${icon('warning')}Arming does not play a cue. You choose the next live action.</p><div class="dialog-actions"><button id="armCancel" class="ghost-button">Stay in preview</button><button id="armOutput" class="primary danger">Arm physical output</button></div>`);$('#armCancel').onclick=()=>$('#dialog').close();$('#armOutput').onclick=async()=>{await command('cue.stop',{fade:0});await new Promise(r=>setTimeout(r,80));await command('output.arm',{confirmation:'ENABLE_PHYSICAL_OUTPUT'});$('#dialog').close();toast('Output armed. Choose a cue to GO live.')}}

// ── 10 Hz paint: readback only, no structural redraws ──
function paint(r){
 paintOutputHint(r);paintOutputState();paintRunning(r);
 if(!r)return;runtime=r;paintAgentStatus(r);paintMasters(r);paintLibrary(r);if(show)paintScene(r);
 if(show&&r.selection&&r.selection.revision>selectionRevision){const first=!selectionRevision;selectionRevision=r.selection.revision;if(!first||r.selection.ids.length)applySelection(r.selection.ids,r.selection.group)}$('#engineStatus').innerHTML='<i></i>Engine ready';document.body.classList.toggle('live',r.output.armed);
 setText($('#outputButton span'),r.output.armed?'LIVE':'Output off');setText($('.preview-label'),stage?.mode==='reference'?'Reference render · not live lighting':r.output.armed?'Live view · output on':'Live view · output off');drawPreviewBanner(r);
 stage?.setLedPlaying(!r.output.armed);
 const p=page(),stack=r.stack,onPage=stack&&p&&stack.page===p.id;
 // Now / next
 const pb=r.playback;setText($('#nowName'),pb?(stack?entryName(show.pages.find(x=>x.id===stack.page)?.cues.find(e=>e.id===stack.entry))??pb.name:pb.name):'—');
 setText($('#playState'),pb?(r.transition?`Fading ${(r.transition.duration*(1-r.transition.progress)).toFixed(1)}s`:pb.paused?'Paused':r.output.armed?'Live':'Now playing'):r.output.armed?'Live · idle':'Ready');
 $('#progressBar').style.width=pb?Math.min(100,pb.elapsed/pb.duration*100)+'%':'0';$('#fadeBar').style.width=r.transition?r.transition.progress*100+'%':'0';$('#fadeBar').hidden=!r.transition;
 if(onPage&&standby===stack.entry)standby=null;
 const nextId=standby??(onPage?stack.next?.entry:p?.cues[0]?.id),next=p?.cues.find(e=>e.id===nextId);
 setText($('#nextName'),next?entryName(next):onPage?'End of list':'—');
 setText($('#nextMeta'),next?(standby?'Standing by · ':'')+(onPage&&!standby&&stack.follow?`Auto in ${Math.ceil(stack.follow.remaining)}s`:next.fade>0?`Fade ${next.fade}s`:'Cut'):'');
 $('#goButton').disabled=!next;$('#backButton').disabled=!(stack&&stack.index>0);
 // Cue list live / standby / done marks
 const key=[p?.id,stack?.entry,nextId,rev].join('|');
 if(key!==liveKey){liveKey=key;const liveIndex=onPage?stack.index:-1;$$('[data-entry-row]').forEach((row,i)=>{const id=row.dataset.entryRow;row.classList.toggle('live',onPage&&id===stack.entry);row.classList.toggle('standby',id===nextId);row.classList.toggle('done',liveIndex>=0&&i<liveIndex);setText(row.querySelector('.cue-state'),onPage&&id===stack.entry?'LIVE':id===nextId?'NEXT':'')})}
 const liveRow=onPage&&$(`[data-entry-row="${CSS.escape(stack.entry)}"] .cue-progress i`);if(liveRow&&pb)liveRow.style.width=Math.min(100,pb.elapsed/pb.duration*100)+'%';
 $$('[data-page]').forEach(b=>b.classList.toggle('running',stack?.page===b.dataset.page));
 // Overrides & master
 const overrides=new Set([...Object.keys(progOverrides(r)),...(r.blind?.enabled?[]:r.fx.flatMap(x=>x.fixtures))]).size;$('#saveButton').disabled=!overrides;$('#saveButton').classList.toggle('active',overrides>0);$('#blindButton').classList.toggle('active',!!r.blind?.enabled);const prefs=show?.playback??{clearFade:3,blindFade:2},fadeText=s=>s?`over ${s} s`:'instantly';$('#releaseButton').title=r.blind?.enabled?`Clear the blind changes ${fadeText(prefs.blindFade)}`:`Fade manual changes back to the running cue ${fadeText(prefs.clearFade)}`;setText($('#overrideCount'),String(overrides));$('#releaseButton').disabled=!overrides;$('#releaseButton').classList.toggle('active',overrides>0);
 if(document.activeElement!==$('#master'))$('#master').value=Math.round(r.master*100);setText($('#masterValue'),Math.round(r.master*100)+'%');
 $('#blackout').classList.toggle('active',r.blackout);setText($('#blackout span:last-child'),r.blackout?'Blackout on':'Blackout');
 // Chips show the blind buffer while blind (what the operator is editing), else the live frames.
 const chipFrames=new Map((r.blind?.enabled&&r.previewFrames?r.previewFrames:r.frames).map(f=>[f.id,f])),chipOverrides=progOverrides(r);
 for(const el of $$('[data-fixture]')){const f=chipFrames.get(el.dataset.fixture);if(!f)continue;const fx=fixture(f.id);paintDot(el,el.querySelector('i'),hexOf(outputRGB(fx?.profile,f.color,f.white,fx,f)),f.intensity,9,!!chipOverrides[f.id])}
 stage?.update(viewSource==='preview'&&r.previewFrames?r.previewFrames:r.frames);if(document.body.classList.contains('grid-view'))paintGroupGrid(viewSource==='preview'&&r.previewFrames?r.previewFrames:r.frames);
 $$('[data-preview-entry]').forEach(b=>b.classList.toggle('active',!!r.preview&&r.preview.page===p?.id&&r.preview.entry===b.dataset.previewEntry));
 const state=progFrames(r).find(f=>f.id===selected[0]);
 if(state)for(const el of $$('[data-attr]')){if(document.activeElement===el||performance.now()-(+el.dataset.editedAt||0)<180)continue;const k=el.dataset.attr,f=fixture(selected[0]),wheel=k.startsWith('colorWheel')&&f&&WHEEL.includes(f.profile)?fixtureWheel(f,state):null,v=progOverrides(r)[selected[0]]?.[k]??(k==='intensity'?(r.master?state.intensity/r.master:0):wheel?(k==='colorWheel'?wheel.value:wheel.secondary):state[k]);if(typeof v!=='number')continue;el.value=v*(['pan','tilt'].includes(k)?255:1);setText($(`[data-read="${k}"]`),attrRead(k,v))}
 const pending=selected.filter(id=>r.lampCommands?.[id]);$$('[data-lamp]').forEach(b=>b.disabled=!r.output.armed||pending.length>0);if($('#lampStatus'))setText($('#lampStatus'),pending.length?`Sending ${r.lampCommands[pending[0]].action} · ${Math.ceil(r.lampCommands[pending[0]].remaining)}s`:r.output.armed?'Applies to selected MH7s':'Arm output to control lamps');
 syncPopout();
 if(show&&r.revision!==rev)quiet(refresh());
}

// ── Wiring ──
$$('.mode-switch [data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('#newPage').onclick=newPage;
$('#blindButton').onclick=()=>setBlind(!runtime.blind?.enabled);
$('#goButton').onclick=()=>go(standby);
$('#backButton').onclick=()=>quiet(command('page.back',{}));
$('#stopButton').onclick=()=>{standby=null;quiet(command('cue.stop',{fade:1.5}))};
$('#saveButton').onclick=saveDialog;
$('#agentChip').onclick=agentHelp;
// Under the stage: the fixture buttons or the masters, per viewer (remembered on this Mac); clicking the lit one hides the
// pane. Clicking empty space selects none.
$$('[data-pane]').forEach(b=>b.onclick=()=>setPane(paneShown()===b.dataset.pane?'none':b.dataset.pane));
$('#bankPrev').onclick=()=>pageBank(-1);$('#bankNext').onclick=()=>pageBank(1);$('#masterBank').addEventListener('scroll',paintBank,{passive:true});new ResizeObserver(()=>paintBank()).observe($('#masterBank'));
$('#libBack').onclick=()=>{libPeek=false;if(runtime?.preview)stopPreview();applyStageView()};
$$('[data-rail]').forEach(b=>b.onclick=()=>{railTab=b.dataset.rail;store.set('railTab',railTab);drawPages()});
// Side panels: drag the inner edge (pages 150–360 px, right panel 300–640 px), double-click it to reset, or use its button
// to hide and show the panel. Widths are a per-viewer convenience in browser storage, not in the show.
const PANELS={rail:{min:150,max:360,prop:'--rail-w',name:'pages panel'},side:{min:300,max:640,prop:'--side-w',name:'right panel'}};
function applyPanels(){
 const ws=$('.workspace');for(const [k,p] of Object.entries(PANELS)){const w=+store.get(k+'Width',0),hidden=store.get(k+'Collapsed','no')==='yes',b=$(`[data-collapse="${k}"]`);
  ws.classList.toggle(k+'-collapsed',hidden);if(hidden)ws.style.setProperty(p.prop,'0px');else if(w)ws.style.setProperty(p.prop,w+'px');else ws.style.removeProperty(p.prop);
  b.innerHTML=icon(hidden===(k==='rail')?'collapseRight':'collapseLeft');b.setAttribute('aria-label',(hidden?'Show the ':'Hide the ')+p.name);b.title=b.getAttribute('aria-label')}
}
for(const h of $$('[data-resize]')){const k=h.dataset.resize,p=PANELS[k];
 h.onpointerdown=e=>{if(e.button!==0||e.target.closest('button'))return;e.preventDefault();h.setPointerCapture(e.pointerId);document.body.classList.add('resizing');const ws=$('.workspace').getBoundingClientRect();
  h.onpointermove=ev=>{store.set(k+'Collapsed','no');store.set(k+'Width',Math.round(Math.max(p.min,Math.min(p.max,k==='rail'?ev.clientX-ws.left:ws.right-ev.clientX))));applyPanels()};
  h.onpointerup=h.onpointercancel=()=>{h.onpointermove=null;document.body.classList.remove('resizing')}};
 h.ondblclick=e=>{if(e.target.closest('button'))return;store.set(k+'Width','');store.set(k+'Collapsed','no');applyPanels()};
}
$$('[data-collapse]').forEach(b=>b.onclick=()=>{const k=b.dataset.collapse;store.set(k+'Collapsed',store.get(k+'Collapsed','no')==='yes'?'no':'yes');applyPanels()});
applyPanels();
const clearIfEmpty=e=>{if(e.target===e.currentTarget&&(selected.length||group)){applySelection([]);quiet(command('selection.set',{ids:[]}))}};
for(const el of [$('.fixture-strip'),$('#fixtureChips'),$('#groupGrid'),$('#viewport')])if(el)el.addEventListener('click',clearIfEmpty);
$('#highlightButton').onclick=()=>quiet(command('highlight.set',{enabled:!runtime?.highlight}));
$('#releaseButton').onclick=()=>quiet(command('override.release',{}).then(()=>drawSide()));
$('#blackout').onclick=()=>quiet(command('blackout.set',{enabled:!runtime.blackout}));
$('#master').oninput=e=>{const v=+e.target.value/100;setText($('#masterValue'),Math.round(v*100)+'%');liveMaster([],{value:v})};
$('#haze').oninput=e=>{if(stage)stage.haze=+e.target.value/100};
// Visualizer fixtures: hidden groups are not drawn at all (visualizer.hide), so big rigs stay fast. Output is unaffected.
function layersDialog(){const v=show.visualizer??{hiddenGroups:[],hiddenFixtures:[]},hidden=hiddenFixtureIds(show);
 dialog('Visualizer fixtures',`<p class="hint">Unticked groups are not drawn in the 3D view at all, which keeps it fast. Their lights, cues and output are unaffected. ${hidden.size} of ${show.fixtures.length} fixtures hidden.</p><div class="pool-list">${show.groups.map(g=>`<label class="pool-row"><input type="checkbox" data-layer="${esc(g.id)}" ${v.hiddenGroups.includes(g.id)?'':'checked'}><strong>${esc(g.name)}</strong><small>${g.fixtures.length}</small></label>`).join('')}</div>${v.hiddenFixtures.length?`<button class="ghost-button" id="layersShowFixtures">Show ${v.hiddenFixtures.length} individually hidden</button>`:''}`);
 $$('[data-layer]').forEach(c=>c.onchange=async()=>{await quiet(command('visualizer.hide',{groups:[c.dataset.layer],hidden:!c.checked}));layersDialog()});
 if($('#layersShowFixtures'))$('#layersShowFixtures').onclick=async()=>{await quiet(command('visualizer.hide',{fixtures:v.hiddenFixtures,hidden:false}));layersDialog()};
}
$('#visLayers').onclick=layersDialog;
$$('[data-view]').forEach(b=>b.onclick=()=>{stage.setView(b.dataset.view);$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));paint(runtime)});
$('#ledButton').onclick=()=>{ledOpen=!ledOpen;drawLedTray()};
$('#outputButton').onclick=armDialog;$('#outputHintArm').onclick=armDialog;$('#outputHintClose').onclick=()=>{outputHintDismissed=true;$('#outputHint').hidden=true};
$('#menuButton').onclick=e=>{e.stopPropagation();const open=$('#menu').hidden;$('#menu').hidden=!open;$('#menuButton').setAttribute('aria-expanded',String(open))};
document.addEventListener('click',e=>{if(!e.target.closest('#ctxMenu'))closeMenu();if(!$('#masterPop').hidden&&!e.target.closest('#masterPop,[data-master-edit]'))closeMasterPop();if(learning&&!e.target.closest('[data-master-key],#mpKey')){learning=null;drawMasters()}if(!$('#menu').hidden&&!e.target.closest('.menu-wrap')){$('#menu').hidden=true;$('#menuButton').setAttribute('aria-expanded','false')}});
$$('[data-menu]').forEach(b=>b.onclick=()=>{$('#menu').hidden=true;({agent:agentHelp,connection,settings:settingsDialog,patch:patchSheet,network:networkSheet,export:()=>window.open('/api/show'),import:importDialog,help:helpDialog,update:updatesDialog})[b.dataset.menu]()});
$('#closeDialog').onclick=()=>$('#dialog').close();$('#dialog').onclick=e=>{if(e.target===$('#dialog'))$('#dialog').close()};
// Keys: Space GO, Backspace back, Esc cancels, ← → page the masters; Clear, Highlight and Blackout and every master key
// come from show.masters (desk shortcuts default to C, Shift+H, B). A held master key flashes until it is let go.
document.addEventListener('keydown',e=>{
 if(learning){e.preventDefault();learnKey(e);return}
 if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||$('#dialog').open||document.activeElement.id==='joystick')return;
 if(e.key==='Escape'){if(!$('#masterPop').hidden)closeMasterPop();else if(!$('#ctxMenu').hidden){closeMenu()}else if(runtime?.preview){stopPreview()}else if(aligning){cancelAlignment();drawSide()}else if(!$('#menu').hidden)$('#menu').hidden=true;else if(ledOpen){ledOpen=false;drawLedTray()}else if(selected.length){applySelection([]);quiet(command('selection.set',{ids:[]}))}return}
 if(e.code==='Space'){e.preventDefault();$('#goButton').click()}
 else if(e.key==='Backspace'){e.preventDefault();$('#backButton').click()}
 else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&paneShown()==='masters'){e.preventDefault();pageBank(e.key==='ArrowLeft'?-1:1)}
 else{const k=keyOf(e),desk=show?.masters.desk;if(!k||!desk)return;
  if(k===desk.clear)$('#releaseButton').click();else if(k===desk.highlight)$('#highlightButton').click();else if(k===desk.blackout)$('#blackout').click();
  else{const m=slots().find(x=>x.key===k);if(!m)return;e.preventDefault();if(e.repeat)return;
   if(!m.cue)return toast(`${keyLabel(k)} is master ${slotIndex(m.id)+1}, which has no cue yet. Click it to choose one.`);heldKeys.set(e.code,m.id);pressMaster(m.id)}}
});
document.addEventListener('keyup',e=>{const id=heldKeys.get(e.code);if(id){heldKeys.delete(e.code);releaseMaster(id)}});
addEventListener('blur',releaseAllMasters);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAllMasters()});
async function start(){
 fillIcons();document.body.dataset.mode=mode;$$('.mode-switch [data-mode]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mode===mode)));
 try{token=(await fetch('/api/session').then(r=>r.json())).token;schema=await fetch('/api/schema').then(r=>r.json());await refresh();
  stage=new Stage($('#viewport'),show.fixtures,selectFixture);stage.select(selected);syncLedWall();stage.update(runtime.frames);applyStageView();
  $$('[data-stage-view]').forEach(b=>b.onclick=()=>{if(b.dataset.stageView==='stage'&&visOut()){visWin.focus();return toast('The visualizer is in its own window. Use the dock button to bring it back.')}stageView=b.dataset.stageView;store.set('stageView',stageView);applyStageView()});
  $('#popoutButton').onclick=popOutVisualizer;
  // Desktop app: look for a newer release a few seconds after start and every six hours. Nothing installs by itself.
  if(shell){$('[data-menu=update]').hidden=false;setTimeout(()=>checkUpdate(),5000);setInterval(()=>checkUpdate(),6*3600e3)}
  const events=new EventSource('/api/events');events.onopen=async()=>{try{token=(await fetch('/api/session').then(r=>r.json())).token;await refresh()}catch(e){toast('Engine reconnect failed: '+e.message)}};events.onmessage=e=>paint(JSON.parse(e.data));events.onerror=()=>{$('#engineStatus').innerHTML='<i class="off"></i>Engine offline'};
 }catch(e){toast('Could not connect to the engine: '+e.message);$('#engineStatus').innerHTML='<i class="off"></i>Engine offline'}
}
start();
