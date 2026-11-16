// Merges a /api/events?delta=1 message (engine/stream.mjs) into the runtime the desk already holds. A full message
// replaces it. A delta carries only the fields that changed (gone lists removed ones); every unchanged frame object is
// kept as it was (so the stage skips re-resolving it) and a changed fixture gets a new object with the new attributes.
const apply=(list,d)=>list.map(f=>{const c=d[f.id];if(!c)return f;const n={...f,...c};for(const k in c)if(c[k]===null)delete n[k];return n});
export function mergeRuntime(prev,m){
 const {k,fd,pd,gone,...r}=m;if(k!=='delta'||!prev)return r;
 const out={...prev,...r};for(const g of gone??[])delete out[g];
 out.frames=fd&&Object.keys(fd).length?apply(prev.frames,fd):prev.frames;
 if(!('previewFrames' in m))out.previewFrames=pd?apply(prev.previewFrames??[],pd):prev.previewFrames??null;
 return out;
}
