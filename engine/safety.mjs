// Show safety (docs/SHOW-SAFETY.md): show versions and the live-state file used to offer a resume after a crash.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';

// Plain words for the disk errors an operator can act on.
const WHY={ENOSPC:'the disk is full',EDQUOT:'the disk quota is used up',EROFS:'the disk is read-only',EACCES:'permission was refused',EPERM:'permission was refused',ENOENT:'the folder does not exist',ENOTDIR:'a folder in the path is a file',EISDIR:'a folder is in the way',EMFILE:'too many files are open',EIO:'the disk reported an input/output error'};
export const diskError=(e,file,what='save')=>Object.assign(Error(`Could not ${what} ${file}: ${WHY[e?.code]??e?.message??String(e)}${WHY[e?.code]?` (${e.code})`:''}`),{code:e?.code,cause:e});
// Atomic write: a temporary file next to the target, flushed to disk, then renamed over it. A full disk or a read-only
// folder leaves the old file untouched and no half-written temp file behind, and throws a clear error instead.
export function writeAtomic(file,text){
 const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;let fd=null;
 try{fd=fs.openSync(tmp,'w');fs.writeSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file)}
 catch(e){if(fd!==null)try{fs.closeSync(fd)}catch{}try{fs.rmSync(tmp,{force:true})}catch{}throw diskError(e,file)}
}

// Timestamped copies of the show in <data>/versions: at most one per five minutes of edits, and always before an import
// or a restore and when the performance lock goes on. Keeps the newest 50 plus the last one of each older day.
const KEEP=50,EVERY=300;
const stamp=d=>d.toISOString().replace(/[:.]/g,'-');
const VERSION_ID=/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z-(.+)$/;
export class Versions{
 constructor(dir,clock=()=>Date.now()/1000){this.dir=dir?path.join(dir,'versions'):null;this.clock=clock;this.last=-Infinity;this.error=null}
 // Explicit snapshots (before an import, a restore, the lock) throw when the copy cannot be written, so the step that
 // needed a backup is refused rather than run without one.
 snapshot(show,reason){
  if(!this.dir)return null;try{fs.mkdirSync(this.dir,{recursive:true})}catch(e){throw diskError(e,this.dir,'create')}let id=`${stamp(new Date())}-${reason}`;
  for(let n=2;fs.existsSync(path.join(this.dir,id+'.json'));n++)id=`${stamp(new Date())}-${reason}-${n}`;
  writeAtomic(path.join(this.dir,id+'.json'),JSON.stringify(show));this.last=this.clock();this.error=null;
  try{this.prune(id)}catch{}return id;
 }
 // The five-minute copy after an edit never fails the edit itself (the show is already saved): the error is kept for
 // the pre-show check and tried again on the next edit.
 edited(show){if(this.clock()-this.last<EVERY)return;try{this.snapshot(show,'edits')}catch(e){this.error=e.message;this.last=this.clock()-EVERY+30}}
 list(){
  if(!this.dir||!fs.existsSync(this.dir))return [];let files;try{files=fs.readdirSync(this.dir)}catch{return []}
  return files.filter(f=>f.endsWith('.json')&&!f.startsWith('.')).sort().reverse().flatMap(f=>{const id=f.slice(0,-5),m=VERSION_ID.exec(id);let st;try{st=fs.statSync(path.join(this.dir,f))}catch{return []}
   return [{id,at:m?`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`:null,reason:m?.[6]??'',bytes:st.size,mtime:st.mtimeMs}]}).map(({mtime,...v})=>v);
 }
 read(id){const f=this.dir&&/^[\w.-]{1,120}$/.test(id)&&path.join(this.dir,id+'.json');if(!f||!fs.existsSync(f))throw Error('Unknown show version '+id);return JSON.parse(fs.readFileSync(f,'utf8'))}
 // Only StageLight's own version files are ever removed. The newest KEEP by name and the newest KEEP by modified time
 // are kept (so a Mac clock set back cannot make the copies just written look old), and so is the one just written.
 prune(just){
  if(!this.dir)return;const all=this.list().filter(v=>v.at),keep=new Set(all.slice(0,KEEP).map(v=>v.id)),days=new Set();if(just)keep.add(just);
  const mtime=id=>{try{return fs.statSync(path.join(this.dir,id+'.json')).mtimeMs}catch{return 0}};
  for(const v of [...all].sort((a,b)=>mtime(b.id)-mtime(a.id)).slice(0,KEEP))keep.add(v.id);
  for(const v of all.slice(KEEP)){const day=v.at.slice(0,10);if(!days.has(day)){days.add(day);keep.add(v.id)}}
  for(const v of all)if(!keep.has(v.id))try{fs.rmSync(path.join(this.dir,v.id+'.json'),{force:true})}catch{}
 }
}

