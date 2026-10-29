#!/usr/bin/env node
// Builds the native helper for the sound and MIDI modules (src-tauri/io, binary stagelight-io) and puts it where Tauri
// bundles sidecars: src-tauri/binaries/stagelight-io-<target-triple>[.exe] (the bundler strips the triple, so the
// engine finds it next to the bundled node). `tauri build` and `tauri dev` run this after fetch-node.mjs.
//
//   node scripts/build-io.mjs           # release build for the host (or $TAURI_ENV_TARGET_TRIPLE)
//   node scripts/build-io.mjs --dev     # debug build, quicker while developing
import {execFileSync} from 'node:child_process';import {copyFileSync,chmodSync,mkdirSync} from 'node:fs';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dev=process.argv.includes('--dev');
const host=()=>{const {platform,arch}=process;if(platform==='darwin')return arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin';if(platform==='win32'&&arch==='x64')return 'x86_64-pc-windows-msvc';return `${arch}-${platform}`};
const triple=process.env.TAURI_ENV_TARGET_TRIPLE||host(),exe=triple.includes('windows')?'.exe':'',cross=triple!==host();
// --target-dir explicitly: cargo reads .cargo/config.toml from the working directory, not from the manifest's.
const args=['build','--manifest-path',join(root,'src-tauri','io','Cargo.toml'),'--target-dir',join(root,'src-tauri','target'),...(dev?[]:['--release']),...(cross?['--target',triple]:[])];
execFileSync('cargo',args,{stdio:'inherit'});
const built=join(root,'src-tauri','target',...(cross?[triple]:[]),dev?'debug':'release','stagelight-io'+exe),out=join(root,'src-tauri','binaries',`stagelight-io-${triple}${exe}`);
mkdirSync(dirname(out),{recursive:true});copyFileSync(built,out);if(!exe)chmodSync(out,0o755);console.log(`stagelight-io → ${out}`);
