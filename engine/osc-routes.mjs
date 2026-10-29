// StageLight's OSC namespace for sister apps (LiveStage, the Sound app, camera control…).
// Pure routing: (address, args, show, runtime) → {command, args} for the engine, or {reply} for ping.
import {zoneFixtures} from './model.mjs';
// Pages and cues may be named by ID, by name (case-insensitive) or by 1-based number, as string or int.
export const OSC_VERSION='0.3.0';
export const OSC_ADDRESSES=[
 ['/stagelight/ping','[i:replyPort]','Reply /stagelight/hello s:StageLight s:version i:armed s:page s:cue i:catalogRevision'],
 ['/stagelight/catalog','[i:replyPort]','Reply with every page, cue, named trigger and library cue (/stagelight/catalog/begin … /end), so another app can offer them in pickers'],
 ['/stagelight/go','[s:page] [s:requestId]','GO the next cue on a page (default: the running page)'],
 ['/stagelight/go/cue','s:page s|i:cue [s:requestId]','GO a specific cue of a page cue list; auto-follow continues from it'],
 ['/stagelight/back','','Previous cue on the running page'],
 ['/stagelight/stop','[f:fade]','Stop playback, fade to dark'],
 ['/stagelight/clear','[f:fade]','Release manual changes back to the cue (Clear)'],
 ['/stagelight/blackout','i:0|1','Blackout on or off'],
 ['/stagelight/master','f:0..1','Master level'],
 ['/stagelight/play','s:cue [f:fade]','Play a library cue outside any page'],
 ['/stagelight/ledwall','s:media','Show media on the LED wall preview (off = blank)'],
 ['/stagelight/masters/trigger','s|i:master i:1|0','Press (1) or let go of (0) a master slot, like its key: slot ID, 1-based number or its key letter. Flash masters need both'],
 ['/stagelight/scene','s:scene [f:fade]','Make a saved scene the active scene (ID, name or 1-based number)'],
 ['/stagelight/scene/release','[f:fade]','Release the active scene'],
 ['/stagelight/trigger','s:name [s:requestId]','Fire a named trigger mapped in StageLight'],
 ['/stagelight/look/get','[s:target] [i:replyPort] [s:requestId]','Look Link: send the live look now (reason request). With a target id or name, through that target\'s own transport and zones; without, reply with the OSC look burst for every zone'],
 ['/stagelight/zones','[i:replyPort]','Look Link: reply /stagelight/zones/begin i:count, /stagelight/zone s:id s:name s:role i:fixtures per zone, /stagelight/zones/end'],
 ['/stagelight/feedback','s:messageId s:status s:summary','Look Link: log an app\'s decision (applied|queued|ignored|failed) against the message it answers (message id, or seq for OSC)'],
 ['/stagelight/presets/begin','i:count [s:target]','Look Link: start publishing an app\'s preset list (filed under the target with the sender\'s host, or the target named)'],
 ['/stagelight/presets/item','s:presetId s:name [s:description]','One preset of the list being published'],
 ['/stagelight/presets/end','','Finish the preset list; it appears in StageLight\'s preset pickers']
];
const text=v=>typeof v==='number'?String(v):typeof v==='string'?v:'';
const num=(v,fallback)=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(+v)?+v:fallback;
export function findPage(show,ref){
 const r=text(ref).trim();if(!r)return null;const n=/^\d+$/.test(r)?+r:0;
 return show.pages.find(p=>p.id===r)??show.pages.find(p=>p.name.toLowerCase()===r.toLowerCase())??(n?show.pages[n-1]:null)??null;
}
export function findEntry(show,page,ref){
 const r=text(ref).trim();if(!r)return null;const n=/^\d+$/.test(r)?+r:0,low=r.toLowerCase(),name=e=>e.label??show.cues.find(c=>c.id===e.cue)?.name??'';
 return page.cues.find(e=>e.id===r)??(n?page.cues[n-1]:null)??page.cues.find(e=>name(e).toLowerCase()===low)??null;
}
const findTrigger=(show,ref)=>{const r=text(ref).trim().toLowerCase();return (show.triggers??[]).find(t=>t.id.toLowerCase()===r||t.name.toLowerCase()===r)};
const FEEDBACK=['applied','queued','ignored','failed'];
const findTarget=(show,ref)=>{const r=ref.toLowerCase();return (show.targets??[]).find(t=>t.id.toLowerCase()===r||t.name.toLowerCase()===r)};
const replyPort=v=>Number.isInteger(v)&&v>0&&v<65536?v:null;
const cueName=(show,e)=>e.label??show.cues.find(c=>c.id===e.cue)?.name??e.cue;
/** What a named trigger does, in words (for pickers in other apps). */
export function triggerSummary(show,t){
 const a=t.args??{};
 switch(t.command){
  case 'page.go':{const p=show.pages.find(x=>x.id===a.id),i=p&&a.entry?p.cues.findIndex(e=>e.id===a.entry):-1;return `GO ${p?.name??a.id}${i>=0?` · cue ${i+1} ${cueName(show,p.cues[i])}`:' · next cue'}`}
  case 'page.back':return 'Back';case 'cue.stop':return 'Stop';case 'override.release':return 'Clear changes';
  case 'blackout.set':return a.enabled?'Blackout on':'Blackout off';case 'master.set':return `Master ${Math.round((a.value??0)*100)}%`;
  case 'ledwall.set':return 'LED wall · '+(a.media??'off');case 'scene.go':return 'Scene · '+(show.scenes?.find(s=>s.id===a.id)?.name??a.id);case 'scene.release':return 'Release scene';case 'cue.play':return 'Play '+(show.cues.find(c=>c.id===a.id)?.name??a.id);
  default:return t.command;
 }
}
const zoneArgs=(show,z)=>[z.id,z.name,z.role,zoneFixtures(show,z).filter(id=>show.fixtures.find(f=>f.id===id)?.enabled).length];
/** The show's pages, cues, named triggers and library cues as small OSC messages, one per item (like StageMics' /sound/mic). */
export function catalog(show,revision){
 const triggers=show.triggers??[],out=[['/stagelight/catalog/begin',[revision,show.pages.length,triggers.length,show.cues.length]]];
 show.pages.forEach((p,i)=>{out.push(['/stagelight/catalog/page',[p.id,p.name,i+1,p.cues.length,p.color??'']]);
  p.cues.forEach((e,j)=>out.push(['/stagelight/catalog/cue',[p.id,j+1,e.id,cueName(show,e),e.follow==='auto'?'auto':'manual',{t:'f',v:e.fade??0}]]))});
 for(const t of triggers)out.push(['/stagelight/catalog/trigger',[t.id,t.name,triggerSummary(show,t)]]);
 for(const c of show.cues)out.push(['/stagelight/catalog/library',[c.id,c.name]]);
 for(const z of show.zones??[])out.push(['/stagelight/catalog/zone',zoneArgs(show,z)]);
 out.push(['/stagelight/catalog/end',[revision]]);return out;
}
const requestId=v=>{const r=text(v).trim();return /^[a-zA-Z0-9_-]{1,64}$/.test(r)?{requestId:r}:{}};
export function routeOSC(address,args,show,runtime){
 const a=args,need=(page)=>{if(!page)throw Error('Unknown page');return page};
 switch(address.replace(/\/+$/,'')){
  case '/stagelight/ping':{const pg=runtime.stack&&show.pages.find(p=>p.id===runtime.stack.page),e=pg?.cues.find(x=>x.id===runtime.stack.entry);
   return {reply:['/stagelight/hello',['StageLight',OSC_VERSION,runtime.output.armed?1:0,pg?.name??'',e?(e.label??show.cues.find(c=>c.id===e.cue)?.name??''):'',runtime.revision??0]],replyPort:replyPort(a[0])}}
  case '/stagelight/catalog':return {replies:catalog(show,runtime.revision??0),replyPort:replyPort(a[0])};
  case '/stagelight/go':{const page=a.length&&text(a[0]).trim()?need(findPage(show,a[0])):show.pages.find(p=>p.id===runtime.stack?.page);if(!page)throw Error('Name a page: /stagelight/go "<page>"');return {command:'page.go',args:{id:page.id,...requestId(a[1])}}}
  case '/stagelight/go/cue':{const page=need(findPage(show,a[0])),entry=findEntry(show,page,a[1]);if(!entry)throw Error(`No cue ${text(a[1])} on ${page.name}`);return {command:'page.go',args:{id:page.id,entry:entry.id,...requestId(a[2])}}}
  case '/stagelight/back':return {command:'page.back',args:{}};
  case '/stagelight/stop':{const f=num(a[0]);return {command:'cue.stop',args:f===undefined?{}:{fade:Math.max(0,Math.min(10,f))}}}
  case '/stagelight/clear':{const f=num(a[0]);return {command:'override.release',args:f===undefined?{}:{fade:Math.max(0,Math.min(30,f))}}}
  case '/stagelight/blackout':{const v=a[0]===true||num(a[0])===1?true:a[0]===false||num(a[0])===0?false:null;if(v===null)throw Error('Blackout needs 0 or 1');return {command:'blackout.set',args:{enabled:v}}}
  case '/stagelight/master':{let v=num(a[0]);if(v===undefined)throw Error('Master needs a level 0..1');if(v>1)v/=100;return {command:'master.set',args:{value:Math.max(0,Math.min(1,v))}}}
  case '/stagelight/play':{const r=text(a[0]).trim(),cue=show.cues.find(c=>c.id===r)??show.cues.find(c=>c.name.toLowerCase()===r.toLowerCase());if(!cue)throw Error('Unknown cue '+r);const f=num(a[1]);return {command:'cue.play',args:{id:cue.id,...(f===undefined?{}:{fade:Math.max(0,Math.min(60,f))})}}}
  case '/stagelight/ledwall':return {command:'ledwall.set',args:{media:text(a[0]).trim()||'off'}};
  case '/stagelight/masters/trigger':{const r=text(a[0]).trim().toLowerCase(),slots=show.masters?.slots??[],n=/^\d+$/.test(r)?+r:0;
   const slot=slots.find(m=>m.id.toLowerCase()===r)??(n?slots[n-1]:null)??slots.find(m=>m.key===r);if(!slot)throw Error('Unknown master '+text(a[0]));
   const v=num(a[1]);if(v!==0&&v!==1)throw Error('Masters need 1 (press) or 0 (let go)');return {command:'masters.trigger',args:{slot:slot.id,down:v===1}}}
  case '/stagelight/scene':{const r=text(a[0]).trim(),scenes=show.scenes??[],n=/^\d+$/.test(r)?+r:0;
   const sc=scenes.find(s=>s.id===r)??scenes.find(s=>s.name.toLowerCase()===r.toLowerCase())??(n?scenes[n-1]:null);if(!sc)throw Error('Unknown scene '+r);const f=num(a[1]);return {command:'scene.go',args:{id:sc.id,...(f===undefined?{}:{fade:Math.max(0,Math.min(60,f))})}}}
  case '/stagelight/scene/release':{const f=num(a[0]);return {command:'scene.release',args:f===undefined?{}:{fade:Math.max(0,Math.min(60,f))}}}
  case '/stagelight/look/get':{let i=0;const ref=typeof a[0]==='string'?text(a[i++]).trim():'';const port=replyPort(a[i]);if(typeof a[i]==='number'||a[i]==='')i++;const rid=requestId(a[i]);
   if(!ref)return {lookReply:true,replyPort:port,...rid};const t=findTarget(show,ref);if(!t)throw Error('Unknown target '+ref);return {command:'look.send',args:{target:t.id,...rid}}}
  case '/stagelight/zones':{const zones=show.zones??[];return {replies:[['/stagelight/zones/begin',[zones.length]],...zones.map(z=>['/stagelight/zone',zoneArgs(show,z)]),['/stagelight/zones/end',[]]],replyPort:replyPort(a[0])}}
  case '/stagelight/feedback':{const id=text(a[0]).trim(),status=text(a[1]).trim().toLowerCase();if(!id)throw Error('Feedback needs the message id');if(!FEEDBACK.includes(status))throw Error('Feedback status is applied, queued, ignored or failed');return {feedback:{id:id.slice(0,64),status,summary:text(a[2]).replace(/[\u0000-\u001f]/g,' ').slice(0,200)}}}
  case '/stagelight/presets/begin':return {presets:{phase:'begin',count:num(a[0]),target:text(a[1]).trim()||undefined}};
  case '/stagelight/presets/item':{const id=text(a[0]).trim();if(!id)throw Error('A preset needs an id');return {presets:{phase:'item',item:{id,name:text(a[1]).trim()||id,...(text(a[2]).trim()?{description:text(a[2]).trim()}:{})}}}}
  case '/stagelight/presets/end':return {presets:{phase:'end'}};
  case '/stagelight/trigger':{const t=findTrigger(show,a[0]);if(!t)throw Error('Unknown trigger '+text(a[0]));return {command:'trigger.fire',args:{id:t.id,...requestId(a[1])}}}
 }
 throw Error('Unknown StageLight address '+address);
}
