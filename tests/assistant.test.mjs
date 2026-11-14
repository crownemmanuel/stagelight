import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Engine} from '../engine/engine.mjs';import {COMMANDS} from '../engine/spec.mjs';import {assistantTools,toolName,HUMAN_ONLY} from '../engine/assistant.mjs';
// The built-in assistant (docs/ASSISTANT.md). Providers are faked: no request leaves this machine in these tests.
const output=(armed=false)=>({armed,send(){},status(){return {armed:this.armed,packets:0,interfaces:[]}},async arm(){this.armed=true},close(){this.armed=false}});
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'stagelight-assistant-'));
const cue={id:'ai-tide',name:'AI · Tide',duration:16,loop:true,tracks:[{group:'backlights',effect:'wave',start:0,duration:16,params:{color:'#3050ff',secondary:'#c040ff',brightness:.8,speed:.5}}]};
const reply=body=>({ok:true,status:200,json:async()=>body});
// A fake provider: answers each request with the next scripted body and records what was sent.
function fake(script){const sent=[];const f=async(url,opts={})=>{sent.push({url,headers:opts.headers??{},body:opts.body?JSON.parse(opts.body):null});const next=script.shift();if(typeof next==='function')return next(opts);return reply(next)};f.sent=sent;return f}
const rig=({armed=false,dir=null,script=[]}={})=>{const e=new Engine({output:output(armed),dataDir:dir});e.assistant.fetch=fake(script);return e};

test('the assistant gets the MCP command catalogue except what only the operator may do',()=>{
 const tools=assistantTools(),names=new Set(tools.map(t=>t.key));
 for(const k of ['cue.save','preview.cue','fx.preview','preset.save','scene.capture','page.save','masters.assign','show.summary','patch.report'])assert.ok(names.has(k),k);
 for(const k of ['output.arm','resume.apply','show.import','show.restore','performance.lock','network.configure','output.configure','agent.hello','assistant.configure','assistant.send'])assert.ok(!names.has(k),k);
 assert.ok(tools.length<=128,'OpenAI accepts at most 128 tools');
 assert.equal(tools.find(t=>t.key==='cue.save').name,'lights_cue_save');assert.equal(toolName('preview.go_live'),'lights_preview_go_live');
 assert.ok(!JSON.stringify(tools.map(t=>t.schema)).includes('"pattern"'),'look-around patterns are not sent to providers');
});

test('assistant commands and show.summary are MCP tools with schemas',()=>{
 for(const k of ['show.summary','assistant.status','assistant.configure','assistant.models','assistant.send','assistant.stop','assistant.clear']){assert.ok(COMMANDS[k],k);assert.ok(!COMMANDS[k].internal,k);assert.equal(COMMANDS[k].schema.type,'object')}
 assert.ok(HUMAN_ONLY.has('output.arm'));
});

test('show.summary is a compact read of groups, cues, pages, effects and live state',async()=>{
 const e=rig();await e.command('cue.save',{cue});const s=await e.command('show.summary');
 assert.ok(s.groups.some(g=>g.id==='backlights'&&g.count>0&&g.profiles.length));
 assert.ok(s.cues.some(c=>c.id==='ai-tide'&&c.effects.includes('wave')&&c.groups.includes('backlights')));
 assert.ok(s.effects.wave&&s.presets.length>5);assert.equal(s.live.armed,false);
 assert.ok(JSON.stringify(s).length<JSON.stringify(e.snapshot()).length/3);
});

test('the API key stays on this Mac: owner-only file, never in status, the show or the log',async()=>{
 const dir=tmp(),e=rig({dir});
 const st=await e.command('assistant.configure',{provider:'anthropic',apiKey:'  sk-ant-test-secret-1234  ',instructions:'Face lights never above 12%.'});
 assert.equal(st.configured,true);assert.equal(st.providers.anthropic.keyHint,'…1234');assert.ok(!JSON.stringify(st).includes('secret'));
 const file=path.join(dir,'assistant.json');assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).keys.anthropic,'sk-ant-test-secret-1234');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(e.show.settings.assistant.instructions,'Face lights never above 12%.');
 assert.ok(!fs.readFileSync(path.join(dir,'show.json'),'utf8').includes('secret'));
 assert.ok(!e.logs.some(l=>l.message.includes('secret')));
 await e.close();const again=new Engine({output:output(),dataDir:dir});assert.equal(again.assistant.status().configured,true);
 await again.command('assistant.configure',{clearKey:true});assert.equal(again.assistant.status().configured,false);await again.close();
});

