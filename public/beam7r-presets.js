// Operator-observed wheel for the 4101–4104 7R group. DMX 35 was corrected
// during dictation from blue/purple to blue/green. RGBs are illustrative.
export const BEAM7R_COLOR_PRESETS=[
 ['White',0,'#ffffff'],['Red',11,'#ff0000'],['Red + yellow',17,'#ff7800'],['Yellow · 24',24,'#ffff00'],['Blue',31,'#0040ff'],['Blue + green',35,'#20a0b0'],['Green',41,'#00ff40'],['Green + purple',49,'#a070ac'],['Pinkish purple',55,'#ed60c4'],['Gold / deep orange',60,'#e87800'],['Deep orange + very light blue',67,'#c0aaa0'],['Very light blue / almost white',72,'#e4f7ff'],['Light blue + amber yellow',78,'#b8d4ad'],['Yellow · 82',82,'#ffe040'],['Yellow + deep purple',85,'#a284a8'],['Deep purple',91,'#6600bb'],['Deep purple + yellowish green',97,'#a6a170'],['Yellowish green',101,'#caff30'],['Yellowish green + pink',109,'#dac78d'],['Pink',113,'#ff80bd']
].map(([name,value,color])=>({name,value,color}));
export const BEAM7R_COLOR_BANDS={
 17:['#ff0000','#ffff00'],35:['#0040ff','#00ff40'],49:['#00ff40','#6600bb'],67:['#e87800','#e4f7ff'],78:['#70cfff','#ffe040'],85:['#ffe040','#6600bb'],97:['#6600bb','#caff30'],109:['#caff30','#ff80bd']
};
