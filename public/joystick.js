export function advancePosition(p,vector,seconds,speed,limits){
 const length=Math.hypot(vector.x,vector.y),factor=length>.08?Math.min(1,(length-.08)/.92)/length:0;
 const clamp=(v,r)=>Math.max(r[0],Math.min(r[1],v));
 return {pan:clamp(p.pan+vector.x*factor*speed*seconds,limits.panRange),tilt:clamp(p.tilt-vector.y*factor*speed*seconds,limits.tiltRange)};
}
export function mountJoystick(el,{getTargets,onMove,getSpeed}){
 const controller=new AbortController(),options={signal:controller.signal};let vector={x:0,y:0},targets=[],active=false,raf=0,last=0,elapsed=0,pointer=null;const keys=new Set();
 const knob=el.querySelector('.joystick-knob');
 const draw=()=>{knob.style.transform=`translate(calc(-50% + ${vector.x*78}px),calc(-50% + ${vector.y*78}px))`;el.classList.toggle('moving',active&&Math.hypot(vector.x,vector.y)>.08)};
 const stop=()=>{active=false;cancelAnimationFrame(raf);vector={x:0,y:0};keys.clear();pointer=null;draw()};
 const tick=now=>{if(!active)return;const dt=Math.min(.05,(now-last)/1000);last=now;elapsed+=dt;for(const t of targets)t.position=advancePosition(t.position,vector,dt,getSpeed(),t.calibration);if(elapsed>=.05){elapsed=0;for(const t of targets)if(t.position.pan!==t.sent.pan||t.position.tilt!==t.sent.tilt){onMove(t.id,t.position);t.sent={...t.position}}}raf=requestAnimationFrame(tick)};
 const start=()=>{if(active)return;targets=getTargets().map(t=>({...t,position:{...t.position},sent:{...t.position}}));active=true;last=performance.now();elapsed=0;raf=requestAnimationFrame(tick)};
 const point=e=>{const r=el.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/(r.width/2-18),y=(e.clientY-r.top-r.height/2)/(r.height/2-18),m=Math.max(1,Math.hypot(x,y));vector={x:x/m,y:y/m};draw()};
 el.addEventListener('pointerdown',e=>{if(!e.isPrimary||e.button!==0)return;e.preventDefault();el.focus();pointer=e.pointerId;el.setPointerCapture(pointer);start();point(e)},options);
 el.addEventListener('pointermove',e=>{if(active&&pointer===e.pointerId)point(e)},options);
 for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])el.addEventListener(event,stop,options);
 window.addEventListener('blur',stop,options);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()},options);
 const keyVector=()=>{vector={x:Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),y:Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'))};const m=Math.max(1,Math.hypot(vector.x,vector.y));vector.x/=m;vector.y/=m;draw()};
 el.addEventListener('keydown',e=>{if(e.key==='Escape'){stop();return}if(!e.key.startsWith('Arrow'))return;e.preventDefault();start();keys.add(e.key);keyVector()},options);
 el.addEventListener('keyup',e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();keys.delete(e.key);if(!keys.size)stop();else keyVector()},options);
 return ()=>{stop();controller.abort()};
}
