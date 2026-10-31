// APC40 mkII pad colours, shared by the engine (pad LEDs) and the desk (master colours), so a master on screen shows
// the colour its pad shows (docs/MIDI-AND-SOUND.md).
// RGB LED palette: velocity → colour (Akai protocol v1.2, pages 18-22).
export const PALETTE=['#000000','#1E1E1E','#7F7F7F','#FFFFFF','#FF4C4C','#FF0000','#590000','#190000','#FFBD6C','#FF5400','#591D00','#271B00','#FFFF4C','#FFFF00','#595900','#191900','#88FF4C','#54FF00','#1D5900','#142B00','#4CFF4C','#00FF00','#005900','#001900','#4CFF5E','#00FF19','#00590D','#001902','#4CFF88','#00FF55','#00591D','#001F12','#4CFFB7','#00FF99','#005935','#001912','#4CC3FF','#00A9FF','#004152','#001019','#4C88FF','#0055FF','#001D59','#000819','#4C4CFF','#0000FF','#000059','#000019','#874CFF','#5400FF','#190064','#0F0030','#FF4CFF','#FF00FF','#590059','#190019','#FF4C87','#FF0054','#59001D','#220013','#FF1500','#993500','#795100','#436400','#033900','#005735','#00547F','#0000FF','#00454F','#2500CC','#7F7F7F','#202020','#FF0000','#BDFF2D','#AFED06','#64FF09','#108B00','#00FF87','#00A9FF','#002AFF','#3F00FF','#7A00FF','#B21A7D','#402100','#FF4A00','#88E106','#72FF15','#00FF00','#3BFF26','#59FF71','#38FFCC','#5B8AFF','#3151C6','#877FE9','#D31DFF','#FF005D','#FF7F00','#B9B000','#90FF00','#835D07','#392B00','#144C10','#0D5038','#15152A','#16205A','#693C1C','#A8000A','#DE513D','#D86A1C','#FFE126','#9EE12F','#67B50F','#1E1E30','#DCFF6B','#80FFBD','#9A99FF','#8E66FF','#404040','#757575','#E0FFFF','#A00000','#350000','#1AD000','#074200','#B9B000','#3F3100','#B35F00','#4B1502'];
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
// Nearest palette colour to hex, scaled by brightness (1 = full, ~.25 = dim). Black is never chosen for a lit pad.
export function nearestColor(hex,brightness=1){
 const [r,g,b]=rgb(hex).map(v=>v*brightness);let best=3,score=Infinity;
 PALETTE.forEach((p,i)=>{if(i===0)return;const [pr,pg,pb]=rgb(p),d=(pr-r)**2*.3+(pg-g)**2*.59+(pb-b)**2*.11;if(d<score){score=d;best=i}});return best;
}

// The dim (idle) version of a colour. Akai's palette runs in fours from 4 to 63 (light, full, dark, darker), so a colour
// in that range dims to its own dark entry; scaling the RGB instead lands on grey or another hue (cyan dims to #404040).
export function dimColor(hex){const f=nearestColor(hex);return f>=4&&f<64?f-f%4+2:nearestColor(hex,.28)}
// A master's colour: the one chosen for it, else an automatic colour by position, so every master in a fader bank of
// eight looks different on the pads and the desk (1 red, 2 orange … 8 magenta, again for 9-16). All are exact pad colours.
export const AUTO_COLORS=[5,9,13,21,37,45,49,53].map(i=>PALETTE[i].toLowerCase());
export function masterColor(show,slot){if(slot.color)return slot.color;const i=show.masters.slots.findIndex(s=>s.id===slot.id);return AUTO_COLORS[Math.max(0,i)%8]}
// What a pad lit at full actually shows for that colour.
export const padColor=hex=>PALETTE[nearestColor(hex)];
// Full-brightness palette entries offered as master colours: each is shown exactly by the pads.
export const SWATCHES=[5,9,13,17,21,33,37,41,45,49,53,57,8,3].map(i=>PALETTE[i]);
