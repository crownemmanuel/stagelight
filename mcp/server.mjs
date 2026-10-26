#!/usr/bin/env node
// MCP stdio transport: newline-delimited JSON-RPC. No diagnostic text on stdout.
import readline from 'node:readline';
import crypto from 'node:crypto';
import {COMMANDS} from '../engine/spec.mjs';
const base=process.env.LIGHTS_URL??'http://127.0.0.1:1460';
const url=new URL(base);if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('MCP is restricted to the local lighting engine');
const names=Object.fromEntries(Object.keys(COMMANDS).filter(k=>!COMMANDS[k].internal).map(k=>['lights_'+k.replaceAll('.','_'),k]));
// Tell the desk an agent is here (and keep telling it), so Connect an agent can show Connected.
const session='mcp-'+crypto.randomUUID().slice(0,12);let client={name:'MCP client',version:''},heartbeat;
const hello=()=>execute('agent.hello',{session,client:String(client.name||'MCP client').slice(0,100),version:String(client.version??'').slice(0,40)}).catch(()=>{});
async function execute(name,args){const session=await fetch(base+'/api/session').then(r=>r.json());const response=await fetch(base+'/api/command',{method:'POST',headers:{'content-type':'application/json','x-lights-token':session.token},body:JSON.stringify({command:name,args})});const result=await response.json();if(!response.ok)throw Error(result.error);return result}
async function handle(req){
 switch(req.method){
  case 'initialize':client=req.params?.clientInfo??client;hello();clearInterval(heartbeat);heartbeat=setInterval(hello,10000);heartbeat.unref();return {protocolVersion:['2025-03-26','2025-06-18','2025-11-25'].includes(req.params?.protocolVersion)?req.params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'stagelight',title:'StageLight',version:'0.2.0'},instructions:'StageLight lighting desk. Use lights_schema and lights_status first. Pages are scenes with ordered cue lists: build cues (lights_cue_save, lights_look_capture, lights_effect_apply presets), arrange them with lights_page_save, run them with lights_page_go / lights_page_back, layer effects on a selection with lights_fx_preview / lights_fx_apply, save new effects to the library with lights_preset_save (custom:true; pick an icon from lights_schema icons), record changes with lights_cue_record, program without touching live with lights_blind_set, check a cue first with lights_preview_cue (visualizer only, safe while live) and send it with lights_preview_go_live, and return to the cue after manual changes with lights_override_release. lights_ledwall_set changes the LED wall preview. Create cues and preview them before physical output. Output arming requires explicit human authorization; verified fixtures use bounded positions. Live mode is never restored automatically. Unverified fixtures are preview placeholders.'};
  case 'ping':return {};
  case 'tools/list':return {tools:Object.entries(names).map(([name,key])=>({name,description:COMMANDS[key].description,inputSchema:COMMANDS[key].schema,annotations:{readOnlyHint:!COMMANDS[key].mutates,destructiveHint:COMMANDS[key].live||key.endsWith('.delete'),idempotentHint:!['cue.play','effect.preview','point.save','fixture.lamp','page.go','page.back','effect.apply','media.import','preview.go_live','blind.apply','fx.apply','cue.record','trigger.fire','target.test'].includes(key),openWorldHint:COMMANDS[key].live}}))};
  case 'tools/call':{const key=names[req.params?.name];if(!key)throw Object.assign(Error('Unknown tool'),{code:-32602});try{return {content:[{type:'text',text:JSON.stringify(await execute(key,req.params.arguments??{}))}]}}catch(e){return {isError:true,content:[{type:'text',text:e.message}]}}}
  default:throw Object.assign(Error('Method not found'),{code:-32601});
 }
}
let chain=Promise.resolve();const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{chain=chain.then(async()=>{let req;try{if(line.length>500000)throw Error('Message too large');req=JSON.parse(line);if(req.id===undefined)return;send({jsonrpc:'2.0',id:req.id,result:await handle(req)})}catch(e){send({jsonrpc:'2.0',id:req?.id??null,error:{code:e.code??-32603,message:e.message}})}})});
