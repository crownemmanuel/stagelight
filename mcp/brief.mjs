// What an agent gets back from a command over MCP. The engine's reply carries the whole runtime (every fixture's frame,
// about 46 KB on the venue rig), which the desk wants and an agent's context cannot afford on every call. This keeps what
// tells the agent its command landed and what is live now; lights_overview and lights_status {only} read the rest.
export function briefRuntime(r){
 if(!r||typeof r!=='object')return r;const frames=Array.isArray(r.frames)?r.frames:[];
 return {revision:r.revision,output:{armed:!!r.output?.armed,failing:!!r.output?.failing,...(r.output?.lastError?{lastError:r.output.lastError}:{})},blackout:r.blackout,master:r.master,locked:r.locked,lit:frames.filter(f=>f.intensity>.01).length,fixtures:frames.length,
  scene:r.scene??null,running:r.running??[],stack:r.stack?{page:r.stack.page,entry:r.stack.entry,index:r.stack.index,count:r.stack.count,next:r.stack.next}:null,
  selection:{group:r.selection?.group??null,ids:(r.selection?.ids?.length??0)>40?`${r.selection.ids.length} fixtures`:r.selection?.ids??[]},
  programmer:{fixtures:Object.keys(r.overrides??{}),effects:(r.fx??[]).map(x=>({id:x.id,name:x.name,effect:x.effect,layer:x.layer,fixtures:x.fixtures?.length??0}))},
  ...(r.fxPreview?{fxPreview:{name:r.fxPreview.name,effect:r.fxPreview.effect,fixtures:r.fxPreview.fixtures?.length??0}}:{}),...(r.preview?{preview:{id:r.preview.id,name:r.preview.name}}:{}),...(r.blind?.enabled?{blind:{fixtures:r.blind.fixtures}}:{}),...(r.highlight?{highlight:true}:{}),...(r.find?.active?{find:r.find}:{}),
  ...(r.parked?.length?{parked:r.parked}:{}),...(r.kills?.length?{kills:r.kills}:{}),...(r.tempo?.bpm?{tempo:r.tempo.bpm}:{}),...(r.effectErrors?.length?{effectErrors:r.effectErrors}:{}),...(r.engineError?{engineError:r.engineError}:{}),
  note:'Brief runtime. lights_status {only:["frames"], ids:[...]} reads fixture values; lights_overview reads the show.'};
}
/** A command's reply for an agent: the same result, with runtime made brief. status keeps its full runtime: it was asked for. */
export function briefReply(command,result){if(command==='status'||!result||typeof result!=='object'||!result.runtime)return result;return {...result,runtime:briefRuntime(result.runtime)}}
