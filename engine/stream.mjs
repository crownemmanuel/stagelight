// The desk's runtime stream, /api/events?delta=1 (docs/VISUALIZER-PERFORMANCE.md). The runtime is ~40 kB, almost all of it
// one frame per fixture, and while output is armed something in it changes every frame (packets, lastSent), so it went
// out whole ten times a second: ~400 kB/s per desk during the 2026-11-01 show. Here frames go as deltas, only the
// attributes that changed since the last message, numbers rounded to 6 decimals (finer than a 16-bit DMX step). Every
// desk gets the same messages, so each holds exactly the last broadcast state; one that connects later starts from that
// state as a full message. public/stream.js merges them back into the runtime the desk always had.
const r6=v=>typeof v==='number'?Math.round(v*1e6)/1e6:Array.isArray(v)?v.map(r6):v;
const compact=f=>{const o={};for(const k in f)o[k]=r6(f[k]);return o};
const eq=(x,y)=>x===y||(Array.isArray(x)&&Array.isArray(y)&&x.length===y.length&&x.every((v,i)=>v===y[i]));
// Changed attributes of each frame, or null when the fixture list itself changed (then the frames go whole).
function diff(prev,next){
 if(!prev||prev.length!==next.length)return null;const d={};
 for(let i=0;i<next.length;i++){const a=prev[i],b=next[i];if(a.id!==b.id)return null;let c=null;for(const k in b)if(!eq(a[k],b[k]))(c??={})[k]=b[k];for(const k in a)if(!(k in b))(c??={})[k]=null;if(c)d[b.id]=c}
 return d;
}
// Every other top-level field goes only when it changed (gone: fields that disappeared, e.g. runtime.sound when the input
// closes). tickCount rides along; output's packet counters change every frame while armed and never cause a message
// by themselves (the old stream re-sent everything ten times a second during a show because of them).
const steady=({packets,bytes,lastSent,...o})=>o;
const keys=rest=>{const o={};for(const k in rest)if(k!=='tickCount')o[k]=JSON.stringify(k==='output'&&rest.output?steady(rest.output):rest[k]);return o};
export class RuntimeStream{
 constructor(){this.last=null}
 // The message to broadcast for this runtime, or null when nothing worth sending changed.
 next(runtime){
  const {frames,previewFrames,...rest}=runtime,f=frames.map(compact),p=previewFrames?previewFrames.map(compact):null,ks=keys(rest),last=this.last;this.last={rest,ks,f,p};
  if(!last)return {k:'full',...rest,frames:f,previewFrames:p};
  const fd=diff(last.f,f);if(!fd)return {k:'full',...rest,frames:f,previewFrames:p};
  const changed=Object.keys(ks).filter(k=>ks[k]!==last.ks[k]),gone=Object.keys(last.ks).filter(k=>!(k in ks));
  const msg={k:'delta',tickCount:rest.tickCount,fd,...Object.fromEntries(changed.map(k=>[k,rest[k]])),...(gone.length?{gone}:{})},nf=Object.keys(fd).length;let pchanged=false;
  if(!p){if(last.p){msg.previewFrames=null;pchanged=true}}
  else{const pd=diff(last.p,p);if(pd){if(Object.keys(pd).length){msg.pd=pd;pchanged=true}}else{msg.previewFrames=p;pchanged=true}}
  return nf||pchanged||changed.length||gone.length?msg:null;
 }
 // What a desk that connects now needs: the last broadcast state, whole.
 full(runtime){if(!this.last)return this.next(runtime);const {rest,f,p}=this.last;return {k:'full',...rest,frames:f,previewFrames:p}}
}
