// Desk hot-load (docs/PRODUCTION-READINESS.md). The desk is served from public/ straight off the disk, so a desk-only fix
// copied into the app's public/ folder needs no engine restart: this watches the folder, and when its code changes the new
// fingerprint goes out in runtime.desk. Open desks then offer Reload; they never reload by themselves mid-show.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const CODE=/\.(m?js|html|css)$/;
export function deskBuild(dir){const h=crypto.createHash('sha1');for(const f of fs.readdirSync(dir).filter(f=>CODE.test(f)).sort())h.update(f).update(fs.readFileSync(path.join(dir,f)));return h.digest('hex').slice(0,12)}
// onChange({build, changedAt}) after the folder settles for `settle` ms with different code. Returns a stop function.
export function watchDesk(dir,onChange,{settle=500}={}){
 let current=deskBuild(dir),timer=null,watcher=null;
 const check=()=>{timer=null;let next;try{next=deskBuild(dir)}catch{return}if(next!==current){current=next;onChange({build:next,changedAt:new Date().toISOString()})}};
 try{watcher=fs.watch(dir,(ev,name)=>{if(name&&!CODE.test(name))return;clearTimeout(timer);timer=setTimeout(check,settle);timer.unref?.()});watcher.on('error',()=>{});watcher.unref?.()}catch{}
 return {build:()=>current,stop:()=>{clearTimeout(timer);watcher?.close()}};
}
