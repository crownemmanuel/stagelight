// Operator-observed 3901 color wheel, 2026-10-25. RGB swatches are illustrative;
// split-filter positions retain their names and exact DMX values. "09" after
// 106 was interpreted as 109 from the ascending spoken sequence.
export const BEAM200_COLOR_PRESETS=[
 ['White',0,'#ffffff'],['Red',8,'#ff0000'],['Red + yellow',13,'#ff7000'],['Yellow',16,'#ffff00'],['Yellow + red',20,'#ffaa00'],['Pink',24,'#ff65ad'],['Pink + purple · 30',30,'#dc50e8'],['Purple',34,'#9900ff'],['Green',41,'#00ff40'],['Green + red · 46',46,'#b29c20'],['Orange',50,'#ff8000'],['Orange + blue',54,'#b080a0'],['Light blue',58,'#70cfff'],['Pink + purple · 69',69,'#b850e8'],['Light orange',73,'#ffc080'],['Orange + green',78,'#b6bc30'],['Green + red · 84',84,'#9cb830'],['Whitish light blue',89,'#dcefff'],['Blue + light blue + red',95,'#a080cf'],['Pale yellow / amber',99,'#fff0ae'],['Amber + blue',101,'#b8b1b0'],['Deep blue',106,'#1035ff'],['Deep blue + amber',109,'#645fa0'],['Whitish amber',112,'#fff2d7']
].map(([name,value,color])=>({name,value,color,secondary:0}));

// Distinct filter portions for the operator's split-color positions.
export const BEAM200_COLOR_BANDS={
 13:['#ff0000','#ffff00'],20:['#ffff00','#ff0000'],30:['#ff65ad','#9900ff'],46:['#00ff40','#ff0000'],54:['#ff8000','#1035ff'],69:['#ff65ad','#9900ff'],78:['#ff8000','#00ff40'],84:['#00ff40','#ff0000'],95:['#1035ff','#70cfff','#ff0000'],101:['#fff0ae','#1035ff'],109:['#1035ff','#fff0ae']
};
