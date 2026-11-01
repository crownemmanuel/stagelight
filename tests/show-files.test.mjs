import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Engine} from '../engine/engine.mjs';import {COMMANDS,SHOW_EDITS} from '../engine/spec.mjs';
// Show files (docs/SHOW-FILES.md): Save / Save As / Open of named shows in a folder on this Mac.
const output=()=>({armed:false,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'stagelight-files-'));
const rig=(root=tmp())=>({root,e:new Engine({dataDir:path.join(root,'data'),showsDir:path.join(root,'shows'),output:output()})});

test('Save As writes a named file, Save goes back to it, and only show edits make it unsaved',async()=>{
 const {root,e}=rig();assert.deepEqual(e.runtime().showFile,{name:null,savedAt:null,dirty:true,autosave:true},'a show never saved to a file is unsaved');
 await assert.rejects(e.command('show.save',{}),/no file yet/);
 const r=await e.command('show.save',{name:'Sunday Service'});assert.equal(r.created.file.file,path.join(root,'shows','Sunday Service.json'));
 assert.deepEqual(JSON.parse(fs.readFileSync(r.created.file.file,'utf8')),e.show,'the file is the whole show');
 assert.equal(e.runtime().showFile.name,'Sunday Service');assert.equal(e.runtime().showFile.dirty,false);
 await e.command('master.set',{value:.4});await e.command('selection.set',{ids:['401']});assert.equal(e.runtime().showFile.dirty,false,'playback and selection are not show edits');
 await e.command('settings.set',{clearFade:7});assert.equal(e.runtime().showFile.dirty,true);
 await e.command('show.save',{});assert.equal(e.runtime().showFile.dirty,false);assert.equal(JSON.parse(fs.readFileSync(r.created.file.file,'utf8')).playback.clearFade,7);
});

test('a different existing name needs overwrite, and bad names are refused',async()=>{
 const {e}=rig();await e.command('show.save',{name:'Rehearsal'});await e.command('show.save',{name:'Sunday'});
 await assert.rejects(e.command('show.save',{name:'rehearsal'}),/already in .*overwrite:true/);
 await e.command('show.save',{name:'rehearsal',overwrite:true});assert.equal(e.runtime().showFile.name,'Rehearsal','keeps the existing file\'s spelling');
 await e.command('show.save',{name:'REHEARSAL'});assert.equal(e.runtime().showFile.name,'Rehearsal','saving to the open show\'s own file needs no overwrite');
 for(const name of ['a/b','..','.hidden','x:y',''])await assert.rejects(e.command('show.save',{name}));
});

test('show.files lists newest first with a summary and searches by name or show title',async()=>{
 const {root,e}=rig();await e.command('show.save',{name:'Christmas Eve'});
 const later=new Date(Date.now()+60e3);await e.command('show.save',{name:'Easter Sunday'});fs.utimesSync(path.join(root,'shows','Easter Sunday.json'),later,later);
 fs.writeFileSync(path.join(root,'shows','notes.json'),'{"hello":1}');const old=new Date(Date.now()-86400e3);fs.utimesSync(path.join(root,'shows','notes.json'),old,old);fs.writeFileSync(path.join(root,'shows','readme.txt'),'x');
 const all=await e.command('show.files');assert.equal(all.folder,path.join(root,'shows'));assert.deepEqual(all.files.map(f=>f.name),['Easter Sunday','Christmas Eve','notes']);
 const easter=all.files[0];assert.equal(easter.valid,true);assert.equal(easter.fixtures,e.show.fixtures.length);assert.equal(easter.cues,e.show.cues.length);assert.equal(easter.title,e.show.name);
 assert.equal(all.files[2].valid,false,'a JSON file that is not a show is listed as not valid');
 assert.deepEqual((await e.command('show.files',{query:'sun'})).files.map(f=>f.name),['Easter Sunday']);
 assert.equal((await e.command('show.files',{query:e.show.name.slice(0,6).toUpperCase()})).files.filter(f=>f.valid).length,2,'matches the show title too');
 assert.deepEqual(all.current,e.runtime().showFile);
});

