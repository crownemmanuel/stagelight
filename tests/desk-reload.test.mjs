import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
// The desk compares /api/session build on reconnect and reloads when the engine came back on different code.
const start=async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stagelight-build-')),port=20000+Math.floor(Math.random()*400);
 const child=spawn(process.execPath,[path.resolve('server.mjs')],{env:{...process.env,LIGHTS_PORT:String(port),LIGHTS_OSC_PORT:String(port+500),LIGHTS_DATA_DIR:dir},stdio:['ignore','pipe','inherit']});
 await new Promise(r=>child.stdout.on('data',d=>{if(String(d).includes('LIGHTS_READY'))r()}));
 try{return await fetch(`http://127.0.0.1:${port}/api/session`).then(r=>r.json())}finally{const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true})}};
test('The session carries a code fingerprint that stays the same across restarts on the same code',async()=>{
 const [a,b]=await Promise.all([start(),start()]);
 assert.match(a.build,/^[0-9a-f]{12}$/);assert.equal(a.build,b.build,'a crash restart on the same code does not reload the desk');assert.notEqual(a.token,b.token);
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(app,/s\.build!==build\)return location\.reload\(\)/);
});
