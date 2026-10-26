// Simplified gobo artwork traced from the manufacturers' wheel diagrams:
// Martin RUSH MH 7 Hybrid manual Rev A p.24 (static wheel, ch8) and
// Chauvet Rogue R3 Beam manual Rev 6 p.10. Slot numbers match the encoder.
// Icons are illustrative; exact projection depends on focus, zoom and rotation.
const dot=(x,y,r)=>`<circle cx="${x}" cy="${y}" r="${r}"/>`;
const ring=(n,r,size,offset=0)=>Array.from({length:n},(_,i)=>{const a=offset+i*Math.PI*2/n;return dot((12+r*Math.cos(a)).toFixed(2),(12+r*Math.sin(a)).toFixed(2),size)}).join('');
const disc=r=>dot(12,12,r);
const MH7=[
 ['Open',disc(9)],
 ['Iris 1',disc(7.5)],['Iris 2',disc(6)],['Iris 3',disc(3.8)],['Iris 4 · pinhole',disc(1.4)],
 ['Dot line A',[0,1,2,3].map(i=>dot(6+i*4,18-i*4,1.7)).join('')],
 ['Dot line B',[0,1,2,3].map(i=>dot(6+i*4,6+i*4,1.7)).join('')],
 ['Square grid',[0,1].flatMap(c=>[0,1,2].map(r=>`<rect x="${7.6+c*5}" y="${5+r*5}" width="3.8" height="3.8"/>`)).join('')],
 ['Striped disc','<clipPath id="g-mh7-8"><circle cx="12" cy="12" r="9"/></clipPath><g clip-path="url(#g-mh7-8)" transform="rotate(-35 12 12)"><rect x="0" y="0" width="24" height="7.6"/><rect x="0" y="9.6" width="24" height="4.8"/><rect x="0" y="16.4" width="24" height="8"/></g>'],
 ['Cross of wedges','<path d="M12 12L10.6 3h2.8zM12 12L10.6 21h2.8zM12 12L3 10.6v2.8zM12 12L21 10.6v2.8z"/>'],
 ['Broken square','<rect x="6.5" y="4" width="11" height="2.2"/><rect x="6.5" y="17.8" width="11" height="2.2"/><rect x="4" y="6.5" width="2.2" height="11"/><rect x="17.8" y="6.5" width="2.2" height="11"/>'],
 ['Dot cluster',dot(12,12,1)+dot(12,4.6,2.6)+dot(18.5,8.5,1.5)+dot(18,16,2.4)+dot(11.5,19.3,1.1)+dot(5.6,15.5,1.7)+dot(6,8,1.2)],
 ['Dot ring',ring(8,7,1.6)]
];
const tri=(x,y,s,a)=>{const p=[0,1,2].map(k=>{const t=a+k*Math.PI*2/3;return `${(x+s*Math.cos(t)).toFixed(2)},${(y+s*Math.sin(t)).toFixed(2)}`});return `<polygon points="${p.join(' ')}"/>`};
const ROGUE=[
 ['Open',disc(9)],
 ...[2.1,2.9,3.7,4.3,5.1,5.9].map((r,i)=>[`Aperture ${i+1}`,disc(r)]),
 ['Ring','<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'],
 ['Bar maze','<rect x="12" y="11" width="8" height="2.2"/><rect x="5" y="6" width="5" height="2.2"/><rect x="15.5" y="4" width="2.2" height="5"/><rect x="4" y="11" width="2.2" height="6"/><rect x="11" y="15" width="2.2" height="5.5"/>'],
 ['Mesh block','<g transform="rotate(45 12 12)"><rect x="6" y="6" width="12" height="12"/></g><g fill="#0b1520">'+[0,1,2].flatMap(c=>[0,1,2].map(r=>dot(9+c*3,9+r*3,.7))).join('')+'</g>'],
 ['Triangle',tri(12,13,8,-Math.PI/2)],
 ['Triangle scatter',[[6,7,1.5,.3],[11,5,1.3,1],[16.5,7,1.6,2],[19,12,1.3,.5],[15,11,1.5,2.6],[9,11,1.4,1.4],[5,13,1.3,.8],[12,15.5,1.6,.1],[17,16.5,1.4,1.9],[7.5,17.5,1.5,2.2],[12,20,1.2,.6]].map(([x,y,s,a])=>tri(x,y,s,a)).join('')],
 ['Starburst','<polygon points="12,2.5 14,8.5 20.5,7 16,12 21,17 14.5,15.8 12,21.5 9.8,15.5 3.5,17.5 8,12 3,7.5 9.8,8.8"/>'],
 ['Dot field',[[12,12],[8,9],[16,9],[8,15],[16,15],[12,6],[12,18],[4.8,12],[19.2,12],[6,5.5],[18,5.5],[6,18.5],[18,18.5],[12,2.8]].map(([x,y])=>dot(x,y,1.3)).join('')],
 ['Swirl',[0,1,2,3].map(k=>`<path transform="rotate(${k*90} 12 12)" d="M12 11c3-4 7-4 8.5-1.5-2-.5-4.5.3-6.8 2.6z"/>`).join('')],
 ['Mixed dots',dot(12,12,2.4)+[[7,8,1.3],[16.5,7,1.8],[18,13,1.1],[15,17.5,1.6],[9,17,1],[5.5,13,1.7],[11,5,1],[19.5,9,.8],[4.5,7,.8],[12,20,1],[7.5,20,.8],[20,17,.8],[16,3.8,.8]].map(([x,y,r])=>dot(x,y,r)).join('')],
 ['Broken triangle','<path d="M10.6 5.5L4.7 16.4M13.4 5.5l5.9 10.9M6.5 19h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="butt" fill="none"/>'],
 ['Bar','<rect x="3" y="9.6" width="18" height="4.8" rx="2.4"/>']
];
export const GOBOS={mh7:MH7,rogue:ROGUE};
// 7R and 200W wheels have no verified artwork yet: numbered plates, never invented patterns.
export function goboIcon(profile,slot){const g=GOBOS[profile]?.[slot],art=g?g[1]:slot===0?'<circle cx="12" cy="12" r="9"/>':`<text x="12" y="16" text-anchor="middle" font-size="11" font-weight="600">${slot}</text>`;return `<svg class="gobo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" class="gobo-plate"/><g class="gobo-light">${art}</g></svg>`}
export const goboName=(profile,slot)=>GOBOS[profile]?.[slot]?.[0]??`Gobo ${slot}`;