test('sending without a key is refused with a clear message',async()=>{
 const e=rig();await assert.rejects(e.command('assistant.send',{message:'hello'}),/API key/);
});

test('Anthropic: the assistant builds a cue through cue.save and reports back',async()=>{
 const e=rig({script:[
  {content:[{type:'thinking',thinking:'',signature:'x'},{type:'tool_use',id:'tu1',name:'lights_cue_save',input:{cue}}],stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:20}},
  {content:[{type:'text',text:'Saved **AI · Tide** (ai-tide) in the library.'}],stop_reason:'end_turn',usage:{input_tokens:50,cache_read_input_tokens:900,output_tokens:10}}]});
 await e.command('assistant.configure',{apiKey:'sk-ant-test-0000',instructions:'Keep it blue.'});
 assert.deepEqual(await e.command('assistant.send',{message:'Make a slow blue tide on the backlights'}),{ok:true,started:true});
 assert.equal(e.runtime().assistant.busy,true);await e.assistant.done;
 assert.ok(e.show.cues.some(c=>c.id==='ai-tide'),'the cue was saved through the engine');
 const st=await e.command('assistant.status'),last=st.messages.at(-1);
 assert.equal(st.busy,false);assert.equal(last.role,'assistant');assert.match(last.text,/AI · Tide/);
 assert.deepEqual(last.tools.map(t=>[t.name,t.ok]),[['cue.save',true]]);
 const [first,second]=e.assistant.fetch.sent;
 assert.equal(first.url,'https://api.anthropic.com/v1/messages');assert.equal(first.headers['x-api-key'],'sk-ant-test-0000');assert.equal(first.headers['anthropic-version'],'2026-10-21');
 assert.equal(first.body.model,'claude-opus-5-5');assert.deepEqual(first.body.tools.at(-1).cache_control,{type:'ephemeral'});assert.match(first.body.system[1].text,/Keep it blue/);
 assert.ok(!('temperature' in first.body));
 // The reply (thinking included) goes back unchanged, then the tool result.
 assert.deepEqual(second.body.messages[1].content[0],{type:'thinking',thinking:'',signature:'x'});
 assert.equal(second.body.messages[2].content[0].type,'tool_result');assert.equal(second.body.messages[2].content[0].tool_use_id,'tu1');
 assert.equal(st.usage.cached,900);
});

