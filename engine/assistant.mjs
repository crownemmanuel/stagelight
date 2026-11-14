// The built-in assistant (docs/ASSISTANT.md): a chat on the desk that drives the show through the same validated
// command catalogue as the UI, OSC and MCP. The operator brings an Anthropic or OpenAI API key; it is kept on this Mac
// in <data>/assistant.json (owner-only file), never in the show, its versions or its exports.
// No npm dependencies (the engine is copied into the desktop app as it is), so both providers are called with fetch.
// Nothing here runs per tick: a reply is a background loop of model calls and engine commands.
import fs from 'node:fs';
import path from 'node:path';
import {COMMANDS} from './spec.mjs';

export const PROVIDERS={
 anthropic:{name:'Anthropic',models:['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5','claude-fable-5-2'],model:'claude-opus-5-5'},
 openai:{name:'OpenAI',models:['gpt-5','gpt-5-mini'],model:'gpt-5'}
};
// Only the person at the desk does these: arming, resuming a show, replacing the show, the performance lock, network
// and output addresses, and the assistant's own set-up (so it can never widen its own permissions).
// status and schema are left out because they are very large; show.summary and patch.report replace them.
export const HUMAN_ONLY=new Set(['agent.hello','output.arm','resume.apply','resume.dismiss','show.import','show.restore','performance.lock','output.configure','network.configure','status','schema']);
const isAssistantCommand=k=>k.startsWith('assistant.');
export const toolName=k=>'lights_'+k.replaceAll('.','_');
const MAX_ROUNDS=30,RESULT_CHARS=40000,LONG_CONVERSATION=400000;
// Models that accept Anthropic's server-side refusal fallback.
const FALLBACK_MODELS=new Set(['claude-fable-5-2','claude-fable-5-1','claude-opus-5-5','claude-opus-5','claude-sonnet-5-5']);

const SYSTEM=`You are the lighting assistant built into StageLight, a live lighting desk. The operator chats with you on the desk. You act only through the tools, which are the same validated commands the desk buttons and the StageLight MCP server use (tool lights_cue_save is command cue.save, and so on).

How to work
- Start by reading lights_show_summary: groups (with sizes and fixture profiles), cues, pages, scenes, effects, effect presets, palettes, masters and what is running. Use lights_patch_report for per-fixture detail. Use exact IDs from these reads; never invent fixture, group, cue or page IDs.
- Effects are built as cues. lights_cue_save takes a whole cue: id, name, duration, loop, and tracks. Each track runs one effect (from the summary's effects list) on a group or an explicit fixture list, with start, duration, params (color, secondary, brightness, speed, spread, width, frequency, panAmplitude, tiltAmplitude, ...), optional fadeIn/fadeOut and an optional layer (position, intensity or color) so it modifies rather than replaces what is under it. Several tracks build a layered look. Position effects only move moving heads. A cue can also carry a still look (per-fixture values). Use bpm on a cue to make it follow tap tempo.
- Reusable effects go in the effects library with lights_preset_save (custom presets). lights_effect_apply makes a cue from a preset on a group.
- Live programmer effects: lights_fx_preview (visualizer only) and lights_fx_apply on fixtures.
- Scenes are base looks underneath every cue: lights_scene_capture or lights_scene_save, then lights_scene_go.
- Pages are ordered cue lists (lights_page_save). Masters hold a cue on a key (lights_masters_assign).
- Saving replaces the whole item: read it first and carry over every field and entry you are not changing. To add a cue to a page, resend the page with all its existing entries plus the new one.
- Don't delete or overwrite the operator's cues, pages, scenes, groups, patch, placement or calibration unless they ask. If an ID is taken by something else, choose a new ID.
- Show your work safely: lights_preview_cue plays a cue in the visualizer only, even while output is armed. Playing a cue (lights_cue_play, lights_page_go, masters, scenes) changes what the room sees when output is armed. Unless the operator asked you to run it, build it and preview it, then say how to run it.

Safety
- You cannot arm physical output; only the operator can. Some live commands are refused while output is armed unless the operator allowed it in the assistant settings; if one is refused, say so and offer the preview.
- Sending a command is not proof that a fixture responded: Art-Net has no acknowledgment.
- Never strike or douse lamps unless the operator asks.
- The operator's notes below are house rules (for example intensity limits for some fixtures). Follow them in every cue, scene and effect you build.

When a tool returns an error, read it, fix the arguments and try again; if you can't, explain what blocked you.
Reply briefly, in plain language for a lighting operator: what you made (names and IDs), where it is (library, page, master) and how to run it. No raw JSON.`;