test('Open replaces the show, keeps this Mac\'s settings, clears playback and protects unsaved changes',async()=>{
 const {e}=rig();await e.command('cue.save',{cue:{id:'only-a',name:'Only in A',duration:5,loop:false,tracks:[],look:[{id:'401',values:{intensity:1}}]}});await e.command('show.save',{name:'A'});
 await e.command('cue.delete',{id:'only-a'});await e.command('show.save',{name:'B'});
 await e.command('cue.save',{cue:{id:'scratch',name:'Scratch',duration:5,loop:false,tracks:[],look:[{id:'401',values:{intensity:1}}]}});await e.command('cue.play',{id:'scratch'});
 e.show.settings.target='10.0.0.99';
 await assert.rejects(e.command('show.open',{name:'A'}),/unsaved changes to "B".*discard:true/);
 const before=e.versions.list().length;
 await e.command('show.open',{name:'a',discard:true});
 assert.ok(e.show.cues.some(c=>c.id==='only-a'));assert.ok(!e.show.cues.some(c=>c.id==='scratch'));assert.equal(e.playback,null,'running cues stop');
 assert.equal(e.show.settings.target,'10.0.0.99','network settings stay with this Mac');
 assert.ok(e.versions.list().length>before,'the replaced show is kept as a version');
 assert.equal(e.runtime().showFile.name,'A');assert.equal(e.runtime().showFile.dirty,false);
 await assert.rejects(e.command('show.open',{name:'Missing'}),/No show named "Missing"/);
 e.output.armed=true;await assert.rejects(e.command('show.open',{name:'B'}),/Disarm/);e.output.armed=false;
 await e.command('performance.lock',{enabled:true});await assert.rejects(e.command('show.open',{name:'B'}),/performance lock/);
 await e.command('show.save',{name:'Locked copy'});assert.equal(e.runtime().showFile.name,'Locked copy','saving a copy works under the lock');
});

test('the current file and its saved state survive an engine restart; import makes the show untitled',async()=>{
 const {root,e}=rig();await e.command('show.save',{name:'Tour'});await e.close?.();
 const again=new Engine({dataDir:path.join(root,'data'),output:output()});assert.equal(again.runtime().showFile.name,'Tour');assert.equal(again.runtime().showFile.dirty,false);
 await again.command('settings.set',{sceneFade:4});const third=new Engine({dataDir:path.join(root,'data'),output:output()});assert.equal(third.runtime().showFile.dirty,true,'edits since the save are still unsaved after a restart');
 await third.command('show.import',{show:structuredClone(third.show)});assert.deepEqual(third.runtime().showFile,{name:null,savedAt:null,dirty:true,autosave:true});
});

test('the shows folder can be changed and is kept on this Mac, not in the show',async()=>{
 const {root,e}=rig(),other=path.join(root,'elsewhere','Shows');
 const r=await e.command('show.folder.set',{path:other});assert.equal(r.created.folder,other);assert.ok(fs.existsSync(other));
 await e.command('show.save',{name:'Moved'});assert.ok(fs.existsSync(path.join(other,'Moved.json')));assert.equal(e.show.settings.showsFolder,undefined);
 assert.equal(new Engine({dataDir:path.join(root,'data'),output:output()}).files.folder,other);
 const shown=[];e.revealHook=(p,file)=>shown.push([p,file]);await e.command('show.reveal',{});await e.command('show.reveal',{name:'moved'});
 assert.deepEqual(shown,[[path.join(other,'Moved.json'),true],[path.join(other,'Moved.json'),true]]);
 await e.command('show.import',{show:structuredClone(e.show)});await e.command('show.reveal',{});assert.deepEqual(shown.at(-1),[other,false],'no current file: the folder opens');
 assert.ok(SHOW_EDITS.has('show.open')&&!SHOW_EDITS.has('show.save'));
});

test('show file commands are MCP tools',async()=>{
 for(const c of ['show.files','show.save','show.open','show.folder.set','show.reveal'])assert.ok(COMMANDS[c]&&!COMMANDS[c].internal);
 const mcp=spawn(process.execPath,[path.resolve('mcp/server.mjs')],{env:{...process.env,LIGHTS_URL:'http://127.0.0.1:9'}});let out='';mcp.stdout.on('data',d=>out+=d);
 mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
 const tools=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('no reply')),5000);mcp.stdout.on('data',()=>{const line=out.split('\n').slice(0,-1).find(l=>l.includes('"id":1'));if(line){clearTimeout(t);res(JSON.parse(line).result.tools)}})});
 mcp.kill();const byName=Object.fromEntries(tools.map(t=>[t.name,t]));
 for(const n of ['lights_show_files','lights_show_save','lights_show_open','lights_show_folder_set','lights_show_reveal'])assert.ok(byName[n],n);
 assert.equal(byName.lights_show_files.annotations.readOnlyHint,true);assert.deepEqual(byName.lights_show_open.inputSchema.required,['name']);
});
