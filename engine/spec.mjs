import {EFFECTS,PROFILE_DEFS,EFFECT_PRESETS,BUILTIN_MEDIA} from './model.mjs';
import {ICONS} from '../public/icons.js';
import {ZONE_ROLES} from './look.mjs';
const number=(min,max)=>({type:'number',minimum:min,maximum:max});
const integer=(min,max)=>({...number(min,max),type:'integer'});
const string={type:'string',minLength:1,maxLength:100};
const id={type:'string',pattern:'^(?!(?:__proto__|constructor|prototype)$)[a-zA-Z0-9_-]{1,64}$'};
const bool={type:'boolean'};
const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items,min=0,max=100)=>({type:'array',items,minItems:min,maxItems:max});
const vec=(min,max)=>({...array(number(min,max),2,2)});
const wheelAttrs={colorWheel:integer(0,127),colorWheel2:integer(0,255)};
export const PARAMS=object({frequency:number(.25,6),duty:number(.1,1),travelSpeed:number(.05,2),strobePattern:{enum:['scatter','wave']},spatialAxis:{enum:['order','x','z']},color:hex,secondary:hex,brightness:number(0,1),speed:number(.05,4),spread:number(0,4),width:number(.05,1),panAmplitude:number(0,.2),tiltAmplitude:number(0,.2),opticalMode:{enum:['spot','beam']},zoom:number(0,1),white:number(0,1),gobo:integer(0,17),goboShake:number(0,1),prism:integer(0,3),prismRotation:number(-1,1),frost:number(0,1),focus:number(0,1),movementSpeed:number(0,1),pointA:id,pointB:id,direction:{enum:['in','out']}},[]);
const attrs=object({intensity:number(0,1),color:hex,...wheelAttrs,white:number(0,1),pan:number(0,1),tilt:number(0,1),opticalMode:{enum:['spot','beam']},zoom:number(0,1),gobo:integer(0,17),goboShake:number(0,1),prism:integer(0,3),prismRotation:number(-1,1),frost:number(0,1),focus:number(0,1),movementSpeed:number(0,1)},[]);
Object.assign(PARAMS.properties,wheelAttrs);
// A track runs on a group or on an explicit fixture list; layer makes it modify (not replace) what is below it.
export const LAYER={enum:['position','intensity','color']};
const track=object({group:id,fixtures:array(id,1,512),layer:LAYER,effect:{enum:Object.keys(EFFECTS)},start:number(0,3600),duration:number(.1,3600),params:PARAMS,fadeIn:number(0,60),fadeOut:number(0,60)},['effect','start','duration','params']);
export const CUE=object({look:array(object({id,values:attrs,over:bool},['id','values']),0,256),id,name:string,description:{type:'string',maxLength:500},duration:number(.1,3600),loop:bool,hold:bool,tracks:array(track,0,64)},['id','name','duration','loop','tracks']);
// A page is a scene. Its cue list references library cues; the same cue may appear on several pages.
// fade: seconds this entry takes to crossfade in (0 = hard cut). follow: 'auto' fires the NEXT entry
// once this one has run `wait` seconds (default: the cue duration).
// What a cue-list entry sends to network targets when it GOes (look summary, cue announcement or a custom OSC message).
const oscAddress={type:'string',pattern:'^/[!-~]{1,120}$'};
// preset: recall one of the target app's own presets (its id as published or typed), sent before a look on the same cue; fade optional.
export const SEND=object({target:id,message:{enum:['look','cue','osc','preset']},address:oscAddress,args:array({},0,16),preset:{type:'string',pattern:'^[^\\u0000-\\u001f]{1,100}$'},fade:number(0,600)},['target','message']);
export const ENTRY=object({id,cue:id,label:string,fade:number(0,60),follow:{enum:['manual','auto']},wait:number(0,3600),send:array(SEND,0,16)},['id','cue','fade','follow']);
// Sister-app links. Targets receive OSC (UDP, lowest latency) or HTTP JSON; triggers map a name to one show-control command.
// Look Link (docs/LOOK-LINK.md). A zone is a named set of fixtures with one role; targets choose zones (none = every zone),
// a sending mode (cue: a look on every GO; change: also when the live look changes; off: only explicit cue sends),
// per-fixture detail (members) and an optional heartbeat in seconds (0 = off).
export const ZONE=object({id,name:string,role:{enum:ZONE_ROLES},groups:array(id,0,64),fixtures:array(id,0,512)},['id','name','role']);
export const TARGET_LOOK=object({zones:array(id,0,32),mode:{enum:['cue','change','off']},members:bool,heartbeat:number(0,3600)},[]);
export const TARGET=object({id,name:string,kind:{enum:['osc','http']},host:{type:'string',pattern:'^[a-zA-Z0-9.-]{1,253}$'},port:integer(1,65535),url:{type:'string',pattern:'^https?://[^\\s]{1,500}$'},announce:bool,enabled:bool,look:TARGET_LOOK},['id','name','kind']);
export const TRIGGER_COMMANDS=['page.go','page.back','cue.play','cue.stop','override.release','blackout.set','master.set','ledwall.set','fx.apply','fx.stop'];
export const TRIGGER=object({id,name:string,description:{type:'string',maxLength:300},command:{enum:TRIGGER_COMMANDS},args:{}},['id','name','command']);
export const OSC_LISTEN=object({bind:{enum:['loopback','lan']},port:integer(1024,65535),allow:array({type:'string',pattern:'^(\\*|\\d{1,3}(\\.\\d{1,3}){3})$'},0,64)},['bind']);
export const PAGE=object({id,name:string,color:hex,cues:array(ENTRY,0,200)},['id','name','cues']);
const fit={enum:['cover','contain','stretch']};
export const MEDIA=object({id,name:string,kind:{enum:['image','video']},src:{type:'string',pattern:'^/media/[a-zA-Z0-9_.-]{1,120}$'}});
// Custom effect presets saved in the show (built-ins live in model.mjs). Layer comes from the effect.
export const PRESET=object({id,name:string,icon:{enum:ICONS},effect:{enum:Object.keys(EFFECTS).filter(k=>EFFECTS[k].layer)},params:PARAMS,description:{type:'string',maxLength:300},duration:number(.5,3600),loop:bool},['id','name','icon','effect','params']);
// Operator preferences that travel with the show. 0 = instant.
export const PLAYBACK=object({clearFade:number(0,30),blindFade:number(0,30)});
export const LEDWALL=object({media:id,brightness:number(0,1),fit});
// Groups/fixtures left out of the 3D visualizer entirely (preview only; output unaffected).
export const VISUALIZER=object({hiddenGroups:array(id,0,64),hiddenFixtures:array(id,0,512)});
const alignment=object({actual:vec(0,1),virtual:vec(-720,720),panSign:{enum:[-1,1]},tiltSign:{enum:[-1,1]},name:string,savedAt:string});
export const CALIBRATION=object({home:vec(0,1),panRange:vec(0,1),tiltRange:vec(0,1),invertPan:bool,invertTilt:bool,reviewed:bool,alignment},['home','panRange','tiltRange','invertPan','invertTilt','reviewed']);
export const FIXTURE=object({id,name:string,profile:{enum:Object.keys(PROFILE_DEFS)},universe:integer(0,512),address:integer(0,512),enabled:bool,verified:bool,position:array(number(-50,50),3,3),calibration:CALIBRATION});
// Fixed (non-moving) heads point at aim, a stage XYZ point, in the visualizer. Without it they use their profile default.
FIXTURE.properties.aim=array(number(-50,50),3,3);
FIXTURE.properties.colorSlots=array(object({name:string,color:hex,value:integer(0,127),secondary:integer(0,255)},['name','color','value']),0,32);
const cmd=(description,schema,mutates=false,live=false,internal=false)=>({description,schema,mutates,live,...(internal?{internal}:{})});
export const COMMANDS={
 'agent.hello':cmd('Sent automatically by the StageLight MCP server when an agent connects and every 10 s, so the desk can show connected agents. No lighting effect. Not listed as an agent tool.',object({session:id,client:string,version:{type:'string',maxLength:40}},['session','client']),true,false,true),
 'selection.set':cmd('Select fixture IDs in the operator UI. Transient selection only; no fixture output values change.',object({ids:array(id,0,512),group:id},['ids']),true),
 'selection.group':cmd('Select every fixture in a named group, or all enabled fixtures using group all. Updates operator UI and runtime selection; no lighting values change.',object({group:id}),true),
 status:cmd('Read runtime, show, output health and current fixture attributes.',object({})),
 'patch.report':cmd('Read-only patch sheet, like a Hog fixture window: every fixture (ID = Hog user number) with profile, channel footprint, Hog universe:address range, Art-Net route, status (output, ready, unrouted, unverified, disabled), groups, and the DMX bytes the engine is building for it this frame. Also per-universe usage, the network path and routing issues. No output.',object({})),
 schema:cmd('Read profiles, effects and every command schema. No output.',object({})),
 'look.capture':cmd('Save current fixture attributes as a reusable still cue. Preserves individual fixture colors and poses; master intensity is applied at playback. Optional page appends the cue to that page cue list with the given fade.',object({id,name:string,page:id,fade:number(0,60)},['id','name']),true),
 'cue.save':cmd('Create or replace a cue in the local library. Playing cues are snapshots; edits do not change active playback.',object({cue:CUE}),true),
 'cue.delete':cmd('Delete a saved cue. Does not alter an already playing snapshot.',object({id}),true),
 'cue.play':cmd('Play a saved cue by ID outside any page. Clears manual overrides. Optional fade crossfades from the current look (default 0 = cut). Preview by default; reaches fixtures only if output was explicitly armed.',object({id,requestId:id,fade:number(0,60)},['id']),true,true),
 'page.save':cmd('Create or replace a page (scene) and its ordered cue list. Entries reference library cue IDs with fade seconds (0 = cut) and follow manual|auto (+ optional wait seconds).',object({page:PAGE}),true),
 'page.delete':cmd('Delete a page and its cue list. Library cues are kept.',object({id}),true),
 'page.go':cmd('GO on a page cue list: runs the next entry (or the given entry) with that entry\'s fade unless fade is given. Manual overrides stay on top until override.release. Read progress in status runtime.stack and runtime.transition.',object({id,entry:id,fade:number(0,60),requestId:id},['id']),true,true),
 'preview.cue':cmd('Play a cue on the PREVIEW playback only: the visualizer can show it while live output keeps running the real cue list. Never encoded to Art-Net, allowed while armed. Give one of: id (library cue), page+entry (uses that entry and its fade from the current live look), or cue (an unsaved cue definition). Optional fade overrides. Non-hold cues loop in preview. Read runtime.preview and runtime.previewFrames.',object({id,page:id,entry:id,cue:CUE,fade:number(0,60)},[]),true),
 'preview.stop':cmd('Stop the preview playback. Live output is unaffected.',object({}),true),
 'preview.go_live':cmd('Send the cue currently in preview to LIVE: a page entry GOes on its cue list with its fade; a library cue plays with the given or 2 s fade. Unsaved preview cues must be saved first. Clears the preview.',object({fade:number(0,60),requestId:id},[]),true,true),
 'blind.set':cmd('Blind programming on/off. While on, fixture.set, fixture.clear, point.recall and override.release edit a blind buffer that is shown only in runtime.previewFrames (over the preview cue, or over the live look when nothing is previewed); look.capture and point.save record from it. Nothing reaches live output until blind.apply or a recorded cue goes live. Lamp and calibration commands stay physical. Read runtime.blind.',object({enabled:bool}),true),
 'settings.set':cmd('Set playback preferences saved in the show: clearFade = seconds Clear (override.release) takes to fade manual changes back to the cue; blindFade = seconds for clearing blind changes and for blind.apply. 0 = instant cut. Read status show.playback.',object({clearFade:number(0,30),blindFade:number(0,30)},[]),true),
 'blind.apply':cmd('Move every blind change into the live programmer, fading from the current live look over fade seconds (default show.playback.blindFade). Empties the blind buffer; blind stays on.',object({fade:number(0,30)},[]),true,true),
 'preset.save':cmd('Create or replace a CUSTOM effect preset in the show effects library (built-ins ship with the app and cannot be changed). Pick effect from schema.effects (one with a layer) and an icon from schema.icons; params as in schema PARAMS (color, secondary, speed, brightness, panAmplitude, tiltAmplitude, frequency, width, ...). It then appears with custom:true in schema.presets and the Effects tab, and works anywhere a preset is accepted (fx.preview, fx.apply, effect.apply).',object({preset:PRESET}),true),
 'preset.delete':cmd('Delete a custom effect preset. Built-in presets cannot be deleted. Cues already made from it keep their tracks.',object({id}),true),
 'fx.preview':cmd('Preview a programmer effect on fixtures in the visualizer only (runtime.previewFrames; never output). Give preset (see schema presets) or effect, optional params and layer. Effects layer on the current look: position effects move around the current aim (moving heads only), intensity effects pulse the current level, color effects recolor. Re-sending with the same effect and fixtures keeps its phase.',object({fixtures:array(id,1,512),preset:id,effect:{enum:Object.keys(EFFECTS)},layer:LAYER,params:PARAMS},['fixtures']),true),
 'fx.cancel':cmd('Discard the previewed programmer effect.',object({}),true),
 'fx.apply':cmd('Run a programmer effect on the live lights: with no fixtures, promotes the previewed effect (same phase); otherwise starts the given preset/effect. One effect per fixture per layer; it fades in over show.playback.blindFade (or fade). Stays until fx.stop, override.release (Clear) or cue.record.',object({fixtures:array(id,1,512),preset:id,effect:{enum:Object.keys(EFFECTS)},layer:LAYER,params:PARAMS,fade:number(0,30)},[]),true,true),
 'fx.stop':cmd('Stop live programmer effects on the listed fixtures (all if omitted), fading back over show.playback.clearFade (or fade).',object({ids:array(id,1,512),fade:number(0,30)},[]),true,true),
 'cue.record':cmd('Record the programmer into a cue. id = an existing cue updates it (mode merge: only changed attributes and programmer effects are added, the cue keeps its own effects; mode replace: a snapshot of the whole current look). A new id saves a copy of from (default: the playing cue) plus the changes, or a snapshot when nothing is playing. While blind, records the blind changes. page/after insert the cue into a cue list; go:true then runs it. If the recorded cue is playing, the programmer is cleared without a visible change.',object({id,name:string,mode:{enum:['merge','replace']},from:id,page:id,after:id,fade:number(0,60),go:bool},['id']),true,true),
 'network.configure':cmd('Configure the OSC trigger listener sister apps send to. bind loopback = this Mac only (default); lan = the show network, accepting only IPs in allow (use "*" to accept any device, not recommended). port default 1461. Saved on this Mac (kept when a show is imported). Triggers can never arm output or edit the patch.',OSC_LISTEN,true),
 'network.status':cmd('Read the trigger network: listener state and address, allowlist, the /stagelight OSC address reference, named triggers, targets, and the last inbound/outbound messages with handling time in ms. No output.',object({})),
 'trigger.save':cmd('Create or replace a named trigger: a name sister apps send as /stagelight/trigger s:name, mapped to one show-control command (page.go, page.back, cue.play, cue.stop, override.release, blackout.set, master.set, ledwall.set, fx.apply, fx.stop) with its args.',object({trigger:TRIGGER}),true),
 'trigger.delete':cmd('Delete a named trigger.',object({id}),true),
 'trigger.fire':cmd('Fire a named trigger now, exactly as if a sister app sent it (for testing or from an agent).',object({id,requestId:id},['id']),true,true),
 'target.save':cmd('Create or replace a network target StageLight sends to: kind osc (host, port; UDP, lowest latency) or http (url; JSON POST). announce:true sends /stagelight/cue/live (or JSON) on every GO. look (protocol stagelight.look/1, docs/LOOK-LINK.md): zones = zone ids this target receives (empty/omitted = every zone), mode cue (a look with the cue end state on every GO) | change (also when the live look of its zones changes: ≥100 K, 0.002 Duv, 0.05 level or lit crossing 0; max 4/s, trailing send after 250 ms quiet, settled after fades) | off (default: only explicit cue sends), members:true adds per-fixture detail (JSON only), heartbeat seconds (0 = off). Cue-list entries add sends with page.save entry.send [{target, message: look|cue|osc|preset, address?, args?, preset?, fade?}].',object({target:TARGET}),true),
 'target.delete':cmd('Delete a network target. Entry sends that use it are removed.',object({id}),true),
 'target.test':cmd('Send a test message to a target now: ping (/stagelight/hello) or look (the live look of its zones, reason test, test:true). Sending only; the result and any reply summary appear in network.status.',object({id,message:{enum:['ping','look']}},['id']),true),
 'target.presets':cmd('Read the preset list a target app published (for preset sends: page.save entry.send {target, message:"preset", preset, fade?}). refresh:true asks the app now (HTTP: POST {type:"presets.request"}, reply {presets:[{id,name,description}]}; OSC: /stagelight/presets/request i:replyPort, answered with /stagelight/presets/begin|item|end); read again shortly after. Lists are kept in memory, not in the show.',object({id,refresh:bool},['id']),true),
 'zone.save':cmd('Create or replace a Look Link zone, saved in the portable show: {id, name, role: face|front|back|top|side|effect|audience|other, groups?, fixtures?} (at least one group or fixture; members are the union). Receiving apps key camera correction on role (face first). Read zones in status show.zones; see look.report for their measures.',object({zone:ZONE}),true),
 'zone.delete':cmd('Delete a Look Link zone. Targets stop receiving it.',object({id}),true),
 'look.report':cmd('Read exactly the stagelight.look/1 look message a target would get (JSON body and OSC burst), without sending or using a sequence number. Live stage by default (reason request); cue (library cue id) or page+entry give that cue\'s end state with current overrides, master and blackout (reason cue). Per zone: level, peak, lit, fixtures, color, kelvin, mired, duv (+ = green), cie, saturation, white, colorUnknown, members. target picks its zones and members setting; zones overrides; no target = every zone.',object({target:id,zones:array(id,1,32),cue:id,page:id,entry:id,members:bool},[]),false),
 'look.send':cmd('Send the live look to a target now (reason request) through its own transport (HTTP POST or OSC burst). Delivery and the app reply summary appear in network.status.',object({target:id,requestId:id},['target']),true),
 'page.back':cmd('Step back to the previous entry of the active page cue list, using that entry\'s fade unless fade is given.',object({fade:number(0,60)},[]),true,true),
 'override.release':cmd('Release manual overrides (all, or the listed fixtures) and fade them back to the running cue. While blind is on, releases blind changes instead, fading the blind view. Default fade: show.playback.clearFade (blindFade in blind); 0 releases instantly.',object({ids:array(id,1,512),fade:number(0,30)},[]),true,true),
 'effect.apply':cmd('Create a cue from a built-in effect preset (see schema presets) on a fixture group, optionally appending it to a page cue list. Returns created cue and entry IDs.',object({preset:id,group:id,id,name:string,color:hex,secondary:hex,speed:number(.05,4),brightness:number(0,1),duration:number(.5,3600),page:id,fade:number(0,60)},['preset','group']),true),
 'media.import':cmd('Copy a local image (png, jpg, webp, gif) or video (mp4, webm, mov, m4v) into the show media library for the LED wall preview. Absolute path; 500 MB maximum.',object({path:{type:'string',minLength:2,maxLength:1024},name:string}),true),
 'media.delete':cmd('Remove an imported media item and its file. Built-in media cannot be deleted.',object({id}),true),
 'visualizer.hide':cmd('Hide or show groups and/or fixtures in the 3D visualizer. Hidden fixtures are not drawn at all (no mesh, beam or pool), which keeps large rigs such as the 123 house pendants fast. Preview only: DMX output, cues and look reports are unaffected. hidden:true hides, hidden:false shows again (showing a group also clears hides on its own fixtures). A fixture stays hidden while any hidden group contains it. Saved in the show as show.visualizer.',object({groups:array(id,1,64),fixtures:array(id,1,512),hidden:bool},['hidden']),true),
 'visualizer.status':cmd('Read the 3D visualizer visibility: hidden groups, individually hidden fixtures, every hidden fixture ID and how many fixtures are drawn. No output.',object({})),
 'ledwall.set':cmd('Choose what the LED wall shows in the 3D preview: a media ID from status show.media or schema media, or "off". Optional brightness 0..1 and fit cover|contain|stretch. Preview only; never sent to physical output. Saved in the show.',object({media:id,brightness:number(0,1),fit},[]),true),
 'cue.pause':cmd('Pause/resume time without dropping continuous DMX output.',object({paused:bool}),true,true),
 'cue.seek':cmd('Preview-only seek; disabled while physical output is armed.',object({seconds:number(0,3600)}),true),
 'cue.stop':cmd('Stop playback, clear manual overrides and fade intensity to zero while holding positions.',object({fade:number(0,10)},[]),true,true),
 'effect.preview':cmd('Run an unsaved effect as a temporary cue. Preview-only: refuses while armed.',object({group:id,effect:{enum:Object.keys(EFFECTS)},params:PARAMS,duration:number(1,3600)},['group','effect','params']),true),
 'effect.save':cmd('Save a named reusable effect recipe.',object({id,name:string,group:id,effect:{enum:Object.keys(EFFECTS)},params:PARAMS}),true),
 'fixture.lamp':cmd('Explicit supported-fixture lamp strike/douse: MH7 ch21=50/70; 200W Beam ch16=200/100; 7R ch16=101/26. Sends for five seconds, then neutral. Live output and mapped enabled lamp-control profiles required. Does not confirm lamp ignition. Allow five minutes warm-up before dousing; hot lamps must cool before restriking. Never part of cue playback.',object({ids:array(id,1,64),action:{enum:['strike','douse']}}),true,true),
 'fixture.set':cmd('Override named fixture attributes. colorWheel: 200W ch9=0..127, 7R ch1=0..119 (static range); colorWheel2: 200W ch10=0..255. Saved fixture colorSlots translate RGB colors; raw wheel values take precedence. Setting color alone clears raw wheel overrides. MH7 intensity defaults to open beam. Never accepts arbitrary DMX or lamp/reset commands. Reaches fixtures only while armed.',object({ids:array(id,1,512),values:attrs}),true,true),
 'fixture.color.save':cmd('Save an observed wheel color for one 200W or 7R fixture in the portable show. RGB requests use the nearest saved color; preview uses its observed swatch. Replaces the same value/secondary pair. Does not strike lamps or change intensity/pose. Use fixture.set colorWheel to test first. 200W value 0..127, 7R 0..119; secondary is 200W channel10 only.',object({id,name:string,color:hex,value:integer(0,127),secondary:integer(0,255)},['id','name','color','value']),true,true),
 'fixture.colors.save':cmd('Save an observed wheel color atomically. Default scope selection records each entry’s own value. Scope profile copies each source entry to every head with its exact profile, so one 7R observation calibrates all four 7Rs. Provide one source per profile; different profiles retain separate wheel values. Also saves the named color in the shared palette. Persists in portable show; does not change intensity, aim, wheel overrides or lamps.',object({name:string,color:hex,scope:{enum:['selection','profile']},entries:array(object({id,value:integer(0,127),secondary:integer(0,255)},['id','value']),1,64)},['name','color','entries']),true,true),
 'fixture.clear':cmd('Clear manual attribute overrides for selected fixtures.',object({ids:array(id,1,512)}),true,true),
 'fixture.place':cmd('Save virtual stage XYZ placement. Does not change DMX or move the actual head. Optional aim = stage XYZ point a fixed (non-moving) head faces in the visualizer, e.g. front-truss washes aimed upstage at face height. Stage: X left/right, Y up, Z toward the audience (back truss ≈ -3.6, front-of-house truss Z=8).',object({id,position:array(number(-50,50),3,3),aim:array(number(-50,50),3,3)},['id','position']),true),
 'calibration.hold':cmd('Pause playback and hold the current fixture pan/tilt for visual alignment. Returns actual normalized commanded pose; operator must wait for motor settling.',object({id}),true,true),
 'calibration.align':cmd('Save a one-point visual alignment against a held actual commanded pose. Virtual degrees: yaw around vertical; tilt 0 down, 90 horizontal. Adjusts preview only, not DMX. Rejects a stale actual pose.',object({id,actual:vec(0,1),virtual:vec(-720,720),panSign:{enum:[-1,1]},tiltSign:{enum:[-1,1]},name:string}),true),
 'show.import':cmd('Import a portable show with stage placement, alignment and cues. Disarmed only. Retains this Mac network settings and backs up the previous show.',object({show:{}}),true),
 'fixture.patch':cmd('Create/update a fixture profile, address, position and calibration. Only allowed while output is disarmed.',object({fixture:FIXTURE}),true),
 'group.save':cmd('Create or replace an ordered fixture group, used for selection, presets and spatial effects.',object({id,name:string,fixtures:array(id,1,512)}),true),
 'palette.save':cmd('Save a named color.',object({id,name:string,color:hex}),true),
 'point.save':cmd('Capture current pan/tilt values for fixtures under a named position. Preview values require physical verification before live use.',object({id,name:string,fixtures:array(id,1,512)}),true),
 'point.recall':cmd('Recall a named position using fixture overrides within the calibrated range. Optional ids limits the recall to those fixtures (e.g. one group); fixtures without a stored pose are skipped.',object({id,ids:array(id,1,512)},['id']),true,true),
 'point.delete':cmd('Delete a named position. Rejected while a cue track uses it.',object({id}),true),
 'group.edit':cmd('Rename a group and/or add or remove fixtures without resending the whole list. add appends in the given order (existing members are skipped); remove drops members. A group keeps at least one fixture. Use group.save to replace the whole ordered list.',object({id,name:string,add:array(id,1,512),remove:array(id,1,512)},['id']),true),
 'group.delete':cmd('Delete a fixture group. Rejected while a cue track or saved effect uses it.',object({id}),true),
 'palette.delete':cmd('Delete a named color.',object({id}),true),
 'master.set':cmd('Set normalized master intensity, 0..1.',object({value:number(0,1)}),true,true),
 'blackout.set':cmd('Set blackout explicitly, never toggle. Holds positions; closes shutters.',object({enabled:bool}),true,true),
 'output.configure':cmd('Configure unicast IPv4 output and raw Art-Net universe mapping; disarmed only.',object({source:string,target:string,mappings:object({'1':integer(0,32767),'2':integer(0,32767),'3':integer(0,32767),'4':integer(0,32767),'5':integer(0,32767),'6':integer(0,32767),'7':integer(0,32767),'8':integer(0,32767)},['3','4','5'])}),true),
 'output.status':cmd('Read the Art-Net output settings and health: Mac source address, console/node destination, UDP port, Hog→Art-Net universe mapping, armed state, packets sent, last send and error, this Mac\'s IPv4 adapters and the last output.check result. Disarmed means NOTHING reaches the rig. No output.',object({})),
 'output.check':cmd('Test the path to the console or Art-Net node without sending DMX: is the source address on this Mac, is the destination on its subnet, does it answer ping, and does it reply to an ArtPoll (Art-Net enabled, its name and output universes). Optional source/target test other addresses before saving them. Takes about 3 s. A reply is not proof that a fixture responds.',object({source:string,target:string},[])),
 'output.arm':cmd('Enable PHYSICAL Art-Net output. Requires explicit operator authorization. Uses verified fixture profiles and bounded positions. Clear preview playback before arming.',object({confirmation:{const:'ENABLE_PHYSICAL_OUTPUT'}}),true,true),
 'output.disarm':cmd('Close shutters and zero intensities, then stop Art-Net transmission. Does not return Hog channels to HogNet.',object({}),true,true)
};
export function validate(schema,value,path='arguments'){
 if(schema.const!==undefined&&value!==schema.const)throw Error(`${path}: expected ${schema.const}`);
 if(schema.enum&&!schema.enum.includes(value))throw Error(`${path}: unsupported value`);
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}: expected object`);
  for(const k of schema.required??[])if(!Object.hasOwn(value,k))throw Error(`${path}.${k}: required`);
  for(const [k,v] of Object.entries(value)){if(!Object.hasOwn(schema.properties,k))throw Error(`${path}.${k}: unknown field`);validate(schema.properties[k],v,`${path}.${k}`)}
 }
 if(schema.type==='array'){
  if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??1e6))throw Error(`${path}: invalid array length`);
  value.forEach((v,i)=>validate(schema.items,v,`${path}[${i}]`));
 }
 if(schema.type==='string'&&(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??1e6)||(schema.pattern&&!new RegExp(schema.pattern).test(value))))throw Error(`${path}: invalid text`);
 if(['number','integer'].includes(schema.type)&&(!Number.isFinite(value)||value<schema.minimum||value>schema.maximum||(schema.type==='integer'&&!Number.isInteger(value))))throw Error(`${path}: number outside allowed range`);
 if(schema.type==='boolean'&&typeof value!=='boolean')throw Error(`${path}: expected boolean`);
}
export function validateShow(s){
 if(s.version!==1)throw Error('Unsupported show version');
 if(!Array.isArray(s.fixtures)||s.fixtures.length>512)throw Error('Invalid fixtures');
 const ids=new Set(),slots=new Set();
 for(const f of s.fixtures){validate(FIXTURE,f,'fixture');if(ids.has(f.id))throw Error('Duplicate fixture ID');ids.add(f.id);
  const colors=new Set();for(const slot of f.colorSlots??[]){validateWheelAttributes(f,{colorWheel:slot.value,...(slot.secondary===undefined?{}:{colorWheel2:slot.secondary})});const key=slot.value+':'+(slot.secondary??0);if(colors.has(key))throw Error('Duplicate fixture color slot');colors.add(key)}
  const c=f.calibration;for(const k of ['panRange','tiltRange'])if(c[k][0]>=c[k][1])throw Error('Range minimum must be below maximum');
  if(c.home[0]<c.panRange[0]||c.home[0]>c.panRange[1]||c.home[1]<c.tiltRange[0]||c.home[1]>c.tiltRange[1])throw Error('Home must be inside ranges');
  // Enabled + unverified = preview only: it lights in the visualizer but encode() never sends its DMX until verified.
  if(f.enabled){if(f.profile==='unknown'||f.address<1||f.universe<1)throw Error('Enabled fixtures need a known profile and patch');
   const count=PROFILE_DEFS[f.profile].channels;if(f.address+count-1>512)throw Error('Fixture exceeds universe');
   for(let a=f.address;a<f.address+count;a++){const slot=`${f.universe}:${a}`;if(slots.has(slot))throw Error('Overlapping patch');slots.add(slot)}
  }
 }
 for(const g of s.groups){validate(COMMANDS['group.save'].schema,g);if(new Set(g.fixtures).size!==g.fixtures.length)throw Error('Duplicate group member');for(const id of g.fixtures)if(!ids.has(id))throw Error(`Unknown fixture ${id}`)}
 const groupIds=new Set(s.groups.map(g=>g.id));if(groupIds.size!==s.groups.length)throw Error('Duplicate group ID');
 for(const cue of s.cues){validate(CUE,cue);if(!cue.tracks.length&&!cue.look?.length)throw Error('Cue needs tracks or a saved look');for(const entry of cue.look??[]){if(!ids.has(entry.id))throw Error('Unknown fixture in saved look');validateWheelAttributes(s.fixtures.find(f=>f.id===entry.id),entry.values)}for(const t of cue.tracks){if((t.group===undefined)===(t.fixtures===undefined))throw Error('A track needs a group or a fixture list');if(t.group!==undefined&&!groupIds.has(t.group))throw Error(`Unknown group ${t.group}`);for(const id of t.fixtures??[])if(!ids.has(id))throw Error('Unknown fixture '+id+' in track');for(const id of t.fixtures??s.groups.find(g=>g.id===t.group).fixtures)validateWheelAttributes(s.fixtures.find(f=>f.id===id),t.params);if(t.start+t.duration>cue.duration+.0001)throw Error('Track exceeds cue duration');if(t.params.pointA&&!s.points.some(p=>p.id===t.params.pointA))throw Error('Unknown position A');if(t.params.pointB&&!s.points.some(p=>p.id===t.params.pointB))throw Error('Unknown position B');}}
 if(new Set(s.cues.map(c=>c.id)).size!==s.cues.length)throw Error('Duplicate cue ID');
 const cueIds=new Set(s.cues.map(c=>c.id));
 for(const page of s.pages??[]){validate(PAGE,page,'page');if(new Set(page.cues.map(e=>e.id)).size!==page.cues.length)throw Error('Duplicate cue list entry');for(const e of page.cues)if(!cueIds.has(e.cue))throw Error(`Page ${page.name} uses unknown cue ${e.cue}`)}
 if(new Set((s.pages??[]).map(p=>p.id)).size!==(s.pages??[]).length)throw Error('Duplicate page ID');
 for(const m of s.media??[])validate(MEDIA,m,'media');
 const mediaIds=new Set([...BUILTIN_MEDIA,...(s.media??[])].map(m=>m.id));if(mediaIds.size!==BUILTIN_MEDIA.length+(s.media??[]).length)throw Error('Duplicate media ID');
 if(s.playback)validate(PLAYBACK,s.playback,'playback');
 if(s.settings.osc)validate(OSC_LISTEN,s.settings.osc,'settings.osc');
 const targetIds=new Set();for(const t of s.targets??[]){validate(TARGET,t,'target');if(t.kind==='osc'&&(!t.host||!t.port))throw Error(`Target ${t.name} needs host and port`);if(t.kind==='http'&&!t.url)throw Error(`Target ${t.name} needs a URL`);if(targetIds.has(t.id))throw Error('Duplicate target ID');targetIds.add(t.id)}
 for(const t of s.triggers??[]){validate(TRIGGER,t,'trigger');validate(COMMANDS[t.command].schema,t.args??{},'trigger '+t.name)}
 if(new Set((s.triggers??[]).map(t=>t.id)).size!==(s.triggers??[]).length)throw Error('Duplicate trigger ID');
 if((s.zones??[]).length>32)throw Error('At most 32 zones');const zoneIds=new Set();
 for(const z of s.zones??[]){validate(ZONE,z,'zone');if(zoneIds.has(z.id))throw Error('Duplicate zone ID');zoneIds.add(z.id);if(!(z.groups?.length||z.fixtures?.length))throw Error(`Zone ${z.name} needs a group or a fixture`);
  for(const g of z.groups??[])if(!groupIds.has(g))throw Error(`Zone ${z.name} uses unknown group ${g}`);for(const id of z.fixtures??[])if(!ids.has(id))throw Error(`Zone ${z.name} uses unknown fixture ${id}`)}
 for(const t of s.targets??[]){const l=t.look;if(!l)continue;for(const z of l.zones??[])if(!zoneIds.has(z))throw Error(`Target ${t.name} uses unknown zone ${z}`);if(new Set(l.zones??[]).size!==(l.zones??[]).length)throw Error('Duplicate zone in target');if(l.heartbeat>0&&l.heartbeat<1)throw Error('Heartbeat is 0 (off) or at least 1 second')}
 for(const p of s.pages??[])for(const e of p.cues)for(const x of e.send??[]){if(!targetIds.has(x.target))throw Error(`Unknown target ${x.target}`);if(x.message==='osc'&&!x.address)throw Error('A custom OSC send needs an address');if(x.message==='preset'&&!x.preset)throw Error('A preset send needs a preset id');if(x.message!=='preset'&&(x.preset!==undefined||x.fade!==undefined))throw Error('preset and fade belong to preset sends');for(const a of x.args??[])if(!(typeof a==='string'&&a.length<=200)&&!(typeof a==='number'&&Number.isFinite(a)))throw Error('OSC args must be strings or numbers')}
 for(const p of s.presets??[]){validate(PRESET,p,'preset');if(Object.hasOwn(EFFECT_PRESETS,p.id))throw Error(`Preset ${p.id} is a built-in name`)}
 if(new Set((s.presets??[]).map(p=>p.id)).size!==(s.presets??[]).length)throw Error('Duplicate preset ID');
 if(s.visualizer){validate(VISUALIZER,s.visualizer,'visualizer');for(const g of s.visualizer.hiddenGroups??[])if(!s.groups.some(x=>x.id===g))throw Error('Unknown hidden group '+g);for(const id of s.visualizer.hiddenFixtures??[])if(!ids.has(id))throw Error('Unknown hidden fixture '+id)}
 if(s.ledWall){validate(LEDWALL,s.ledWall,'ledWall');if(s.ledWall.media!=='off'&&!mediaIds.has(s.ledWall.media))throw Error('Unknown LED wall media')}
 validate(COMMANDS['output.configure'].schema,{source:s.settings.source,target:s.settings.target,mappings:s.settings.mappings});
 if(new Set(Object.values(s.settings.mappings)).size!==Object.values(s.settings.mappings).length)throw Error('Universe mappings must be distinct');
}
export function validateWheelAttributes(f,values){
 if(values.colorWheel!==undefined){if(!['beam200','beam7r'].includes(f.profile))throw Error('Direct wheel control is supported on 200W Beam and 7R only');if(f.profile==='beam7r'&&values.colorWheel>119)throw Error('7R static color wheel range is 0–119; spin is excluded');}
 if(values.colorWheel2!==undefined&&f.profile!=='beam200')throw Error('Colour 2 is supported on 200W Beam only');
}
