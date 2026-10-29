import {Stage} from './stage.js?v=ui-2';
import {icon} from './icons.js?v=ui-3';
// Pop-out visualizer: a second window (e.g. on another screen) with its own 3D stage, fed by the same
// engine stream. It is a view only; selection goes through selection.set like the main window.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let show,runtime,schema,token,stage,rev=0,selectionRevision=-1;
// 'live' | 'preview' as chosen in the main window; null until it tells us (or with no main window).
let source=null;
const opener=()=>{try{return window.opener&&!window.opener.closed?window.opener:null}catch{return null}};
const tell=type=>{try{opener()?.postMessage({type},location.origin)}catch{}};
const mediaList=()=>[...(schema?.media??[]),...(show?.media??[])];
async function command(name,args={}){const r=await fetch('/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':token},body:JSON.stringify({command:name,args})});const v=await r.json();if(!r.ok)throw Error(v.error);return v}
function frames(r){
 if(!r.previewFrames)return r.frames;
 if(source)return source==='preview'?r.previewFrames:r.frames;
 return r.preview||r.blind?.enabled||r.fxPreview?r.previewFrames:r.frames;
}
async function refresh(){
 const v=await fetch('/api/state').then(r=>r.json());show=v.show;rev=v.runtime.revision;
 stage.setFixtures(show.fixtures);stage.setLedWall(show.ledWall,mediaList().find(m=>m.id===show.ledWall?.media));selectionRevision=-1;paint(v.runtime);
}
function paint(r){
 runtime=r;const shown=frames(r),preview=shown!==r.frames;stage.update(shown);stage.setLedPlaying(!r.output.armed);
 const label=preview?(r.blind?.enabled?'Blind':'Preview'):r.output.armed?'Live output':'Live · output off';
 if($('#visSource').textContent!==label)$('#visSource').textContent=label;
 document.body.classList.toggle('live',r.output.armed);document.body.classList.toggle('viewing-preview',preview);
 if(r.selection&&r.selection.revision!==selectionRevision){selectionRevision=r.selection.revision;stage.select(r.selection.ids)}
 $('#engineStatus').innerHTML='<i></i>Engine ready';
 if(show&&r.revision!==rev){rev=r.revision;refresh().catch(()=>{})}
}
function select(id,event={}){
 const cur=runtime?.selection?.ids??[];if(id==null){if(!event.shiftKey&&cur.length)command('selection.set',{ids:[]}).catch(()=>{});return}
 const ids=event.shiftKey?(cur.includes(id)?cur.filter(x=>x!==id):[...cur,id]):[id];
 command('selection.set',{ids}).catch(()=>{});
}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='view-source'){source=e.data.source;if(runtime)paint(runtime)}});
// The main window links up on hello (also after it reloads) and docks the visualizer again when we close.
window.addEventListener('pagehide',()=>tell('visualizer-closed'));
setInterval(()=>{tell('visualizer-hello');$('#visDock').hidden=!opener()},1000);
async function start(){
 for(const el of $$('[data-icon]'))el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon));
 $('#visDock').hidden=!opener();$('#visDock').onclick=()=>{tell('visualizer-closed');window.close()};
 try{
  token=(await fetch('/api/session').then(r=>r.json())).token;schema=await fetch('/api/schema').then(r=>r.json());
  const v=await fetch('/api/state').then(r=>r.json());show=v.show;rev=v.runtime.revision;
  stage=new Stage($('#viewport'),show.fixtures,select);stage.setLedWall(show.ledWall,mediaList().find(m=>m.id===show.ledWall?.media));paint(v.runtime);tell('visualizer-hello');
  $$('[data-view]').forEach(b=>b.onclick=()=>{stage.setView(b.dataset.view);$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b))});
  $('#haze').oninput=e=>{stage.haze=+e.target.value/100};
  const events=new EventSource('/api/events');
  events.onopen=async()=>{try{token=(await fetch('/api/session').then(r=>r.json())).token;await refresh()}catch{}};
  events.onmessage=e=>paint(JSON.parse(e.data));
  events.onerror=()=>{$('#engineStatus').innerHTML='<i class="off"></i>Engine offline'};
 }catch(e){$('#engineStatus').innerHTML='<i class="off"></i>Engine offline'}
}
start();
