// Show safety (docs/SHOW-SAFETY.md): show versions and the live-state file used to offer a resume after a crash.
import fs from 'node:fs';import path from 'node:path';

// Timestamped copies of the show in <data>/versions: at most one per five minutes of edits, and always before an import
// or a restore and when the performance lock goes on. Keeps the newest 50 plus the last one of each older day.
const KEEP=50,EVERY=300;
const stamp=d=>d.toISOString().replace(/[:.]/g,'-');
export class Versions{
 constructor(dir,clock){this.dir=dir?path.join(dir,'versions'):null;this.clock=clock;this.last=-Infinity}
 snapshot(show,reason){
  if(!this.dir)return null;fs.mkdirSync(this.dir,{recursive:true});let id=`${stamp(new Date())}-${reason}`;
  for(let n=2;fs.existsSync(path.join(this.dir,id+'.json'));n++)id=`${stamp(new Date())}-${reason}-${n}`;
  fs.writeFileSync(path.join(this.dir,id+'.json'),JSON.stringify(show));this.last=this.clock();this.prune();return id;
 }
 edited(show){if(this.clock()-this.last>=EVERY)this.snapshot(show,'edits')}
 list(){
  if(!this.dir||!fs.existsSync(this.dir))return [];
  return fs.readdirSync(this.dir).filter(f=>f.endsWith('.json')).sort().reverse().map(f=>{const id=f.slice(0,-5),m=/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z-(.+)$/.exec(id);
   return {id,at:m?`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`:null,reason:m?.[6]??'',bytes:fs.statSync(path.join(this.dir,f)).size}});
 }
 read(id){const f=this.dir&&/^[\w.-]{1,120}$/.test(id)&&path.join(this.dir,id+'.json');if(!f||!fs.existsSync(f))throw Error('Unknown show version '+id);return JSON.parse(fs.readFileSync(f,'utf8'))}
 prune(){
  const all=this.list(),keep=new Set(all.slice(0,KEEP).map(v=>v.id)),days=new Set();
  for(const v of all.slice(KEEP)){const day=v.at?.slice(0,10);if(day&&!days.has(day)){days.add(day);keep.add(v.id)}}
  for(const v of all)if(!keep.has(v.id))fs.rmSync(path.join(this.dir,v.id+'.json'),{force:true});
 }
}

// What is live (armed, scene, cue, master, tempo, lock) is mirrored to <data>/live-state.json a second after it
// changes and marked clean on a normal shutdown. An unclean file at startup becomes an offer to resume, never an action.
export class LiveState{
 constructor(dir){this.file=dir?path.join(dir,'live-state.json'):null;this.timer=null}
 read(){try{return this.file&&fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null}catch{return null}}
 schedule(get){if(!this.file||this.timer)return;this.timer=setTimeout(()=>{this.timer=null;this.write(get())},1000);this.timer.unref?.()}
 write(state){if(!this.file)return;try{fs.writeFileSync(this.file+'.tmp',JSON.stringify(state));fs.renameSync(this.file+'.tmp',this.file)}catch{}}
 close(state){clearTimeout(this.timer);this.timer=null;this.write({...state,clean:true})}
}
