// Stage coordinates: +X right, +Y up, -Z toward the rear wall.
// Alignment changes visualization only; the DMX encoder never consumes it.
// Low-mounted MH7s stand on their bases; elevated fixtures hang from truss.
// Derived from the saved, MCP-accessible fixture placement. Explicit alignment wins.
export const isFloorMounted=f=>f.profile==='mh7'&&f.position?.[1]<2;
export const panTravel=f=>f.profile==='beam200'?450:540;
export function aimAngles(f, pan, tilt) {
 const a=f.calibration.alignment;
 const tiltTravel=f.profile==='mh7'?250:270;
 const yaw=(pan-.5)*panTravel(f), pitch=(tilt-.5)*tiltTravel;
 if(!a)return isFloorMounted(f)?[-yaw,180-pitch]:[yaw,pitch];
 return [a.virtual[0]+(pan-a.actual[0])*panTravel(f)*a.panSign,
         a.virtual[1]+(tilt-a.actual[1])*tiltTravel*a.tiltSign];
}
export function aimDirection(yaw,tilt){
 const y=yaw*Math.PI/180,t=tilt*Math.PI/180;
 return [Math.sin(y)*Math.sin(t),-Math.cos(t),Math.cos(y)*Math.sin(t)];
}
