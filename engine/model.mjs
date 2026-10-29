import {COLOR_WHEELS} from '../public/fixture-colors.js';
import {BEAM200_COLOR_PRESETS} from '../public/beam200-presets.js';
import {BEAM7R_COLOR_PRESETS} from '../public/beam7r-presets.js';
export const PROFILE_DEFS = {
  beam7r:{colorPresets:BEAM7R_COLOR_PRESETS,name:'7R Beam 230W · Hog 16ch · observed colors',channels:16,moving:true,panTravel:540,tiltTravel:270,maxGobo:14,colorMapping:'fixture-calibrated',colorControls:{primary:{channel:1,min:0,max:119},secondary:null},lampControl:{channel:16,strike:101,douse:26,neutral:0,pulseSeconds:5},attributes:['intensity','color','colorWheel','pan','tilt','frost','focus','gobo','goboShake','prism','prismRotation'],source:'Operator-provided Hog 7R Beam 230W 16ch Advanced screenshots, 2026-10-25'},
  beam200:{colorPresets:BEAM200_COLOR_PRESETS,name:'200W Beam · Hog 16ch · observed colors',channels:16,moving:true,panTravel:450,tiltTravel:270,colorMapping:'fixture-calibrated',colorControls:{primary:{channel:9,min:0,max:127},secondary:{channel:10,min:0,max:255}},lampControl:{channel:16,strike:200,douse:100,neutral:0,pulseSeconds:5},attributes:['intensity','color','colorWheel','colorWheel2','pan','tilt','movementSpeed','frost','gobo','goboShake','focus','prism','prismRotation'],source:'Operator-provided Hog 200W Beam Advanced screenshots, 2026-10-25'},
  q120:{name:'MEGA-LITE Colorlite Q120 · 5ch',channels:5,moving:false,attributes:['intensity','color','white'],source:'https://goknight.com/content/documentation/Colorlite%20Q120%20Manual%20V4.pdf'},
  colorado:{name:'COLORado 2 Quad Zoom · AR2.Z',channels:7,moving:false,attributes:['intensity','color','white','zoom'],source:'https://chauvetprofessional.com/wp-content/uploads/2018/01/COLORado_2_Quad_Zoom_UM-Rev5.pdf'},
  // Hog "Ovation Reve E-3 12ch" = Chauvet 12Ch: dimmer, dimmer fine, R, G, B, amber, mint, strobe, virtual color wheel, color temperature, hue, gobo rotator. Ch8–12 at 0 = off/no function/index 0.
  reveE3:{name:'Ovation Rêve E-3 · 12ch',channels:12,moving:false,attributes:['intensity','color','white'],source:'https://chauvetprofessional.com/wp-content/uploads/2021/03/Ovation-Reve-E-3_UM_Rev14.pdf'},
  // Hog "RGBW Pendant Light 4ch" house lights. Layout from the Hog Fixture Builder (operator photo 2026-10-28): ch1 Intensity, ch2 Red, ch3 Green, ch4 Blue, each 0-255. No white channel despite the name.
  pendant4:{name:'RGBW Pendant Light · Hog 4ch (dimmer, R, G, B)',channels:4,moving:false,attributes:['intensity','color']},
  rogue:{colorWheel:COLOR_WHEELS.rogue,name:'Rogue R3 Beam · 16ch',channels:16,moving:true,attributes:['intensity','color','pan','tilt','movementSpeed','gobo','prism','prismRotation','frost','focus'],source:'https://chauvetprofessional.com/wp-content/uploads/2021/04/Rogue_R3_Beam_UM_Rev6-1.pdf'},
  mh7:{colorWheel:COLOR_WHEELS.mh7,defaultOpticalMode:'beam',defaultGobo:0,opticalModes:['spot','beam'],lampControl:{channel:21,strike:50,douse:70,neutral:0,pulseSeconds:5},name:'Martin RUSH MH 7 Hybrid · 21ch',channels:21,moving:true,attributes:['intensity','color','pan','tilt','opticalMode','zoom','focus','frost','gobo','prism','prismRotation'],source:'https://www.fullcompass.com/common/files/27391-MartinProfessionalRUSHMH7HybridUserManual.pdf'},
  unknown:{name:'Unverified fixture · preview only',channels:0,moving:true,attributes:['intensity','color','pan','tilt']}
};
export const EFFECTS = {
  strobe:{layer:'intensity',name:'Scattered strobe wave',description:'Staggered dimmer flashes travel forward and back; optional alternating pan/tilt fans around a saved position. No hardware strobe channel.'},
  static:{name:'Still look',description:'A palette or a calibrated position, held steadily.'},
  chase:{layer:'intensity',name:'Comet',description:'A bright head with a soft trailing tail across a group.'},
  wave:{layer:'color',name:'Color tide',description:'Smooth brightness waves with a two-color gradient.'},
  mirror:{layer:'color',name:'Center bloom',description:'A wave expanding symmetrically from the group center.'},
  rainbow:{layer:'color',name:'Spectrum',description:'A traveling spectrum with staggered intensity.'},
  pulse:{layer:'intensity',name:'Alternating pulse',description:'Smooth complementary pulses on alternating fixtures.'},
  sweep:{layer:'position',name:'Mirrored sweep',description:'Slow position sweeps with phase spread, inside fixture limits.'},
  orbit:{layer:'position',name:'Ellipse',description:'A continuous pan/tilt ellipse inside each calibrated range.'},
  sparkle:{layer:'intensity',name:'Constellation',description:'Deterministic soft glints; no high-frequency strobe.'},
  fade:{layer:'intensity',name:'Fade',description:'Ramps intensity in or out (params.direction) across the whole track. Combine with cue.hold to keep the end state.'},
  breathe:{layer:'intensity',name:'Breathe',description:'All fixtures swell and relax together with a slow two-color drift.'},
  figure8:{layer:'position',name:'Figure eight',description:'Pan/tilt figure-eight inside each calibrated range. Moving heads only.'},
  ballyhoo:{layer:'position',name:'Ballyhoo',description:'Wide, uneven pan and tilt swings across the group. Moving heads only.'}
};
// One-click starting points for people programming by hand. Agents can use
// them through effect.apply or compose any cue directly with cue.save.
const preset=(name,icon,category,effect,params,extra={})=>({name,icon,category,effect,params,duration:20,loop:true,...extra});
export const EFFECT_PRESETS={
  'strobe':preset('Strobe','strobe','intensity','strobe',{color:'#ffffff',frequency:4,duty:.3,strobePattern:'scatter',brightness:1},{description:'Fast dimmer flashes. Not the hardware strobe channel.'}),
  'fade-in':preset('Fade in','fade-in','intensity','fade',{color:'#ffffff',direction:'in',brightness:.9},{duration:5,loop:false,hold:true,description:'Rise from dark and hold.'}),
  'fade-out':preset('Fade out','fade-out','intensity','fade',{color:'#ffffff',direction:'out',brightness:.9},{duration:5,loop:false,hold:true,description:'Dim to dark and hold positions.'}),
  'breathe':preset('Breathe','breathe','intensity','breathe',{color:'#ffb84a',secondary:'#ff7a3d',speed:.5,brightness:.85}),
  'chase':preset('Chase','chase','intensity','chase',{color:'#52d3ff',secondary:'#6833e8',speed:1,width:.25,brightness:.9}),
  'alternate':preset('Alternate','alternate','intensity','pulse',{color:'#ffb84a',secondary:'#326dff',speed:.8,brightness:.85}),
  'twinkle':preset('Twinkle','twinkle','intensity','sparkle',{color:'#e8f1ff',speed:.8,brightness:.8}),
  'rainbow':preset('Rainbow','rainbow','color','rainbow',{speed:.8,brightness:.85}),
  'color-tide':preset('Color tide','tide','color','wave',{color:'#24dbd9',secondary:'#ee4ace',speed:.8,brightness:.8}),
  'bloom':preset('Center bloom','bloom','color','mirror',{color:'#dd54f1',secondary:'#4a5cf5',speed:.8,brightness:.9}),
  'circle':preset('Circle','circle','movement','orbit',{color:'#ffffff',speed:.6,panAmplitude:.045,tiltAmplitude:.035,brightness:.85},{movers:true}),
  'figure8':preset('Figure 8','figure8','movement','figure8',{color:'#ffffff',speed:.5,panAmplitude:.05,tiltAmplitude:.025,brightness:.85},{movers:true}),
  'sweep':preset('Pan sweep','sweep','movement','sweep',{color:'#ffffff',speed:.5,panAmplitude:.06,tiltAmplitude:.01,brightness:.85},{movers:true}),
  'ballyhoo':preset('Ballyhoo','ballyhoo','movement','ballyhoo',{color:'#ffffff',speed:.6,panAmplitude:.06,tiltAmplitude:.05,brightness:.9},{movers:true})
};
// Built-in LED wall art lives in public/led and is always available.
export const BUILTIN_MEDIA=[
  {id:'salvation-title',name:'Salvation title',kind:'image',src:'/led/salvation-title.svg'},
  {id:'sunrise',name:'Sunrise',kind:'image',src:'/led/sunrise.svg'},
  {id:'starfield',name:'Starfield',kind:'image',src:'/led/starfield.svg'},
  {id:'stained-glass',name:'Stained glass',kind:'image',src:'/led/stained-glass.svg'},
  {id:'cross-glow',name:'Cross glow',kind:'image',src:'/led/cross-glow.svg'},
  {id:'ocean',name:'Ocean',kind:'image',src:'/led/ocean.svg'}
];
// Fixtures by id, built once per fixtures array (the engine replaces the show object on every update). Render, encode,
// effects and Look Link measures all run per tick over hundreds of fixtures; a linear find for each would be quadratic.
const indexes=new WeakMap();
export function fixtureIndex(show){const list=show.fixtures;let m=indexes.get(list);if(!m||m.size!==list.length){m=new Map(list.map(f=>[f.id,f]));indexes.set(list,m)}return m}
// Look Link zone members: its groups' fixtures then its own, each once, in order (enabled or not).
export const zoneFixtures=(show,zone)=>[...new Set([...(zone.groups??[]).flatMap(g=>show.groups.find(x=>x.id===g)?.fixtures??[]),...(zone.fixtures??[])])];
// Masters start blank and flash: slots 1–9 on the home row A S D F G H J K L, Highlight on Shift+H (docs/MASTERS-AND-SCENES.md).
export const MASTER_KEYS=['a','s','d','f','g','h','j','k','l'];
export const defaultMasters=()=>({slots:Array.from({length:18},(_,i)=>({id:'m'+(i+1),...(MASTER_KEYS[i]?{key:MASTER_KEYS[i]}:{}),action:'flash',fade:0})),desk:{highlight:'shift+h',clear:'c',blackout:'b'}});
// Shows saved before pages existed get one page holding every cue, in order.
export function migrate(show){
 if(!show.pages)show.pages=[{id:'scene-1',name:'Scene 1',color:'#8bc9d0',cues:show.cues.map((c,i)=>({id:'entry-'+(i+1),cue:c.id,fade:2,follow:'manual'}))}];
 if(!show.groups.some(g=>g.id==='movers'))show.groups.push({id:'movers',name:'All moving heads',fixtures:show.fixtures.filter(f=>f.enabled&&['rogue','mh7','beam200','beam7r'].includes(f.profile)).map(f=>f.id)});
 show.media??=[];show.playback??={clearFade:3,blindFade:2};show.presets??=[];show.targets??=[];show.triggers??=[];show.zones??=[];show.visualizer??={hiddenGroups:[],hiddenFixtures:[]};show.ledWall??={media:'salvation-title',brightness:.85,fit:'cover'};
 show.scenes??=[];show.masters??=defaultMasters();show.playback.sceneFade??=2;
 return show;
}
const track=(group,effect,start,duration,params={})=>({group,effect,start,duration,params,fadeIn:1,fadeOut:1});
export function defaults(){
 const fixtures=[];
 for(let i=0;i<8;i++)fixtures.push({id:String(401+i),name:`Backlight ${i+1}`,profile:'colorado',universe:3,address:1+7*i,enabled:true,verified:true,position:[-7+i*2,4.7,-3.5],calibration:{home:[.5,.53],panRange:[0,1],tiltRange:[0,1],invertPan:false,invertTilt:false,reviewed:true}});
 const xs=[-7,-5.5,-4,4,5.5,7];
 for(let i=0;i<6;i++)fixtures.push({id:String(301+i),name:`Rogue ${i+1}`,profile:'rogue',universe:i<4?4:5,address:106+(i<4?i:i-4)*16,enabled:true,verified:true,position:[xs[i],6.3,(i===1||i===4)?0:2],calibration:{home:[.49,.5625],panRange:[0,1],tiltRange:[0,1],invertPan:false,invertTilt:false,reviewed:false}});
 fixtures.push(...mh7Fixtures(),...gridFixtures());
 fixtures.push(...rearHeadFixtures());
 return migrate({version:1,name:'Salvation · lighting study',fixtures,
  groups:[{id:'rear-heads',name:'Rear heads',fixtures:rearHeadFixtures().map(f=>f.id)},...gridGroups(),{id:'mh7s',name:'MH7s · provisional positions',fixtures:mh7Fixtures().map(f=>f.id)},{id:'audience',name:'Audience MH7s',fixtures:['3101','3102']},{id:'backlights',name:'Backlights',fixtures:fixtures.slice(0,8).map(f=>f.id)},{id:'rogues',name:'Front beams',fixtures:fixtures.slice(8,14).map(f=>f.id)},{id:'left',name:'Stage left',fixtures:['401','402','403','404','301','302','303']},{id:'right',name:'Stage right',fixtures:['405','406','407','408','304','305','306']}],
  palettes:[{id:'white',name:'White',color:'#ffffff'},{id:'midnight',name:'Midnight',color:'#335dff'},{id:'orchid',name:'Orchid',color:'#d949f3'},{id:'gold',name:'Gold',color:'#ffb84a'},{id:'ice',name:'Ice',color:'#72e5ff'}],
  points:[],effects:[{id:'ocean-comet',name:'Ocean comet',group:'backlights',effect:'chase',params:{color:'#58ceff',secondary:'#6946e8',speed:1,brightness:.85,width:.25}}],
  cues:[{id:'first-light',name:'First light',description:'A quiet blue wash with a gentle beam fan.',duration:20,loop:true,tracks:[track('backlights','wave',0,20,{color:'#4285ff',secondary:'#aa5cf5',brightness:.5,speed:.35}),track('rogues','sweep',0,20,{color:'#73dcff',brightness:.32,speed:.3,panAmplitude:.025,tiltAmplitude:.01})]},
   {id:'prism-dance',name:'Prism dance',description:'Six beams answer eight washes. A one-minute choreography.',duration:60,loop:false,tracks:[
    track('backlights','chase',0,10,{color:'#52d3ff',secondary:'#6833e8',brightness:.85,speed:1.2,width:.25}),track('rogues','sweep',0,10,{color:'#53d5ff',brightness:.55,speed:.4,panAmplitude:.025,tiltAmplitude:.01}),
    track('backlights','wave',10,10,{color:'#24dbd9',secondary:'#ee4ace',brightness:.8,speed:1}),track('rogues','orbit',10,10,{color:'#de40ef',brightness:.6,speed:.45,panAmplitude:.03,tiltAmplitude:.018,prism:1}),
    track('backlights','pulse',20,10,{color:'#ffb84a',secondary:'#326dff',brightness:.85,speed:.8}),track('rogues','sweep',20,10,{color:'#ffb84a',brightness:.55,speed:.55,panAmplitude:.035,tiltAmplitude:.015,prism:2,gobo:2}),
    track('backlights','mirror',30,10,{color:'#dd54f1',secondary:'#4a5cf5',brightness:.9,speed:.8}),track('rogues','sweep',30,10,{color:'#b75aff',brightness:.65,speed:.4,panAmplitude:.035,tiltAmplitude:.02,prism:1}),
    track('backlights','rainbow',40,10,{brightness:.8,speed:1.1}),track('rogues','orbit',40,10,{color:'#5bdcff',brightness:.7,speed:.6,panAmplitude:.03,tiltAmplitude:.018,prism:2}),
    track('backlights','wave',50,7,{color:'#dee9ff',secondary:'#5864ff',brightness:1,speed:1.2}),track('rogues','sweep',50,7,{color:'#ffffff',brightness:.75,speed:.45,panAmplitude:.025,tiltAmplitude:.01,prism:1,frost:.08}),
    {...track('backlights','static',57,3,{color:'#ffe2ba',brightness:.8}),fadeIn:.3,fadeOut:2.5},{...track('rogues','static',57,3,{color:'#fff0d7',brightness:.65}),fadeIn:.3,fadeOut:2.5}]},
   {id:'afterglow',name:'Afterglow',description:'A slow gold and lavender breathing look.',duration:30,loop:true,tracks:[track('backlights','wave',0,30,{color:'#f1b65b',secondary:'#9f72e8',brightness:.45,speed:.25}),track('rogues','static',0,30,{color:'#ffb54a',brightness:.22,prism:1,frost:.3})]}],
  pages:[{id:'scene-1',name:'Opening',color:'#8bc9d0',cues:[{id:'entry-1',cue:'first-light',fade:3,follow:'manual'},{id:'entry-2',cue:'prism-dance',fade:2,follow:'auto'},{id:'entry-3',cue:'afterglow',fade:4,follow:'manual'}]}],
  media:[],ledWall:{media:'salvation-title',brightness:.85,fit:'cover'},
  settings:{source:'10.0.0.50',target:'10.0.0.1',port:6454,fps:30,mappings:{3:2,4:3,5:4}},stage:{width:19,depth:10,height:7,estimated:true,notes:'Approximate geometry traced from the stage photo. Fixture order for Rogue IDs is provisional; calibrate in the room.'}});
}

