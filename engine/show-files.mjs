import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
// Show files (docs/SHOW-FILES.md): named copies of the show in a folder on this Mac, saved and opened like documents.
// The folder and which file the show came from are this Mac's, kept in <data>/show-files.json, never inside a show.
export const SHOW_NAME=/^(?!\.)[^/\\:*?"<>|\u0000-\u001f]{1,80}$/;
const MAX_BYTES=20e6;
export const showHash=show=>crypto.createHash('sha1').update(JSON.stringify(show)).digest('hex');
export const defaultShowsFolder=()=>process.env.LIGHTS_SHOWS_DIR??path.join(os.homedir(),'Documents','StageLight Shows');
export class ShowFiles{
 constructor(dataDir,folder){
  this.file=dataDir?path.join(dataDir,'show-files.json'):null;this.meta=new Map();let saved={};
  try{if(this.file&&fs.existsSync(this.file))saved=JSON.parse(fs.readFileSync(this.file,'utf8'))}catch{}
  this.folder=saved.folder??folder??(dataDir?defaultShowsFolder():null);this.current=saved.current??null;
 }
 persist(){if(!this.file)return;fs.writeFileSync(this.file+'.tmp',JSON.stringify({folder:this.folder,current:this.current},null,2));fs.renameSync(this.file+'.tmp',this.file)}
 dir(){if(!this.folder)throw Error('No shows folder: set one with show.folder.set {path}.');return this.folder}
 name(raw){const n=String(raw??'').trim().replace(/\.json$/i,'');if(!SHOW_NAME.test(n))throw Error('Show names are 1–80 characters, without / \\ : * ? " < > | and not starting with a dot.');return n}
 pathOf(name){return path.join(this.dir(),this.name(name)+'.json')}
 // Case-insensitive like the Mac's disk: "Sunday" and "sunday" are the same file.
 find(name){const n=this.name(name).toLowerCase();return this.list().find(f=>f.name.toLowerCase()===n)??null}
 setFolder(p){const abs=path.resolve(String(p).replace(/^~(?=$|\/)/,os.homedir()));fs.mkdirSync(abs,{recursive:true});if(!fs.statSync(abs).isDirectory())throw Error('Not a folder: '+abs);this.folder=abs;this.meta.clear();this.persist();return abs}
 // Summaries are cached by size and modified time, so listing a folder of large shows does not stall the engine tick.
 list(query){
  const dir=this.dir();if(!fs.existsSync(dir))return [];const q=String(query??'').trim().toLowerCase(),rows=[];
  for(const f of fs.readdirSync(dir)){
   if(!f.toLowerCase().endsWith('.json')||f.startsWith('.'))continue;const p=path.join(dir,f);let st;try{st=fs.statSync(p)}catch{continue}if(!st.isFile())continue;
   const key=`${st.size}:${st.mtimeMs}`;let m=this.meta.get(p);
   if(m?.key!==key){m={key};try{if(st.size>MAX_BYTES)throw Error('too large');const s=JSON.parse(fs.readFileSync(p,'utf8'));if(!Array.isArray(s.fixtures)||!Array.isArray(s.cues))throw Error('not a show');Object.assign(m,{title:typeof s.name==='string'?s.name.slice(0,120):'',fixtures:s.fixtures.length,cues:s.cues.length,pages:Array.isArray(s.pages)?s.pages.length:0,valid:true})}catch{m.valid=false}this.meta.set(p,m)}
   const name=f.slice(0,-5),{key:_,...summary}=m;
   if(!q||name.toLowerCase().includes(q)||m.title?.toLowerCase().includes(q))rows.push({name,file:p,modified:st.mtime.toISOString(),bytes:st.size,...summary});
  }
  return rows.sort((a,b)=>b.modified.localeCompare(a.modified));
 }
 write(name,show){const n=this.name(name),dir=this.dir();fs.mkdirSync(dir,{recursive:true});const p=path.join(dir,n+'.json');fs.writeFileSync(p+'.tmp',JSON.stringify(show,null,2));fs.renameSync(p+'.tmp',p);return {name:n,file:p}}
 read(name){const f=this.find(name);if(!f)throw Error(`No show named "${this.name(name)}" in ${this.dir()}`);if(f.bytes>MAX_BYTES)throw Error('Show file is larger than 20 MB');try{return {...f,show:JSON.parse(fs.readFileSync(f.file,'utf8'))}}catch{throw Error(`"${f.name}" is not a readable show file`)}}
 // Remembers which file the show is, and the show's hash at that moment, so an engine restart still knows if it was edited since.
 track(name,show,at=new Date().toISOString()){this.current=name?{name,hash:showHash(show),at}:null;this.persist()}
}
