import test from 'node:test';import assert from 'node:assert/strict';import {defaults} from '../engine/model.mjs';import {render,encode} from '../engine/render.mjs';import {validateShow,COMMANDS} from '../engine/spec.mjs';
test('Scatter flashes are deterministic and staggered while fan motion stays around saved poses',()=>{
 const s=defaults();s.settings.mappings[6]=5;const ids=s.groups.find(g=>g.id==='rogues').fixtures;s.points.push({id:'dance-center',name:'Center',positions:Object.fromEntries(ids.map(id=>[id,{pan:.55,tilt:.6}]))});
 const cue={id:'dance',name:'Dance',duration:10,loop:true,tracks:[{group:'rogues',effect:'strobe',start:0,duration:10,params:{pointA:'dance-center',frequency:3,duty:.4,travelSpeed:.2,panAmplitude:.03,tiltAmplitude:.02,brightness:1},fadeIn:0,fadeOut:0}]};s.cues.push(cue);validateShow(s);
 let staggered=false,lit=false,dark=false,opposed=false;
 for(let i=1;i<299;i++){const states=render(s,cue,i/30);assert.deepEqual(states,render(s,cue,i/30));const movers=states.filter(f=>ids.includes(f.id));if(movers.some(f=>f.intensity===0)&&movers.some(f=>f.intensity>0))staggered=true;lit||=movers[0].intensity>0;dark||=movers[0].intensity===0;opposed||=(movers[0].pan-.55)*(movers[1].pan-.55)<0;
 for(const f of movers){assert.ok(Math.abs(f.pan-.55)<=.03000001);assert.ok(Math.abs(f.tilt-.6)<=.02000001)}const packet=encode(s,states).get(3);for(const f of s.fixtures.filter(f=>f.profile==='rogue'&&f.universe===4))assert.equal(packet[f.address+14],0);
 }assert.ok(staggered&&lit&&dark&&opposed);
 assert.ok(COMMANDS['cue.save'].schema.properties.cue.properties.tracks.items.properties.params.properties.frequency);
});
