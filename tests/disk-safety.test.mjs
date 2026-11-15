import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {Versions,LiveState,writeAtomic,openShow} from '../engine/safety.mjs';import {ShowFiles} from '../engine/show-files.mjs';
// Writes that survive a full disk or a read-only folder, version pruning that never loses the newest copies, and
// corrupt bookkeeping files that never stop the engine starting (docs/SHOW-SAFETY.md).
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lights-disk-'));
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const isRoot=process.getuid?.()===0;
const readOnly=(dir,fn)=>{fs.chmodSync(dir,0o555);try{return fn()}finally{fs.chmodSync(dir,0o755)}};

test('writeAtomic replaces a file whole, and a refused write leaves the old file and no temp file behind',{skip:isRoot&&'root ignores folder permissions'},()=>{
 const dir=tmp();try{
  const f=path.join(dir,'show.json');writeAtomic(f,'{"v":1}');writeAtomic(f,'{"v":2}');assert.equal(fs.readFileSync(f,'utf8'),'{"v":2}');
  readOnly(dir,()=>assert.throws(()=>writeAtomic(f,'{"v":3}'),e=>/Could not save .*show\.json: permission was refused \(EACCES\)/.test(e.message)));
  assert.equal(fs.readFileSync(f,'utf8'),'{"v":2}');assert.deepEqual(fs.readdirSync(dir),['show.json'],'no temp file left');
  assert.throws(()=>writeAtomic(path.join(dir,'missing','x.json'),'{}'),/the folder does not exist \(ENOENT\)/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('show files and the show-files record are written atomically and say why when the folder is read-only',{skip:isRoot&&'root ignores folder permissions'},async()=>{
 const dir=tmp(),shows=path.join(dir,'shows');try{
  const e=new Engine({dataDir:dir,showsDir:shows,output:output()});await e.command('show.save',{name:'Sunday'});const file=path.join(shows,'Sunday.json'),before=fs.readFileSync(file,'utf8');
  await readOnly(shows,()=>assert.rejects(e.command('show.save',{name:'Sunday',overwrite:true}),/Could not save .*Sunday\.json: permission was refused/));
  assert.equal(fs.readFileSync(file,'utf8'),before,'the saved show is untouched');assert.deepEqual(fs.readdirSync(shows),['Sunday.json']);
  // The record of which file is open is bookkeeping: a read-only data folder does not fail an import.
  const f=new ShowFiles(dir,shows);readOnly(dir,()=>f.track('Sunday',{a:1}));assert.match(f.error,/Could not save .*show-files\.json/);
  await e.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('versions: a failed five-minute copy never fails the edit; explicit copies refuse; prune never drops the newest',{skip:isRoot&&'root ignores folder permissions'},()=>{
 const dir=tmp();try{
  let now=1000;const v=new Versions(dir,()=>now),vdir=path.join(dir,'versions');v.snapshot({n:0},'edits');
  readOnly(vdir,()=>{now+=400;assert.doesNotThrow(()=>v.edited({n:1}));assert.match(v.error,/permission was refused/);assert.throws(()=>v.snapshot({n:1},'before-import'),/Could not save/)});
  now+=40;v.edited({n:2});assert.equal(v.error,null,'retried on the next edit after the failure');
  // 70 copies stamped in 2030, as if the Mac's clock had been ahead: by name they all sort newer than the copy written
  // now, yet the copy just written and the 50 newest by modified time are kept.
  for(let i=0;i<70;i++)fs.writeFileSync(path.join(vdir,`2030-01-01T00-00-${String(i).padStart(2,'0')}-000Z-edits.json`),'{}');
  fs.writeFileSync(path.join(vdir,'notes.json'),'{}');fs.writeFileSync(path.join(vdir,'2030-01-01.json.tmp'),'');
  const id=v.snapshot({n:3},'before-restore');const ids=v.list().map(x=>x.id);
  assert.ok(ids.includes(id),'the copy just written survives even though 70 copies sort after it');assert.ok(fs.existsSync(path.join(vdir,'notes.json')),'files that are not versions are never removed');
  assert.ok(ids.length<=101);const newestByTime=fs.readdirSync(vdir).filter(f=>/^\d{4}-/.test(f)&&f.endsWith('.json')).map(f=>[f,fs.statSync(path.join(vdir,f)).mtimeMs]).sort((a,b)=>b[1]-a[1]).slice(0,50).map(x=>x[0].slice(0,-5));
  for(const n of newestByTime)assert.ok(ids.includes(n),'the 50 newest by time are kept');
  assert.ok(v.list().every(x=>!x.id.endsWith('.tmp')));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('corrupt live-state.json and show-files.json never stop the engine starting',async()=>{
 for(const bad of ['','null','[]','"text"','{"folder":5,"current":"x"}','{"current":{"name":"../../etc"}}','{broken']){
  const dir=tmp();try{
   fs.writeFileSync(path.join(dir,'live-state.json'),bad);fs.writeFileSync(path.join(dir,'show-files.json'),bad);
   const e=new Engine({dataDir:dir,showsDir:path.join(dir,'shows'),output:output()});assert.equal(e.resume,null,`no resume from ${JSON.stringify(bad)}`);assert.equal(typeof e.files.folder,'string');assert.equal(e.files.current,null);
   assert.ok((await e.command('show.files')).ok!==false);await e.close();
   assert.equal(new LiveState(dir).read()?.clean,true,'a clean file is written on close');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 }
});

test('openShow leaves a readable show alone when something else fails, and restores a version when the show is bad',()=>{
 const dir=tmp();try{
  fs.writeFileSync(path.join(dir,'show.json'),'{"ok":true}');const check=raw=>{if(!raw.ok)throw Error('not a show')};
  assert.throws(()=>openShow({dataDir:dir,check,make:()=>{throw Error('port in use')}}),/port in use/);assert.equal(fs.readFileSync(path.join(dir,'show.json'),'utf8'),'{"ok":true}');
  fs.writeFileSync(path.join(dir,'show.json'),'{"ok":false}');const v=new Versions(dir);v.snapshot({ok:true,n:1},'edits');
  let calls=0;const lines=[];const r=openShow({dataDir:dir,check,log:m=>lines.push(m),make:()=>{if(calls++===0)throw Error('invalid');return 'engine'}});
  assert.equal(r.engine,'engine');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'show.json'),'utf8')).n,1);assert.match(lines[0],/Kept a copy as show\.unreadable-/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
