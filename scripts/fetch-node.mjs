#!/usr/bin/env node
// Fetches the Node.js runtime the desktop app bundles as a Tauri sidecar, so the lighting engine
// runs on a computer with nothing installed.
//
//   node scripts/fetch-node.mjs                 # the build host's target (or $TAURI_ENV_TARGET_TRIPLE)
//   node scripts/fetch-node.mjs --all           # every target below
//   node scripts/fetch-node.mjs --target x86_64-pc-windows-msvc --force
//
// Writes src-tauri/binaries/node-<target-triple>[.exe] (Tauri's sidecar naming; the bundler strips
// the triple, so the app finds `node` next to its own executable). Each download is checked against
// the SHA-256 pinned here, copied from nodejs.org's SHASUMS256.txt for that release. Nothing is
// re-downloaded while the pinned version is already there. The binaries are not in git.
//
// `tauri build` and `tauri dev` run this first (build.beforeBuildCommand / beforeDevCommand), since
// tauri-build refuses to compile when an externalBin is missing.

import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const VERSION='24.21.0';
// file: what to download from https://nodejs.org/dist/v<VERSION>/; entry: the binary inside a .tar.gz.
const SOURCES={
 'aarch64-apple-darwin':{file:`node-v${VERSION}-darwin-arm64.tar.gz`,sha256:'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',entry:`node-v${VERSION}-darwin-arm64/bin/node`},
 'x86_64-apple-darwin':{file:`node-v${VERSION}-darwin-x64.tar.gz`,sha256:'1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',entry:`node-v${VERSION}-darwin-x64/bin/node`},
 'x86_64-pc-windows-msvc':{file:'win-x64/node.exe',sha256:'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'}
};

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),outDir=join(root,'src-tauri','binaries');
function hostTriple(){
 const {platform,arch}=process;
 if(platform==='darwin')return arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin';
 if(platform==='win32'&&arch==='x64')return 'x86_64-pc-windows-msvc';
 return `${arch}-${platform}`;
}
const argv=process.argv.slice(2),force=argv.includes('--force'),targets=[];
for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--all')targets.push(...Object.keys(SOURCES));else if(a==='--target')targets.push(argv[++i]??'');else if(a.startsWith('--target='))targets.push(a.slice(9))}
if(!targets.length)targets.push(process.env.TAURI_ENV_TARGET_TRIPLE||hostTriple());

// The one file we need out of a .tar.gz (ustar, with GNU/pax long names).
function untar(buf,want){
 let off=0,longName=null;
 while(off+512<=buf.length){
  const h=buf.subarray(off,off+512);if(h.every(b=>b===0))break;
  const str=(s,l)=>h.subarray(s,s+l).toString('utf8').replace(/\0.*$/s,'');
  const size=parseInt(str(124,12).trim()||'0',8),type=String.fromCharCode(h[156]||48),prefix=str(345,155);
  let name=longName??(prefix?prefix+'/':'')+str(0,100);longName=null;
  const body=buf.subarray(off+512,off+512+size);off+=512+Math.ceil(size/512)*512;
  if(type==='L'){longName=body.toString('utf8').replace(/\0.*$/s,'');continue}
  if(type==='x'){const m=/\d+ path=([^\n]+)\n/.exec(body.toString('utf8'));if(m)longName=m[1];continue}
  if((type==='0'||type==='\0')&&name===want)return body;
 }
 throw Error(`${want} not found in the archive`);
}

for(const target of targets){
 const src=SOURCES[target];if(!src){console.error(`No Node build pinned for ${target}. Pinned: ${Object.keys(SOURCES).join(', ')}`);process.exit(1)}
 const out=join(outDir,`node-${target}${target.includes('windows')?'.exe':''}`),stamp=out+'.version';
 if(!force&&existsSync(out)&&existsSync(stamp)&&readFileSync(stamp,'utf8').trim()===VERSION){console.log(`node ${VERSION} for ${target} is already there.`);continue}
 const url=`https://nodejs.org/dist/v${VERSION}/${src.file}`;console.log(`Downloading ${url}`);
 const res=await fetch(url);if(!res.ok){console.error(`Download failed: HTTP ${res.status}`);process.exit(1)}
 const data=Buffer.from(await res.arrayBuffer()),hash=createHash('sha256').update(data).digest('hex');
 if(hash!==src.sha256){console.error(`SHA-256 mismatch for ${src.file}: got ${hash}, pinned ${src.sha256}`);process.exit(1)}
 const binary=src.entry?untar(gunzipSync(data),src.entry):data;
 mkdirSync(outDir,{recursive:true});rmSync(out,{force:true});writeFileSync(out,binary);chmodSync(out,0o755);writeFileSync(stamp,VERSION+'\n');
 console.log(`Wrote ${out} (${(binary.length/1e6).toFixed(1)} MB)`);
}