// LLM-facing copies of the command schemas. Regex patterns are dropped (some use look-arounds that providers do not
// accept); the engine still validates every argument exactly, and an error comes back to the model as a tool result.
function sanitize(schema){
 if(Array.isArray(schema))return schema.map(sanitize);
 if(!schema||typeof schema!=='object')return schema;
 const out={};for(const [k,v] of Object.entries(schema)){if(k==='pattern'&&typeof v==='string')continue;out[k]=sanitize(v)}
 if(schema.pattern&&schema.type==='string'&&!out.description)out.description=schema.pattern.includes('a-zA-Z0-9_-')?'ID: letters, digits, _ or -':'Text';
 return out;
}
export function assistantTools(){
 return Object.keys(COMMANDS).filter(k=>!COMMANDS[k].internal&&!HUMAN_ONLY.has(k)&&!isAssistantCommand(k)).map(k=>({key:k,name:toolName(k),description:COMMANDS[k].description+(COMMANDS[k].live?' Changes the live rig when output is armed.':''),schema:sanitize(COMMANDS[k].schema)}));
}
const clip=(s,n)=>s.length>n?s.slice(0,n)+'…':s;
const short=v=>{try{return JSON.stringify(v)}catch{return String(v)}};
const providerError=(name,status,body)=>{const m=body?.error?.message??body?.message??'';return `${name} ${status===401?'did not accept the API key':status===429?'is rate limiting or out of credit':'returned an error'} (HTTP ${status})${m?': '+clip(String(m),300):''}`};