// What is live (armed, scene, cue, master, tempo, lock) is mirrored to <data>/live-state.json a second after it
// changes and marked clean on a normal shutdown. An unclean file at startup becomes an offer to resume, never an action.
// A missing, empty or corrupt file reads as "nothing to resume"; it never stops the engine starting.
export class LiveState{
 constructor(dir){this.file=dir?path.join(dir,'live-state.json'):null;this.timer=null;this.error=null}
 read(){try{if(!this.file||!fs.existsSync(this.file))return null;const v=JSON.parse(fs.readFileSync(this.file,'utf8'));return v&&typeof v==='object'&&!Array.isArray(v)?v:null}catch{return null}}
 schedule(get){if(!this.file||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;try{this.write(get())}catch(e){this.error=e.message}},1000);this.timer.unref?.()}
 write(state){if(!this.file)return;try{writeAtomic(this.file,JSON.stringify(state));this.error=null}catch(e){this.error=e.message}}
 close(state){clearTimeout(this.timer);this.timer=null;this.write({...state,clean:true})}
}

// Startup with an unreadable show (docs/SHOW-SAFETY.md). make() builds the engine from <data>/show.json; check(raw)
// throws when a parsed show would not load. If show.json itself is the problem it is moved aside as
// show.unreadable-<time>.json and the newest version that loads is put in its place. The bad file is copied aside, never
// moved: show.json is only ever replaced whole by a version that loads, so no crash part-way can leave the folder without
// a show (an engine that finds none starts on the default show). If no version loads, the error names the file.
export function openShow({dataDir,make,check,log=()=>{}}){
 let first;try{return {engine:make(),recovered:null}}catch(e){first=e}
 const file=path.join(dataDir,'show.json');if(!fs.existsSync(file))throw first;
 let why;try{check(JSON.parse(fs.readFileSync(file,'utf8')))}catch(e){why=e.message}
 if(!why)throw first;
 const aside=path.join(dataDir,`show.unreadable-${stamp(new Date())}.json`);
 try{fs.copyFileSync(file,aside)}catch(e){throw Object.assign(Error(`${file} is unreadable (${why}) and could not be copied aside: ${e.message}`),{cause:first})}
 log(`show.json could not be read (${why}). Kept a copy as ${path.basename(aside)}.`);
 const versions=new Versions(dataDir),tried=[];
 for(const v of versions.list()){
  try{const raw=versions.read(v.id);check(structuredClone(raw));writeAtomic(file,JSON.stringify(raw,null,2));const engine=make();return {engine,recovered:{aside,version:v.id,why,tried}}}
  catch(e){tried.push(`${v.id}: ${e.message}`);log(`Version ${v.id} did not load either: ${e.message}`)}
 }
 try{if(fs.readFileSync(file).equals(fs.readFileSync(aside)))fs.rmSync(aside,{force:true});else fs.copyFileSync(aside,file)}catch{}
 throw Object.assign(Error(`StageLight cannot start: ${file} is unreadable (${why}) and no saved version in ${versions.dir} loads${tried.length?` (${tried.length} tried)`:' (there are none)'}. Fix or replace ${file}, or restore a copy from ${versions.dir}.`),{cause:first,file});
}
