// Optional integration smoke test through the official MCP SDK: npm i --no-save @modelcontextprotocol/sdk, then node tests/mcp-smoke.mjs
// Only preview commands are issued. No output.arm call exists in this test.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import path from 'node:path';
const client=new Client({name:'lights-verification',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/server.mjs')]}));
try{
 const list=await client.listTools();assert.ok(list.tools.length>=20);
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text)};
 const status=await call('lights_status');assert.equal(status.runtime.output.armed,false);
 await call('lights_cue_save',{cue:{id:'agent-aurora',name:'Agent · Aurora',description:'Created and played through the MCP adapter.',duration:24,loop:false,tracks:[{group:'backlights',effect:'wave',start:0,duration:24,params:{color:'#43d7db',secondary:'#bc6aff',brightness:.75,speed:.55},fadeIn:2,fadeOut:3},{group:'rogues',effect:'sweep',start:0,duration:24,params:{color:'#88ccff',brightness:.6,speed:.4,panAmplitude:.03,tiltAmplitude:.015,prism:1},fadeIn:2,fadeOut:3}]}});
 await call('lights_cue_play',{id:'agent-aurora',requestId:'mcp-verification'});
 await call('lights_cue_pause',{paused:true});await call('lights_cue_seek',{seconds:8});
 const state=await call('lights_status');assert.equal(state.runtime.playback.id,'agent-aurora');assert.equal(state.runtime.output.packets,0);assert.equal(state.runtime.output.armed,false);
 assert.ok(state.runtime.frames.some(f=>f.intensity>0));
 const bad=await client.callTool({name:'lights_fixture_set',arguments:{ids:['301'],values:{rawDMX:255}}});assert.equal(bad.isError,true);
 console.log(JSON.stringify({tools:list.tools.length,protocol:'MCP SDK handshake passed',saved:'agent-aurora',preview:'paused at 8 seconds',physicalPackets:state.runtime.output.packets},null,2));
}finally{await client.close()}
