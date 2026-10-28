import {PROFILE_DEFS,fixtureIndex} from './model.mjs';
import {nearestWheel,fixtureWheel} from '../public/fixture-colors.js';
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
function hsv(h){return [0,4,2].map(n=>{const k=(n+h*6)%6;return 1-Math.max(0,Math.min(k,4-k,1))})}
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
export function baseState(f){return {id:f.id,intensity:0,color:[1,1,1],white:0,movementSpeed:1,pan:f.calibration.home[0],tilt:f.calibration.home[1],opticalMode:'beam',zoom:.5,gobo:0,goboShake:0,prism:0,prismRotation:0,frost:0,focus:.5}}
// Extent of a profile's enabled fixtures along an axis, once per show rather than once per fixture per tick.
const bounds=new WeakMap();
function spatialBounds(show,profile,axis){let m=bounds.get(show.fixtures);if(!m){m=new Map();bounds.set(show.fixtures,m)}const key=profile+axis;if(!m.has(key)){const c=show.fixtures.filter(x=>x.enabled&&x.profile===profile).map(x=>x.position[axis]);m.set(key,[Math.min(...c),Math.max(...c)])}return m.get(key)}
function effectPose(f,i,n,type,p,time,show,length=1,center=null){
 let a=rgb(p.color??'#6ddcff'),b=rgb(p.secondary??'#9955ee');
 const speed=p.speed??1,phase=(n>1?i/(n-1):0),q=time*speed,spread=p.spread??1;
 let intensity=1,color=a,pan=center?.pan??f.calibration.home[0],tilt=center?.tilt??f.calibration.home[1];
 const ph=phase*spread*Math.PI*2;
 switch(type){
 case 'strobe':{
  let position=phase;
  if(p.spatialAxis==='x'||p.spatialAxis==='z'){
   const axis=p.spatialAxis==='x'?0:2,[lo,hi]=spatialBounds(show,f.profile,axis);position=hi>lo?(f.position[axis]-lo)/(hi-lo):0;
  }
  const head=.5-.5*Math.cos(time*(p.travelSpeed??.15)*Math.PI*2);
  const seed=[...f.id].reduce((v,c)=>(v*31+c.charCodeAt(0))>>>0,17),offset=p.strobePattern==='wave'?position*spread:(seed*.61803398875)%1;
  const pulse=(time*(p.frequency??3)+offset)%1,band=Math.exp(-2*(((position-head)/(p.width??.3))**2));
  intensity=pulse<(p.duty??.4)?(.12+.88*band):0;color=mix(a,b,head);break;
 }
 case 'chase':{const head=(q*.23)%1,dist=(head-i/n+1)%1;intensity=Math.exp(-dist/(p.width??.2)*4);color=mix(a,b,clamp(dist*4));break}
 case 'wave':intensity=.12+.88*(.5+.5*Math.sin(q*2-ph));color=mix(a,b,.5+.5*Math.sin(q*.7-ph));break;
 case 'mirror':intensity=.06+.94*(.5+.5*Math.cos(Math.abs(phase-.5)*9-q*2.5))**3;color=mix(a,b,Math.abs(phase-.5)*2);break;
 case 'rainbow':color=hsv((phase-q*.1+100)%1);intensity=.15+.85*(.5+.5*Math.cos(q*3-ph))**2;break;
 case 'pulse':intensity=.05+.95*(.5+.5*Math.cos(q*Math.PI*1.4+i*Math.PI))**2;color=i%2?a:b;break;
 case 'sparkle':intensity=.08+.92*Math.max(0,Math.sin(q*1.7+i*12.9898)*Math.sin(q*.9+i*4.141))**4;break;
 case 'sweep':pan+=(p.panAmplitude??.03)*Math.sin(q*.9+(i%2?Math.PI:0));tilt+=(p.tiltAmplitude??.015)*Math.sin(q*.6+ph*.3);intensity=.35+.65*(.5+.5*Math.sin(q*1.2-ph));break;
 case 'orbit':pan+=(p.panAmplitude??.03)*Math.sin(q*.8+ph);tilt+=(p.tiltAmplitude??.015)*Math.cos(q*.8+ph);break;
 // Fade ramps across the whole track; its own envelope replaces the track fade.
 case 'fade':{const k=smooth(time/Math.max(.001,length));intensity=p.direction==='out'?1-k:k;break}
 case 'breathe':intensity=.08+.92*(.5+.5*Math.sin(q*1.6-ph*.25))**2;color=mix(a,b,.5+.5*Math.sin(q*.4));break;
 case 'figure8':pan+=(p.panAmplitude??.04)*Math.sin(q*.7+ph);tilt+=(p.tiltAmplitude??.02)*Math.sin(2*(q*.7+ph));break;
 case 'ballyhoo':pan+=(p.panAmplitude??.05)*Math.sin(q*.55+ph);tilt+=(p.tiltAmplitude??.05)*Math.sin(q*1.3+ph*1.7);break;
 }
 if(p.pointA){const pa=show.points.find(x=>x.id===p.pointA)?.positions?.[f.id],pb=show.points.find(x=>x.id===p.pointB)?.positions?.[f.id];if(pa){const w=pb?(1-Math.cos(q*.8))/2:0;pan=pa.pan*(1-w)+(pb?.pan??pa.pan)*w;tilt=pa.tilt*(1-w)+(pb?.tilt??pa.tilt)*w;}}
 if(type==='strobe'){
  const sign=i%2?-1:1;
  pan+=(p.panAmplitude??0)*Math.sin(q*.8)*sign*(f.calibration.alignment?.panSign??1);
  tilt+=(p.tiltAmplitude??0)*Math.sin(q*.6+ph)*(f.calibration.alignment?.tiltSign??1);
 }
 return {intensity:intensity*(p.brightness??.8),color,...(p.colorWheel===undefined?{}:{colorWheel:p.colorWheel}),...(p.colorWheel2===undefined?{}:{colorWheel2:p.colorWheel2}),white:p.white??0,movementSpeed:p.movementSpeed??1,pan:clamp(pan,...f.calibration.panRange),tilt:clamp(tilt,...f.calibration.tiltRange),opticalMode:p.opticalMode??'beam',zoom:p.zoom??.5,gobo:p.gobo??0,goboShake:p.goboShake??0,prism:p.prism??0,prismRotation:p.prismRotation??0,frost:p.frost??0,focus:p.focus??.5};
}
// compose = cue only; applyOverrides = programmer; finish = master, blackout, limits.
// Crossfades and override release blend between compose/applyOverrides results.
export const trackFixtures=(show,tr)=>tr.fixtures??show.groups.find(g=>g.id===tr.group)?.fixtures??[];
// Layered effects modify the state they land on: position circles the current aim, intensity scales
// the current level (or the effect level when dark), color recolors. Used by programmer effects and layer tracks.
export function layerEffect(st,f,i,n,type,p,t,show,layer,envelope=1,length=1e9){
 const out={...st},pose=effectPose(f,i,n,type,p,t,show,length,{pan:st.pan,tilt:st.tilt}),level=p.brightness??.8;
 if(layer==='position'){out.pan=st.pan+(pose.pan-st.pan)*envelope;out.tilt=st.tilt+(pose.tilt-st.tilt)*envelope}
 else if(layer==='intensity'){const shape=clamp(pose.intensity/Math.max(.001,level)),base=st.intensity>.001?st.intensity:level;out.intensity=base*(1-envelope+envelope*shape)}
 else if(layer==='color'){out.color=mix(st.color,pose.color,envelope);if(!(st.intensity>.001))out.intensity=level*envelope}
 else{Object.assign(out,pose);out.intensity*=envelope}
 return out;
}
// Order mirrors live playback: base look, full tracks, look entries marked over (recorded changes), layer tracks.
export function compose(show,cue,seconds){
 const states=Object.fromEntries(show.fixtures.map(f=>[f.id,baseState(f)]));
 const look=over=>{for(const entry of cue?.look??[]){if(!!entry.over!==over||!states[entry.id])continue;Object.assign(states[entry.id],entry.values);if(entry.values.color)states[entry.id].color=rgb(entry.values.color)}};
 const tracks=layered=>{if(cue)for(const tr of cue.tracks){if(!!tr.layer!==layered||seconds<tr.start||seconds>=tr.start+tr.duration)continue;
  const ids=trackFixtures(show,tr),t=seconds-tr.start,byId=fixtureIndex(show);
  const envelope=tr.effect==='fade'?1:smooth(t/Math.max(.001,tr.fadeIn??.5))*smooth((tr.duration-t)/Math.max(.001,tr.fadeOut??.5));
  ids.forEach((id,i)=>{const f=byId.get(id);if(!f||!states[id])return;
   if(layered)states[id]=layerEffect(states[id],f,i,ids.length,tr.effect,tr.params,t,show,tr.layer,envelope,tr.duration);
   else{Object.assign(states[id],effectPose(f,i,ids.length,tr.effect,tr.params,t,show,tr.duration));states[id].intensity*=envelope}});
 }};
 look(false);tracks(false);look(true);tracks(true);
 return Object.values(states);
}
export function applyOverrides(show,states,overrides={}){
 return states.map(s=>{const o=overrides[s.id];if(!o)return s;const base={...s};if(typeof o.color==='string'){delete base.colorWheel;delete base.colorWheel2}const st={...base,...o};if(typeof o.color==='string')st.color=rgb(o.color);return st});
}
export function finish(show,states,master=1,blackout=false){
 const byId=fixtureIndex(show);
 return states.map(s=>{const f=byId.get(s.id),st={...s};if(!f)return st;st.pan=clamp(st.pan,...f.calibration.panRange);st.tilt=clamp(st.tilt,...f.calibration.tiltRange);st.intensity=blackout||!f.enabled?0:clamp(st.intensity*master);return st});
}
export function render(show,cue,seconds,overrides={},master=1,blackout=false){return finish(show,applyOverrides(show,compose(show,cue,seconds),overrides),master,blackout)}
const CONTINUOUS=['intensity','white','pan','tilt','zoom','frost','focus','prismRotation','movementSpeed','goboShake'];
// Linear crossfade; discrete wheel attributes switch at the midpoint.
export function blendState(a,b,k){
 if(!a)return b;const st={...(k<.5?a:b)};
 for(const key of CONTINUOUS)if(typeof a[key]==='number'&&typeof b[key]==='number')st[key]=a[key]*(1-k)+b[key]*k;
 st.color=mix(a.color,b.color,k);return st;
}
export function blend(from,to,k){const byId=new Map(from.map(s=>[s.id,s]));return to.map(s=>blendState(byId.get(s.id),s,clamp(k)))}
// Rogue wheel centers from Chauvet's 16-channel chart. Pick the nearest solid color.
export function wheelColor(c){return nearestWheel('rogue',c).value}
export function encode(show,states,{physical=false}={}){
 const universes=new Map();const byte=v=>Math.round(clamp(v)*255),byId=new Map(states.map(s=>[s.id,s]));
 for(const f of show.fixtures){if(!f.enabled||!f.verified||!PROFILE_DEFS[f.profile]?.channels)continue;let st=byId.get(f.id);if(!st)continue;
  const u=show.settings.mappings[f.universe];if(u===undefined)continue;
  if(!universes.has(u))universes.set(u,Buffer.alloc(512));const d=universes.get(u),base=f.address-1;
  if(f.profile==='q120')d.set([byte(st.intensity),...st.color.map(byte),byte(st.white)],base);
  if(f.profile==='colorado')d.set([byte(st.intensity),...st.color.map(byte),byte(st.white),byte(st.zoom),0],base);
  // Rêve E-3 12ch: 16-bit dimmer, RGB from color, white drives amber + mint together; strobe, VCW, CCT, hue and gobo rotator held at 0.
  // Pendant 4ch has no dimmer channel: intensity scales R, G, B, W (assumed order, unverified).
  if(f.profile==='pendant4')d.set([...st.color.map(c=>byte(c*st.intensity)),byte(st.white*st.intensity)],base);
  if(f.profile==='reveE3'){const dim=Math.round(clamp(st.intensity)*65535),w=byte(st.white);d.set([dim>>8,dim&255,...st.color.map(byte),w,w,0,0,0,0,0],base)}
  if(f.profile==='mh7'){
   const fine=v=>Math.round(clamp(v)*65535),dim=fine(st.intensity),pan=fine(f.calibration.invertPan?1-st.pan:st.pan),tilt=fine(f.calibration.invertTilt?1-st.tilt:st.tilt),zoom=fine(st.zoom),focus=fine(st.focus);
   const color=nearestWheel('mh7',st.color).value;
   const prism=st.prism===1?1:st.prism>=2?2:0,rotation=st.prismRotation??0;
   const select=prism?(rotation?(prism===1?128:192):(prism===1?32:96)):0;
   const rotate=rotation>0?Math.round(93-clamp(rotation)*61):rotation<0?Math.round(128+clamp(-rotation)*61):0;
   const gobo=Math.min(12,Math.max(0,Math.round(st.gobo??0))),beam=st.opticalMode!=='spot';
   // Default MH7 open beam is physically confirmed on universe 6; shutter 255 matches the working Hog output (manual open range 224–255). Ch21 defaults neutral; explicit transient lamp commands are overlaid by Engine.
   d.set([dim>>8,dim&255,st.intensity>0?255:0,color,beam?0:16,0,0,gobo?(gobo===12?131:gobo*11):(beam?0:142),select,rotate,0,st.frost>=.5?255:0,zoom>>8,zoom&255,focus>>8,focus&255,pan>>8,pan&255,tilt>>8,tilt&255,0],base);
  }
  if(f.profile==='beam7r'){
   const wheel=fixtureWheel(f,st);
   const fine=v=>Math.round(clamp(v)*65535),pan=fine(f.calibration.invertPan?1-st.pan:st.pan),tilt=fine(f.calibration.invertTilt?1-st.tilt:st.tilt),rotation=st.prismRotation??0;
   const rotate=rotation>0?Math.round(190-clamp(rotation)*62):rotation<0?Math.round(193+clamp(-rotation)*62):191;
   const gobo=Math.min(14,Math.max(0,Math.round(st.gobo??0))),shake=clamp(st.goboShake??0),ranges=[[160,166],[167,172],[173,179],[180,185],[186,191],[192,198],[199,204],[205,211],[212,217],[218,223],[224,230],[231,236],[237,243],[244,249]];
   const range=ranges[gobo-1],goboValue=shake&&range?Math.round(range[0]+shake*(range[1]-range[0])):gobo*4;
   // Dimmer-curve neutral pending slot data; reset/lamp idle.
   d.set([wheel.value,st.intensity>0?255:0,byte(st.intensity),goboValue,st.prism?255:0,rotate,0,byte(st.frost),byte(st.focus),pan>>8,pan&255,tilt>>8,tilt&255,0,0,0],base);
  }
  if(f.profile==='beam200'){
   const wheel=fixtureWheel(f,st);
   const fine=v=>Math.round(clamp(v)*65535),pan=fine(f.calibration.invertPan?1-st.pan:st.pan),tilt=fine(f.calibration.invertTilt?1-st.tilt:st.tilt);
   const speed=clamp(st.movementSpeed??1),timing=speed===1?0:1+Math.round((1-speed)*254),rotation=st.prismRotation??0;
   const rotate=rotation>0?Math.round(191-clamp(rotation)*63):rotation<0?Math.round(192+clamp(-rotation)*63):64;
   const gobo=Math.min(17,Math.max(0,Math.round(st.gobo??0)));
   // Hog screenshots establish color channels 9/10; names are calibrated per fixture.
   // Lamp/reset ch16 stays neutral except explicit engine lamp pulses.
   d.set([pan>>8,tilt>>8,pan&255,tilt&255,timing,byte(st.frost),255,byte(st.intensity),wheel.value,wheel.secondary,gobo?4+7*gobo:0,byte(st.goboShake??0),byte(st.focus),st.prism?255:0,rotate,0],base);
  }
  if(f.profile==='rogue'){
   const pan=Math.round(clamp(f.calibration.invertPan?1-st.pan:st.pan)*65535),tilt=Math.round(clamp(f.calibration.invertTilt?1-st.tilt:st.tilt)*65535);
   const rotate=st.prismRotation===0?0:st.prismRotation>0?Math.round(189-clamp(st.prismRotation)*50):Math.round(194+clamp(-st.prismRotation)*50);
   d.set([pan>>8,pan&255,tilt>>8,tilt&255,byte(1-(st.movementSpeed??1)),byte(st.intensity),st.intensity>0?255:0,wheelColor(st.color),st.gobo===0?0:4+(st.gobo-1)*3,st.prism===1||st.prism===3?255:0,rotate,st.prism===2||st.prism===3?255:0,rotate,byte(st.frost),byte(st.focus),0],base);
  }
 }
 return universes;
}
export function artDmx(universe,data,sequence=0){const p=Buffer.alloc(18+data.length);p.write('Art-Net\0',0,'ascii');p.writeUInt16LE(0x5000,8);p.writeUInt16BE(14,10);p[12]=sequence;p.writeUInt16LE(universe,14);p.writeUInt16BE(data.length,16);data.copy(p,18);return p}
