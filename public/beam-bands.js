// Paint each triangle one filter color, avoiding additive mixing into white.
// Cone axis is Y (angles in X/Z); floor circles use their local X/Y plane.
export function bandVertexColors(positions,bands,secondAxis=2){
 const colors=new Float32Array(positions.length);
 for(let i=0;i<positions.length;i+=9){const x=positions[i]+positions[i+3]+positions[i+6],z=positions[i+secondAxis]+positions[i+3+secondAxis]+positions[i+6+secondAxis],angle=(Math.atan2(z,x)+Math.PI*2)%(Math.PI*2),band=bands[Math.min(bands.length-1,Math.floor(angle/Math.PI/2*bands.length))];for(let vertex=0;vertex<3;vertex++)colors.set(band,i+vertex*3);}
 return colors;
}
