import {bandVertexColors} from './beam-bands.js';
import {outputRGB,outputBands} from './fixture-colors.js';
import {aimAngles,aimDirection,isFloorMounted} from './aim.js?v=fixture-color-3';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export class Stage{
 constructor(container,fixtures,onSelect){
  this.container=container;this.fixtures=fixtures;this.nodes=new Map();this.targets=[];this.onSelect=onSelect;this.haze=.45;this.mode='front';this.selected=[];
  try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch(e){document.querySelector('#webglFallback').hidden=false;return}
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.7));this.renderer.setClearColor(0x132131,1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;container.prepend(this.renderer.domElement);
  this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0x132131,.017);
  this.camera=new THREE.PerspectiveCamera(43,1,.1,100);this.camera.position.set(0,7,21);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,2.6,0);this.controls.enableDamping=true;this.controls.dampingFactor=.09;this.controls.minDistance=7;this.controls.maxDistance=40;this.controls.maxPolarAngle=Math.PI*.49;
  this.scene.add(new THREE.HemisphereLight(0xb8d0ee,0x1b2434,.9));const key=new THREE.DirectionalLight(0xc9dcf9,.8);key.position.set(-5,15,10);this.scene.add(key);
  this.buildRoom();for(const f of fixtures)this.makeFixture(f);
  this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();let down;
  this.renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);this.renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hits=this.ray.intersectObjects(this.targets);if(hits.length)this.onSelect(hits[0].object.userData.id,{shiftKey:e.shiftKey})});
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.last=performance.now();this.animate();
 }
 material(color,roughness=.7){return new THREE.MeshStandardMaterial({color,roughness,metalness:.25})}
 box(w,h,d,x,y,z,color){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),this.material(color));m.position.set(x,y,z);this.scene.add(m);return m}
 buildRoom(){
  // Curved apron with two inset stair openings; stage top stays at Y=0
  // so saved fixture coordinates and beam calibration retain their reference.
  this.apronZ=x=>2.3+2.7*Math.sqrt(Math.max(0,1-(x/10)**2));
  const outline=new THREE.Shape();outline.moveTo(-10,-5);outline.lineTo(10,-5);outline.lineTo(10,this.apronZ(10));
  const xs=Array.from({length:161},(_,i)=>10-i/8).concat([6.1,3.9,-3.9,-6.1]).sort((a,b)=>b-a);
  for(const x of [...new Set(xs)]){
   const z=this.apronZ(x),inStair=Math.abs(x)>3.9&&Math.abs(x)<6.1;
   if(x===6.1||x===-3.9){outline.lineTo(x,z);outline.lineTo(x,3.1)}
   else if(x===3.9||x===-6.1){outline.lineTo(x,3.1);outline.lineTo(x,z)}
   else outline.lineTo(x,inStair?3.1:z);
  }
  outline.closePath();const slab=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:.75,bevelEnabled:false,steps:1}),[this.material(0x283039,.3),this.material(0x695b4c,.85)]);slab.rotation.x=Math.PI/2;this.scene.add(slab);
  this.box(34,.12,30,0,-.86,5,0x414449);
  for(const x of [-5,5])for(let i=0;i<4;i++){
   const top=-.15*(i+1),z=3.1+(i+.5)*.4;
   this.box(2.2,top+.8,.4,x,(-.8+top)/2,z,0x36393e);
   this.box(2.2,.025,.035,x,top+.013,z+.18,0x8b9298);
  }
  this.box(20,6,.2,0,3,-4.9,0x101b29);
  // Open side passage arches replace the enclosing side walls.
  for(const side of [-1,1]){
   const arch=new THREE.Shape();arch.moveTo(-1.7,-.75);arch.lineTo(-1.7,5.6);arch.lineTo(1.7,5.6);arch.lineTo(1.7,-.75);arch.lineTo(1.05,-.75);arch.lineTo(1.05,2.2);arch.quadraticCurveTo(1.05,3.35,0,3.35);arch.quadraticCurveTo(-1.05,3.35,-1.05,2.2);arch.lineTo(-1.05,-.75);arch.closePath();
   const surround=new THREE.Mesh(new THREE.ExtrudeGeometry(arch,{depth:.18,bevelEnabled:false}),this.material(0xa69c88));surround.position.set(side*11.4,0,-1.8);surround.rotation.y=-side*.32;this.scene.add(surround);
  }
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(14.2,3.6),new THREE.MeshBasicMaterial({color:0x243c58}));screen.position.set(0,2.75,-4.72);this.scene.add(screen);this.screen=screen;
  // LED wall media sits just in front of the screen; scale handles contain, texture repeat handles cover.
  this.ledPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,fog:false}));this.ledPlane.position.set(0,2.75,-4.71);this.ledPlane.visible=false;this.scene.add(this.ledPlane);this.ledPlaying=true;
  this.box(14.5,.14,.2,0,.9,-4.65,0x4e637a);this.box(14.5,.12,.2,0,4.6,-4.65,0x384d65);
  // Screen artwork: a restrained blue horizon, not a live video preview.
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d');const g=c.createLinearGradient(0,0,0,256);g.addColorStop(0,'#19334f');g.addColorStop(.75,'#41617b');g.addColorStop(1,'#557986');c.fillStyle=g;c.fillRect(0,0,1024,256);c.fillStyle='#bed5da';c.font='34px sans-serif';c.textAlign='center';c.fillText('SALVATION',512,134);c.font='12px sans-serif';c.fillStyle='#8baebf';c.fillText('STAGE STUDY',512,162);screen.material.map=new THREE.CanvasTexture(canvas);screen.material.map.colorSpace=THREE.SRGBColorSpace;screen.material.color.set(0xffffff);screen.material.toneMapped=false;this.screenArt=screen.material.map;
  for(const side of [-1,1]){
   const wing=this.box(3.4,2.5,.16,side*8.7,3.55,-3.3,0xb7b3a5);wing.rotation.y=-side*.30;
   const projection=this.box(3.12,2.1,.035,side*8.7,3.55,-3.19,0xd0d0c5);projection.rotation.y=-side*.30;
  }
  // Trusses: all dimensions and ID placement are estimates pending calibration.
  for(const x of [-9,-4.5,0,4.5,9]){this.box(.09,.09,8.3,x,6.4,.4,0x6b7c8d);this.box(.07,.07,8.3,x,6.65,.4,0x44576a)}
  for(const z of [-3.6,-2,-.4,1.2,2.8,4.4,0,2,8]){this.box(18,.09,.09,0,6.4,z,0x6b7c8d);this.box(18,.07,.07,0,6.65,z,0x44576a);for(let x=-9;x<9;x+=1.5){const strut=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,1.52,5),this.material(0x5c6f80));strut.position.set(x+.75,6.52,z);strut.rotation.z=Math.PI/2-.16;this.scene.add(strut)}}
  for(const x of [-8.2,8.2])this.box(.7,1.7,.7,x,4.8,1,0x111b29);
  this.box(1,.9,.7,0,.45,1,0x896c5a);this.box(1.5,.12,.9,0,.95,1,0xc7a78a);
  // Side instruments and floral clusters as simple positional landmarks.
  for(let i=0;i<4;i++){const drum=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,.35,16),this.material(0x776473));drum.rotation.x=Math.PI/2;drum.position.set(-7+i*.35,.8+(i%2)*.3,-.8);this.scene.add(drum)}
  this.box(1.6,.12,.6,7,1.1,-1,0x364557);
  for(const x of [-7.8,-2.2,2.2,7.8]){this.box(1.3,.25,.6,x,.12,this.apronZ(x)-.65,0x263c39);for(let j=0;j<5;j++){const bloom=new THREE.Mesh(new THREE.IcosahedronGeometry(.2,0),this.material(j%2?0x7b4b61:0x765239));bloom.position.set(x+(j-2)*.21,.35+(j%2)*.15,this.apronZ(x)-.65);this.scene.add(bloom)}}
  const chairMat=this.material(0x243749);for(let row=0;row<3;row++)for(let col=0;col<16;col++){if(col===7||col===8)continue;const seat=new THREE.Mesh(new THREE.BoxGeometry(.65,.55,.2),chairMat);seat.position.set((col-7.5)*.9,-.2,7+row*1.2);seat.rotation.x=-.15;this.scene.add(seat)}
  const grid=new THREE.GridHelper(20,20,0x405269,0x2b3b4b);grid.position.y=.005;grid.material.transparent=true;grid.material.opacity=.2;this.scene.add(grid);
 }
 label(text){const cv=document.createElement('canvas');cv.width=128;cv.height=48;const ctx=cv.getContext('2d');ctx.font='24px sans-serif';ctx.textAlign='center';ctx.fillStyle='#b1c4d5';ctx.fillText(text,64,32);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false,opacity:.7}));sprite.scale.set(.8,.3,1);return sprite}
 makeFixture(f){
  const root=new THREE.Group();root.position.fromArray(f.position);this.scene.add(root);
  const isGrid=f.profile==='q120'||f.id.startsWith('grid-pending-');
  const isMoving=['rogue','mh7','beam200','beam7r'].includes(f.profile)||(f.profile==='unknown'&&!isGrid);
  const bodyMaterial=this.material(isMoving?0xffb84a:f.enabled?0x31445b:0x263444);
  const headMaterial=this.material(isMoving?0xd99430:0x1e2e3e);
  if(isMoving){bodyMaterial.emissive.set(0x563000);headMaterial.emissive.set(0x402400)}
  const housing=new THREE.Mesh(isGrid?new THREE.BoxGeometry(.5,.08,.12):new THREE.BoxGeometry(.4,.28,.33),bodyMaterial);root.add(housing);housing.userData.id=f.id;this.targets.push(housing);
  const floor=isFloorMounted(f);housing.position.y=floor?-.56:0;
  const head=new THREE.Group();head.position.y=floor?-.33:-.23;root.add(head);const barrel=new THREE.Mesh(isGrid?new THREE.CylinderGeometry(.25,.25,.32,24):new THREE.CylinderGeometry(.13,.2,.36,16),headMaterial);head.add(barrel);barrel.userData.id=f.id;this.targets.push(barrel);
  const lens=new THREE.Mesh(isGrid?new THREE.CylinderGeometry(.22,.22,.025,24):new THREE.SphereGeometry(.11,12,8),new THREE.MeshBasicMaterial({color:0x597080,toneMapped:false}));lens.position.y=-.2;head.add(lens);
  // Real scene illumination makes dimmer changes visible on room surfaces too.
  // Shadows stay off so fourteen lights remain inexpensive on the Mac GPU.
  const light=f.enabled?new THREE.SpotLight(0xffffff,0,28,.3,.65,1):null;
  if(light){this.scene.add(light);this.scene.add(light.target)}
  const label=this.label(f.verified?f.id:f.profile==='unknown'&&!f.id.startsWith('grid-pending-')&&!f.id.startsWith('generic-')?f.id+'?':'?');label.position.set(0,floor?.18:.32,0);root.add(label);
  const beams=[];for(let k=0;k<5;k++){const geom=new THREE.ConeGeometry(1,1,24,1,true).toNonIndexed();geom.translate(0,-.5,0);const mat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,fog:false,toneMapped:false,blending:THREE.NormalBlending});const cone=new THREE.Mesh(geom,mat);this.scene.add(cone);beams.push(cone)}
  const spot=new THREE.Mesh(new THREE.CircleGeometry(1,48).toNonIndexed(),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,fog:false,toneMapped:false,blending:THREE.NormalBlending}));spot.rotation.x=-Math.PI/2;spot.position.y=.015;this.scene.add(spot);
  this.nodes.set(f.id,{f,isMoving,root,housing,head,lens,label,beams,spot,light,current:{intensity:0,color:[1,1,1],white:0,pan:f.calibration.home[0],tilt:f.calibration.home[1],zoom:.5,frost:0,prism:0}});
 }
 paintBands(mesh,bands,color,axis=2){
  const split=bands.length>1,key=split?JSON.stringify(bands):'solid';
  if(mesh.userData.bands!==key){mesh.userData.bands=key;if(split)mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(bandVertexColors(mesh.geometry.attributes.position.array,bands,axis),3));if(mesh.material.vertexColors!==split){mesh.material.vertexColors=split;mesh.material.needsUpdate=true}}
  mesh.material.color.copy(split?new THREE.Color(0xffffff):color);
 }
 setFixtures(fixtures){
 const keep=new Set(fixtures.map(f=>f.id));for(const [id,n] of this.nodes){if(keep.has(id))continue;for(const obj of [n.root,...n.beams,n.spot,n.light,n.light?.target].filter(Boolean)){this.scene.remove(obj);obj.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose()}})}this.nodes.delete(id)}this.targets=this.targets.filter(t=>keep.has(t.userData.id));
 this.fixtures=fixtures;for(const f of fixtures){const n=this.nodes.get(f.id);if(n){n.f=f;n.root.position.fromArray(f.position);const floor=isFloorMounted(f);n.housing.position.y=floor?-.56:0;n.head.position.y=floor?-.33:-.23;n.label.position.y=floor?.18:.32}else this.makeFixture(f)}}
 update(frames){this.frames=frames}
 select(ids){this.selected=ids;for(const [id,n] of this.nodes){n.label.material.opacity=ids.includes(id)?1:.5;n.root.children[0].material.emissive.set(ids.includes(id)?(n.isMoving?0x996022:0x20384d):(n.isMoving?0x563000:0x000000))}}
 // wall: show.ledWall; item: the media entry it names (or undefined for off).
 setLedWall(wall,item){
  if(!this.ledPlane)return;const plane=this.ledPlane,key=JSON.stringify([wall?.media,item?.src,wall?.fit]);
  plane.material.color.setScalar(wall?.brightness??.85);if(key===this.ledKey)return;this.ledKey=key;
  this.ledVideo?.pause();this.ledVideo?.removeAttribute('src');this.ledVideo=null;plane.material.map?.dispose();plane.material.map=null;plane.visible=false;
  if(!item||wall.media==='off'){this.screen.material.map=null;this.screen.material.color.set(0x070b10);this.screen.material.needsUpdate=true;return}
  this.screen.material.map=null;this.screen.material.color.set(0x000000);this.screen.material.needsUpdate=true;
  const place=(texture,w,h)=>{if(this.ledKey!==key){texture.dispose();return}texture.colorSpace=THREE.SRGBColorSpace;plane.material.map=texture;plane.material.needsUpdate=true;this.fitLed(texture,w,h,wall.fit);plane.visible=true};
  if(item.kind==='video'){const v=document.createElement('video');Object.assign(v,{muted:true,loop:true,playsInline:true,preload:'auto',src:item.src});this.ledVideo=v;v.addEventListener('loadedmetadata',()=>place(new THREE.VideoTexture(v),v.videoWidth,v.videoHeight),{once:true});if(this.ledPlaying)v.play().catch(()=>{});return}
  // Rasterize images (including SVG) through a canvas so every WebGL context accepts them.
  const img=new Image();img.onload=()=>{const w=img.naturalWidth||1600,h=img.naturalHeight||400,k=Math.min(1,4096/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);place(new THREE.CanvasTexture(c),w,h)};img.src=item.src;
 }
 fitLed(texture,w,h,fit='cover'){
  const W=14.2,H=3.6,ar=w/h,wall=W/H;this.ledPlane.scale.set(W,H,1);texture.repeat.set(1,1);texture.offset.set(0,0);
  if(fit==='contain'){if(ar>wall)this.ledPlane.scale.set(W,W/ar,1);else this.ledPlane.scale.set(H*ar,H,1)}
  else if(fit==='cover'){if(ar>wall){const r=wall/ar;texture.repeat.set(r,1);texture.offset.set((1-r)/2,0)}else{const r=ar/wall;texture.repeat.set(1,r);texture.offset.set(0,(1-r)/2)}}
 }
 // Video decoding is preview-only work; the UI pauses it while physical output is armed.
 setLedPlaying(on){this.ledPlaying=on;if(!this.ledVideo)return;if(on&&!this.paused)this.ledVideo.play().catch(()=>{});else this.ledVideo.pause()}
 setView(mode){this.mode=mode;document.querySelector('#stagePhoto').hidden=mode!=='reference';if(!this.camera)return;const poses={front:[0,7,21],orbit:[14,10,17],top:[0,24,.01]};if(poses[mode]){this.camera.position.set(...poses[mode]);this.controls.target.set(0,2.6,0);this.controls.update()}}
 resize(){if(!this.renderer)return;const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h)}
 // Paused = no animation frames at all (not just skipped draws), so a hidden visualizer costs nothing.
 setPaused(p){if(!this.renderer||this.paused===p)return;this.paused=p;
  if(this.ledVideo){if(p)this.ledVideo.pause();else if(this.ledPlaying)this.ledVideo.play().catch(()=>{})}
  if(p){cancelAnimationFrame(this.animation);this.animation=null}else{this.resize();this.last=performance.now();this.animate()}}
 animate(){if(this.paused){this.animation=null;return}this.animation=requestAnimationFrame(()=>this.animate());const now=performance.now(),dt=Math.min(.1,(now-this.last)/1000);this.last=now;const blend=1-Math.exp(-dt*14);
  for(const s of this.frames??[]){const n=this.nodes.get(s.id);if(!n)continue;const cur=n.current;for(const key of ['intensity','pan','tilt','zoom','frost','white'])cur[key]+=((s[key]??0)-cur[key])*blend;cur.color=outputRGB(n.f.profile,s.color,s.white??0,n.f,s); cur.prism=s.prism;cur.opticalMode=s.opticalMode;
   const bands=outputBands(n.f.profile,s.color,s.white??0,n.f,s).map(rgb=>new THREE.Color().setRGB(...rgb,THREE.SRGBColorSpace).toArray()),color=new THREE.Color().setRGB(...cur.color,THREE.SRGBColorSpace),intensity=this.alignmentPreview?.id===s.id?Math.max(.5,cur.intensity):(n.f.enabled?cur.intensity:0);const origin=n.root.position.clone();origin.y+=n.head.position.y;
   const angles=this.alignmentPreview?.id===s.id?this.alignmentPreview.virtual:aimAngles(n.f,cur.pan,cur.tilt);
   let direction=new THREE.Vector3(...aimDirection(...angles)).normalize();
   if(n.f.profile==='q120'||n.f.id.startsWith('grid-pending-'))direction=new THREE.Vector3(0,-1,0);
   if(n.f.profile==='colorado')direction=new THREE.Vector3(0,-.92,.4).normalize();
   n.head.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),direction);origin.addScaledVector(direction,.2);n.lens.material.color.copy(color).multiplyScalar(.015+intensity*.985);
   const length=direction.y<-.04?Math.min(25,origin.y/-direction.y):16;const radius=n.f.profile==='q120'?length*Math.tan(Math.PI/9):(n.f.profile==='colorado'?.65:.12)+cur.zoom*(n.f.profile==='colorado'?.8:n.f.profile==='mh7'?(cur.opticalMode==='beam'?.3:.55):0)+cur.frost*.9;
   const count=cur.prism?(n.f.profile==='beam200'?3:5):1;
   n.beams.forEach((beam,k)=>{beam.visible=k<count&&intensity>.001&&this.haze>.001;const angle=k*Math.PI*.5+now*.00008;const d=direction.clone();if(count>1&&k){d.x+=Math.sin(angle)*.11;d.z+=Math.cos(angle)*.11;d.normalize()}beam.position.copy(origin);beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),d);beam.scale.set(radius,length,radius);this.paintBands(beam,bands,color);beam.material.opacity=intensity*this.haze*(n.f.profile==='colorado'||n.f.profile==='q120'?.14:.24)/(count>1?1.5:1)});
   if(n.light){n.light.position.copy(origin);n.light.target.position.copy(origin).addScaledVector(direction,10);n.light.color.copy(color);n.light.intensity=intensity*(n.f.profile==='colorado'||n.f.profile==='q120'?5:4);n.light.angle=Math.atan(radius/Math.max(1,length));}
   const end=origin.clone().addScaledVector(direction,length);n.spot.position.set(end.x,.025,end.z);n.spot.scale.set(radius*1.5,radius*1.5,1);this.paintBands(n.spot,bands,color,1);n.spot.material.opacity=intensity*.3;n.spot.visible=direction.y<-.04&&Math.abs(end.x)<10&&end.z>-5&&end.z<this.apronZ(end.x)&&!(Math.abs(end.x)>3.9&&Math.abs(end.x)<6.1&&end.z>3.1);
  }
  this.controls.update();if(this.mode!=='reference'&&!document.hidden)this.renderer.render(this.scene,this.camera);
 }
}