// Patch transcribed from the operator's Hog fixture window. Positions provisional.
export function mh7Fixtures(){
 const rows=[['705',6,1,[-5,.7,-2.9]],['707',6,43,[-2,.7,-2.9]],['708',6,64,[2,.7,-2.9]],['706',6,22,[5,.7,-2.9]],['3101',1,337,[-5.5,6.3,8]],['3102',1,358,[5.5,6.3,8]],['3103',6,235,[-8.5,.7,2]],['3104',6,256,[8.5,.7,2]]];
 return rows.map(([id,universe,address,position])=>({id,name:`MH7 ${id} · ${id==='3101'?'audience left?':id==='3102'?'audience right?':'location provisional'}`,profile:'mh7',universe,address,enabled:true,verified:true,position,calibration:{home:[.5,.5],panRange:[0,1],tiltRange:[0,1],invertPan:false,invertTilt:false,reviewed:false}}));
}

// Six rows, back to front; ascending IDs left to right. Last two positions unknown.
export function gridFixtures(){
 const patches=[[4,1],[4,6],[4,36],[4,11],[4,16],[4,21],[4,26],[4,31],[4,41],[4,46],[4,51],[5,56],[5,61],[5,66],[5,71],[5,76],[5,81],[5,86],[5,91],[5,96],[5,101]];
 const counts=[5,3,4,3,5,3];let index=0;
 return counts.flatMap((count,row)=>Array.from({length:count},(_,col)=>{
  const i=index++,known=i<patches.length;const [universe,address]=patches[i]??[0,0];
  const x=row===0?[-7,-5.8,-1,3,7][col]:-7+14*col/(count-1);
  return {id:known?String(201+i):`grid-pending-${i-20}`,name:`Grid row ${row+1} · ${col+1}${known?'':' · patch unknown'}`,profile:known?'q120':'unknown',universe,address,enabled:known,verified:known,position:[x,6.1,-3.6+row*1.6],calibration:{home:[.5,.5],panRange:[0,1],tiltRange:[0,1],invertPan:false,invertTilt:false,reviewed:known}};
 }));
}
export function gridGroups(){const fixtures=gridFixtures();let offset=0;return [{id:'grid',name:'Ceiling grid · 21 patched / 23 positions',fixtures:fixtures.map(f=>f.id)},...[5,3,4,3,5,3].map((n,i)=>{const ids=fixtures.slice(offset,offset+n).map(f=>f.id);offset+=n;return {id:`grid-row-${i+1}`,name:`Grid row ${i+1} · back to front`,fixtures:ids}})];}

// Hog patches and operator-confirmed left-to-right rear bar order.
export function rearHeadFixtures(){
 return [['4104',120,'7R Beam 230W 16ch'],['4102',78,'7R Beam 230W 16ch'],['3901',162,'200W Beam'],['4103',99,'7R Beam 230W 16ch'],['4101',57,'7R Beam 230W 16ch']].map(([id,address,label],i)=>({id,name:`${id} · ${label}`,colorSlots:structuredClone(id==='3901'?BEAM200_COLOR_PRESETS:BEAM7R_COLOR_PRESETS),profile:id==='3901'?'beam200':'beam7r',universe:3,address,enabled:true,verified:true,position:[-6+i*3,5,-3.5],calibration:{home:[.5,.53],panRange:[0,1],tiltRange:[0,1],invertPan:false,invertTilt:false,reviewed:false}}));
}
