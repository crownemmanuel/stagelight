// Look Link colour science (protocol stagelight.look/1, docs/LOOK-LINK.md): what a set of fixtures looks like,
// from what each one is told to output and can actually make (wheel slots, calibrated wheel colours). Nominal, not metered.
import {outputRGB,colorKnown} from '../public/fixture-colors.js';
import {fixtureIndex} from './model.mjs';
export const LOOK_PROTOCOL='stagelight.look/1';
export const ZONE_ROLES=['face','front','back','top','side','effect','audience','other'];
// A camera should balance to light that is near the Planckian locus and in this range; anything else is a coloured look.
export const WHITE={duv:.015,min:2000,max:10000};
const lin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const hex=c=>'#'+c.map(v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
/** CIE 1931 xy of display-referred sRGB (0..1), or null for black. */
export function chromaticity(rgb){const [R,G,B]=rgb.map(lin),X=.4124*R+.3576*G+.1805*B,Y=.2126*R+.7152*G+.0722*B,Z=.0193*R+.1192*G+.9505*B,sum=X+Y+Z;return sum>0?{x:X/sum,y:Y/sum}:null}
/** Correlated colour temperature (McCamy), clamped to 1000–20000 K. */
export const mccamy=({x,y})=>{const n=(x-.332)/(.1858-y);return Math.round(clamp(449*n**3+3525*n**2+6823.3*n+5520.33,1000,20000))};
// Planckian locus in CIE 1960 uv (Krystek 1985; good to ~1e-4 for 1000–15000 K, smooth beyond).
const planck=T=>({u:(.860117757+1.54118254e-4*T+1.28641212e-7*T*T)/(1+8.42420235e-4*T+7.08145163e-7*T*T),v:(.317398726+4.22806245e-5*T+4.20481691e-8*T*T)/(1-2.89741816e-5*T+1.61456053e-7*T*T)});
export const uv=({x,y})=>{const d=-2*x+12*y+3;return {u:4*x/d,v:6*y/d}};
/** Duv: signed distance in CIE 1960 uv to the nearest point of the Planckian locus (1000–20000 K). Positive = above the locus (greenish), negative = below (magenta/pink). */
export function duv(xy){
 const p=uv(xy),dist=m=>{const q=planck(1e6/m);return Math.hypot(p.u-q.u,p.v-q.v)};
 let best=50;for(let m=50;m<=1000;m+=5)if(dist(m)<dist(best))best=m;
 let lo=Math.max(50,best-5),hi=Math.min(1000,best+5);for(let i=0;i<40;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(dist(a)<dist(b))hi=b;else lo=a}
 const m=(lo+hi)/2,q=planck(1e6/m);return Math.sign(p.v-q.v||1)*dist(m);
}
export const isWhite=(lit,kelvin,d)=>lit>0&&kelvin!==null&&Math.abs(d)<=WHITE.duv&&kelvin>=WHITE.min&&kelvin<=WHITE.max;
const r=(v,n)=>+v.toFixed(n);
/** Colour figures for one colour: kelvin, mired, duv, cie, saturation. All null (saturation 0) for black. */
export function colorFigures(rgb){
 const xy=chromaticity(rgb),max=Math.max(...rgb),min=Math.min(...rgb),saturation=max?r((max-min)/max,3):0;
 if(!xy)return {kelvin:null,mired:null,duv:null,cie:null,saturation};
 const kelvin=mccamy(xy);return {kelvin,mired:Math.round(1e6/kelvin),duv:r(duv(xy),4),cie:{x:r(xy.x,4),y:r(xy.y,4)},saturation};
}
/**
 * What a set of fixtures looks like in finished states (master and blackout applied). Enabled fixtures only; lit = above 2%.
 * Legacy shape (0.3.0 look summary and groups): level, lit, fixtures, color, kelvin, saturation; null with no enabled fixture.
 * chroma adds the v1 zone measures (peak, mired, duv, cie, white, colorUnknown); members adds per-fixture detail.
 */
export function measure(show,states,ids,{chroma=false,members=false}={}){
 const byId=new Map(states.map(s=>[s.id,s])),fixtures=fixtureIndex(show),list=[],rgb=[0,0,0];let w=0,n=0,level=0,peak=0,lit=0,unknown=0;
 for(const id of ids){const f=fixtures.get(id),s=byId.get(id);if(!f?.enabled||!s)continue;n++;level+=s.intensity;peak=Math.max(peak,s.intensity);
  const c=outputRGB(f.profile,s.color,s.white??0,f,s),known=colorKnown(f.profile,s.color,f,s);
  if(members){const fig=colorFigures(c);list.push({id,name:f.name,profile:f.profile,level:r(s.intensity,3),color:hex(c),kelvin:fig.kelvin,duv:fig.duv,known})}
  if(s.intensity<.02)continue;lit++;if(!known)unknown++;for(let i=0;i<3;i++)rgb[i]+=c[i]*s.intensity;w+=s.intensity}
 if(!n&&!chroma)return null;
 const col=w?rgb.map(v=>v/w):[0,0,0],fig=w?colorFigures(col):colorFigures([0,0,0]);
 const base={level:n?r(level/n,3):0,lit,fixtures:n,color:hex(col),kelvin:fig.kelvin,saturation:fig.saturation};
 if(!chroma)return base;
 return {...base,peak:r(peak,3),mired:fig.mired,duv:fig.duv,cie:fig.cie,white:isWhite(lit,fig.kelvin,fig.duv),colorUnknown:unknown,...(members?{members:list}:{})};
}
// Change-mode thresholds (§6) and the smaller "anything moved" step used to detect when changes have stopped.
// Kelvin only counts while a zone is white light (or turns white/coloured): McCamy CCT of a saturated colour jumps by
// hundreds of K for tiny shifts, so a colour effect would otherwise send at the rate limit all the time.
export const CHANGE={kelvin:100,duv:.002,level:.05},STILL={kelvin:20,duv:.0005,level:.005};
/** Comparable figures of a look: one row per zone, or the overall figures when no zones are sent. */
export const lookSnap=look=>(look.zones?.length?look.zones:[look.overall??look]).map(z=>({lit:z.lit,level:z.level,kelvin:z.kelvin,duv:z.duv??0,white:z.white??true}));
export function lookDiffers(a,b,lim){
 if(!a||!b||a.length!==b.length)return true;
 return a.some((x,i)=>{const y=b[i];if((x.lit>0)!==(y.lit>0)||x.white!==y.white||Math.abs(x.level-y.level)>=lim.level)return true;if(lim===STILL&&x.lit!==y.lit)return true;
  return x.kelvin!==null&&y.kelvin!==null&&((x.white&&Math.abs(x.kelvin-y.kelvin)>=lim.kelvin)||Math.abs(x.duv-y.duv)>=lim.duv)});
}