test('OpenAI: function calls run the same commands and errors go back to the model',async()=>{
 const e=rig({script:[
  {choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'lights_cue_play',arguments:JSON.stringify({id:'missing-cue'})}},{id:'c2',type:'function',function:{name:'lights_show_summary',arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}},
  {choices:[{message:{role:'assistant',content:'There is no cue called missing-cue.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}}]});
 await e.command('assistant.configure',{provider:'openai',apiKey:'sk-openai-test-9999',model:'gpt-5'});
 await e.command('assistant.send',{message:'Play missing-cue'});await e.assistant.done;
 const [first,second]=e.assistant.fetch.sent;
 assert.equal(first.url,'https://api.openai.com/v1/chat/completions');assert.equal(first.headers.authorization,'Bearer sk-openai-test-9999');
 assert.equal(first.body.messages[0].role,'system');assert.equal(first.body.tools[0].type,'function');
 const tools=second.body.messages.filter(m=>m.role==='tool');assert.equal(tools.length,2);
 assert.match(tools[0].content,/Unknown cue/);assert.match(tools[1].content,/"groups"/);
 const last=e.assistant.status().messages.at(-1);assert.deepEqual(last.tools.map(t=>t.ok),[false,true]);
});

test('while output is armed, live commands are refused unless the operator allows it; arming is never offered',async()=>{
 const play={content:[{type:'tool_use',id:'p1',name:'lights_cue_play',input:{id:'ai-tide'}},{type:'tool_use',id:'p2',name:'lights_output_arm',input:{confirmation:'ENABLE_PHYSICAL_OUTPUT'}},{type:'tool_use',id:'p3',name:'lights_preview_cue',input:{id:'ai-tide'}}],stop_reason:'tool_use'};
 const done={content:[{type:'text',text:'ok'}],stop_reason:'end_turn'};
 const e=rig({armed:true,script:[play,done,structuredClone(play),done]});
 await e.command('cue.save',{cue});await e.command('assistant.configure',{apiKey:'sk-ant-test-0000'});
 await e.command('assistant.send',{message:'run it'});await e.assistant.done;
 let rows=e.assistant.status().messages.at(-1).tools;
 assert.equal(rows[0].ok,false);assert.match(rows[0].result,/armed/);assert.equal(e.playback,null);
 assert.equal(rows[1].ok,false);assert.match(rows[1].result,/Unknown tool/);
 assert.equal(rows[2].ok,true,'preview is visualizer only and stays allowed');
 await e.command('assistant.configure',{allowLive:true});await e.command('assistant.send',{message:'run it now'});await e.assistant.done;
 rows=e.assistant.status().messages.at(-1).tools;assert.equal(rows[0].ok,true);assert.equal(e.playback?.cue.id,'ai-tide');
});

test('stop ends a reply in progress and keeps the conversation valid for the next message',async()=>{
 const hang=opts=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));
 const e=rig({script:[hang,{content:[{type:'text',text:'Hi again'}],stop_reason:'end_turn'}]});
 await e.command('assistant.configure',{apiKey:'sk-ant-test-0000'});
 await e.command('assistant.send',{message:'hello'});await assert.rejects(e.command('assistant.send',{message:'again'}),/still replying/);
 assert.deepEqual(await e.command('assistant.stop'),{ok:true,stopped:true});await e.assistant.done;
 assert.equal(e.assistant.busy,false);assert.equal(e.assistant.status().messages.at(-1).text,'Stopped.');
 await e.command('assistant.send',{message:'hello again'});await e.assistant.done;assert.equal(e.assistant.status().messages.at(-1).text,'Hi again');
 await e.command('assistant.clear');assert.equal(e.assistant.status().messages.length,0);
});

test('a provider error is shown in the chat, not thrown at the desk',async()=>{
 const e=rig({script:[()=>({ok:false,status:401,json:async()=>({error:{message:'invalid x-api-key'}})})]});
 await e.command('assistant.configure',{apiKey:'sk-ant-wrong-0000'});await e.command('assistant.send',{message:'hi'});await e.assistant.done;
 const st=e.assistant.status();assert.match(st.error,/did not accept the API key/);assert.equal(st.messages.at(-1).role,'error');
});

test('assistant.models checks the key and lists chat models',async()=>{
 const e=rig({script:[{data:[{id:'gpt-5'},{id:'text-embedding-3-small'},{id:'gpt-5-mini'},{id:'gpt-4o-realtime-preview'}]}]});
 await e.command('assistant.configure',{provider:'openai',apiKey:'sk-openai-test-9999'});
 assert.deepEqual((await e.command('assistant.models')).models,['gpt-5','gpt-5-mini']);
});

test('the reasoning level is saved per provider and sent the way each API expects',async()=>{
 const done={content:[{type:'text',text:'ok'}],stop_reason:'end_turn'},oa={choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}]};
 const dir=tmp(),e=rig({dir,script:[done,done,oa]});
 await e.command('assistant.configure',{apiKey:'sk-ant-test-0000'});
 await e.command('assistant.send',{message:'a'});await e.assistant.done;assert.ok(!('output_config' in e.assistant.fetch.sent[0].body),'default lets the model decide');
 assert.equal((await e.command('assistant.configure',{effort:'xhigh'})).effort,'xhigh');
 await e.command('assistant.send',{message:'b'});await e.assistant.done;assert.deepEqual(e.assistant.fetch.sent[1].body.output_config,{effort:'xhigh'});
 await assert.rejects(e.command('assistant.configure',{provider:'openai',effort:'xhigh'}),/minimal, low, medium, high/);
 await e.command('assistant.configure',{provider:'openai',apiKey:'sk-openai-test-9999',effort:'minimal'});
 await e.command('assistant.send',{message:'c'});await e.assistant.done;assert.equal(e.assistant.fetch.sent[2].body.reasoning_effort,'minimal');
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'assistant.json'),'utf8'));assert.deepEqual(saved.efforts,{anthropic:'xhigh',openai:'minimal'});
});

test('the model list from the provider is kept for the dropdown',async()=>{
 const e=rig({script:[{data:[{id:'claude-opus-5-5'},{id:'claude-sonnet-5-5'}]}]});
 await e.command('assistant.configure',{apiKey:'sk-ant-test-0000'});assert.equal(e.assistant.status().providers.anthropic.models,null);
 await e.command('assistant.models');assert.deepEqual(e.assistant.status().providers.anthropic.models,['claude-opus-5-5','claude-sonnet-5-5']);
});

test('the performance lock keeps the assistant notes but still lets the operator add a key',async()=>{
 const e=rig();e.locked=true;
 await assert.rejects(e.command('assistant.configure',{instructions:'x'}),/performance lock/);
 assert.equal((await e.command('assistant.configure',{apiKey:'sk-ant-test-0000'})).configured,true);
});