export class Assistant{
 constructor({dir,engine,fetch:fetcher=(...a)=>globalThis.fetch(...a)}){
  this.file=dir?path.join(dir,'assistant.json'):null;this.engine=engine;this.fetch=fetcher;
  this.config={provider:'anthropic',keys:{},models:{},allowLive:false};
  try{if(this.file&&fs.existsSync(this.file)){const c=JSON.parse(fs.readFileSync(this.file,'utf8'));this.config={...this.config,...c,keys:{...c.keys},models:{...c.models}}}}catch{engine?.log('Assistant settings could not be read; starting without a saved key.')}
  if(!PROVIDERS[this.config.provider])this.config.provider='anthropic';
  // Engine commands run through this; the server routes it through its command queue.
  this.exec=(name,args)=>engine.command(name,args,{lean:true});
  this.tools=assistantTools();this.byName=new Map(this.tools.map(t=>[t.name,t.key]));
  this.history=[];this.transcript=[];this.busy=false;this.revision=1;this.error=null;this.abort=null;this.tokens=0;this.usage={input:0,output:0,cached:0};this.seq=0;
 }
 get provider(){return this.config.provider}
 get model(){return this.config.models[this.provider]||PROVIDERS[this.provider].model}
 get key(){return this.config.keys[this.provider]}
 changed(){this.revision++}
 save(){if(!this.file)return;const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.config,null,1),{mode:0o600});fs.renameSync(tmp,this.file);try{fs.chmodSync(this.file,0o600)}catch{}}
 live(){return {busy:this.busy,revision:this.revision}}
 status(){
  const configured=Object.fromEntries(Object.keys(PROVIDERS).map(p=>[p,!!this.config.keys[p]]));
  return {provider:this.provider,model:this.model,providers:Object.fromEntries(Object.entries(PROVIDERS).map(([k,v])=>[k,{name:v.name,model:this.config.models[k]||v.model,suggested:v.models,configured:configured[k],keyHint:this.config.keys[k]?'…'+this.config.keys[k].slice(-4):null}])),
   configured:configured[this.provider],allowLive:!!this.config.allowLive,instructions:this.engine?.show?.settings?.assistant?.instructions??'',busy:this.busy,revision:this.revision,error:this.error,tools:this.tools.length,
   usage:{...this.usage,conversationTokens:this.tokens},messages:this.transcript.slice(-60)};
 }
 configure(args){
  if(this.busy&&(args.provider||args.model||args.apiKey||args.clearKey))throw Error('Wait for the assistant to finish, or stop it, before changing its provider, model or key.');
  const provider=args.provider??this.provider;
  if(args.provider&&args.provider!==this.provider){this.config.provider=args.provider;this.reset()}
  if(args.apiKey!==undefined)this.config.keys[provider]=args.apiKey.trim();
  if(args.clearKey)delete this.config.keys[provider];
  if(args.model!==undefined){if(args.model!==this.config.models[provider]&&provider===this.provider)this.reset();this.config.models[provider]=args.model}
  if(args.allowLive!==undefined)this.config.allowLive=args.allowLive;
  this.save();this.changed();
  this.engine?.log(`Assistant · ${PROVIDERS[this.provider].name} ${this.model}${args.apiKey!==undefined?' · key saved':''}${args.clearKey?' · key removed':''}${args.allowLive!==undefined?' · live '+(args.allowLive?'allowed':'not allowed'):''}`);
  return this.status();
 }
 reset(){this.history=[];this.transcript=[];this.tokens=0;this.error=null;this.changed()}
 clear(){if(this.busy)throw Error('Stop the reply in progress first.');this.reset();return {ok:true}}
 stop(){if(!this.busy)return {ok:true,stopped:false};this.abort?.abort();return {ok:true,stopped:true}}
 async models(provider=this.provider){
  const key=this.config.keys[provider];if(!key)throw Error(`Add a ${PROVIDERS[provider].name} API key first.`);
  const anthropic=provider==='anthropic';
  const r=await this.fetch(anthropic?'https://api.anthropic.com/v1/models?limit=100':'https://api.openai.com/v1/models',{headers:anthropic?{'x-api-key':key,'anthropic-version':'2026-10-21'}:{authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});
  const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(providerError(PROVIDERS[provider].name,r.status,v));
  let ids=(v.data??[]).map(m=>m.id).filter(id=>typeof id==='string');
  if(!anthropic)ids=ids.filter(id=>/^(gpt-|o\d|chatgpt-)/.test(id)&&!/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(id));
  return {provider,ok:true,models:ids.sort()};
 }
 send(message){
  if(this.busy)throw Error('The assistant is still replying. Wait, or stop it first.');
  if(!this.key)throw Error(`Add a ${PROVIDERS[this.provider].name} API key in the assistant settings first.`);
  if(this.tokens>LONG_CONVERSATION)throw Error('This conversation is very long. Start a new chat to keep replies fast and cheap.');
  const text=message.trim();if(!text)throw Error('Type a message');
  this.transcript.push({id:'m'+(++this.seq),role:'user',text,at:new Date().toISOString()});
  this.history.push({role:'user',content:text});
  this.busy=true;this.error=null;this.abort=new AbortController();this.changed();
  this.done=this.run(this.abort.signal).catch(e=>{this.error=e.name==='AbortError'?null:e.message;this.note(e.name==='AbortError'?'Stopped.':e.message,e.name==='AbortError'?'note':'error')}).finally(()=>{this.repair();this.busy=false;this.abort=null;this.changed()});
  return {ok:true,started:true};
 }
 note(text,role='note'){this.transcript.push({id:'m'+(++this.seq),role,text,at:new Date().toISOString()});this.changed()}
 // A stop can land between a tool call and its result; every call needs a result before the next request.
 repair(){
  const last=this.history.at(-1),calls=last?.role!=='assistant'?[]:this.provider==='anthropic'?(Array.isArray(last.content)?last.content.filter(b=>b.type==='tool_use'):[]):(last.tool_calls??[]);
  if(calls.length)this.results(calls.map(c=>({id:c.id,ok:false,text:'Not run: the operator stopped the reply.'})));
 }
 async run(signal){
  const reply={id:'m'+(++this.seq),role:'assistant',text:'',tools:[],at:new Date().toISOString()};this.transcript.push(reply);
  for(let round=0;round<MAX_ROUNDS;round++){
   const step=await this.call(signal);
   if(step.text){reply.text=(reply.text?reply.text+'\n\n':'')+step.text;this.changed()}
   if(step.refusal){reply.text=reply.text||'The model declined this request.';return}
   if(!step.calls.length)return;
   if(step.truncated){this.results(step.calls.map(c=>({id:c.id,ok:false,text:'Not run: the reply was cut off.'})));reply.text+='\n\n(The reply was cut off before it finished.)';return}
   const results=[];
   for(const c of step.calls){
    if(signal.aborted)break;
    const row={name:this.byName.get(c.name)??c.name,args:clip(short(c.input??{}),600),ok:null,result:''};reply.tools.push(row);this.changed();
    const r=await this.callTool(c);row.ok=r.ok;row.result=clip(r.text,400);results.push({id:c.id,...r});this.changed();
   }
   if(signal.aborted){const done=new Set(results.map(r=>r.id));this.results([...results,...step.calls.filter(c=>!done.has(c.id)).map(c=>({id:c.id,ok:false,text:'Not run: the operator stopped the reply.'}))]);throw Object.assign(Error('Stopped'),{name:'AbortError'})}
   this.results(results);
  }
  reply.text+=(reply.text?'\n\n':'')+'I stopped after many steps. Tell me to continue if there is more to do.';
 }
 async callTool(c){
  const key=this.byName.get(c.name);if(!key)return {ok:false,text:`Unknown tool ${c.name}.`};
  if(c.input===undefined)return {ok:false,text:'The arguments were not valid JSON.'};
  const def=COMMANDS[key];
  if(def.live&&this.engine?.output?.armed&&!this.config.allowLive)return {ok:false,text:`Refused: physical output is armed and the operator has not let the assistant change the live rig. Build and preview instead (lights_preview_cue is visualizer only), or ask the operator to turn on "Let the assistant run the live rig" in the assistant settings.`};
  try{const r=await this.exec(key,c.input);const text=short(r);return {ok:true,text:text.length>RESULT_CHARS?text.slice(0,RESULT_CHARS)+'… (truncated: use a narrower read)':text}}
  catch(e){return {ok:false,text:'Error: '+e.message}}
 }
 instructions(){const n=this.engine?.show?.settings?.assistant?.instructions?.trim();return n?`Operator notes for this show (house rules, follow them):\n${n}`:''}
 call(signal){return this.provider==='anthropic'?this.anthropic(signal):this.openai(signal)}
 results(list){
  if(!list.length)return;
  if(this.provider==='anthropic')this.history.push({role:'user',content:list.map(r=>({type:'tool_result',tool_use_id:r.id,content:r.text,...(r.ok?{}:{is_error:true})}))});
  else for(const r of list)this.history.push({role:'tool',tool_call_id:r.id,content:r.text});
 }
 async post(url,headers,body,signal,name){
  const r=await this.fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
  const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(providerError(name,r.status,v));return v;
 }
 // Anthropic Messages API, raw HTTP. Tools and the stable system prompt are cached; the reply's content (thinking
 // blocks included) is appended unchanged so the history stays append-only.
 async anthropic(signal){
  const notes=this.instructions(),tools=this.tools.map(t=>({name:t.name,description:t.description,input_schema:t.schema}));
  tools[tools.length-1]={...tools.at(-1),cache_control:{type:'ephemeral'}};
  const body={model:this.model,max_tokens:16000,system:[{type:'text',text:SYSTEM,cache_control:{type:'ephemeral'}},...(notes?[{type:'text',text:notes}]:[])],tools,messages:this.history};
  const headers={'x-api-key':this.key,'anthropic-version':'2026-10-21'};
  if(FALLBACK_MODELS.has(this.model)){headers['anthropic-beta']='server-side-fallback-2026-07-01';body.fallbacks='default'}
  const v=await this.post('https://api.anthropic.com/v1/messages',headers,body,signal,'Anthropic');
  this.history.push({role:'assistant',content:v.content??[]});
  const u=v.usage??{};this.usage.input+=u.input_tokens??0;this.usage.output+=u.output_tokens??0;this.usage.cached+=u.cache_read_input_tokens??0;this.tokens=(u.input_tokens??0)+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0)+(u.output_tokens??0);
  const content=v.content??[];
  return {text:content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim(),calls:content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,name:b.name,input:b.input})),refusal:v.stop_reason==='refusal',truncated:v.stop_reason==='max_tokens'};
 }
 // OpenAI Chat Completions with function tools.
 async openai(signal){
  const notes=this.instructions();
  const body={model:this.model,messages:[{role:'system',content:SYSTEM+(notes?'\n\n'+notes:'')},...this.history],tools:this.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.schema}})),max_completion_tokens:16000};
  const v=await this.post('https://api.openai.com/v1/chat/completions',{authorization:'Bearer '+this.key},body,signal,'OpenAI');
  const choice=v.choices?.[0]??{},m=choice.message??{};
  this.history.push({role:'assistant',content:m.content??null,...(m.tool_calls?.length?{tool_calls:m.tool_calls}:{})});
  const u=v.usage??{};this.usage.input+=u.prompt_tokens??0;this.usage.output+=u.completion_tokens??0;this.usage.cached+=u.prompt_tokens_details?.cached_tokens??0;this.tokens=u.total_tokens??0;
  const calls=(m.tool_calls??[]).filter(c=>c.type==='function').map(c=>{let input;try{input=JSON.parse(c.function.arguments||'{}')}catch{}return {id:c.id,name:c.function.name,input}});
  return {text:(m.content??m.refusal??'').trim(),calls,refusal:!!m.refusal&&!calls.length,truncated:choice.finish_reason==='length'};
 }
 async close(){this.abort?.abort();await this.done?.catch(()=>{})}
}
