// Keys for masters and desk shortcuts in the engine's form (engine/spec.mjs KEY): 'a', ';', 'f5', 'shift+h'.
// Physical keys (event.code) so Shift+H is still H and the shortcut never depends on the keyboard layout's shifted symbol.
const PUNCT={Semicolon:';',Comma:',',Period:'.',Slash:'/',Quote:"'",Backquote:'`',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Minus:'-'};
// The desk keeps these: they are never a master key.
const RESERVED={Space:'Space is GO',Backspace:'Backspace is Back',Delete:'Delete clears the key',Escape:'Esc cancels',Enter:'Enter stays with the desk',NumpadEnter:'Enter stays with the desk',Tab:'Tab moves between controls',
 ArrowLeft:'The arrow keys page through the masters',ArrowRight:'The arrow keys page through the masters',ArrowUp:'The arrow keys stay with the desk',ArrowDown:'The arrow keys stay with the desk'};
export function keyOf(e){
 if(e.metaKey||e.ctrlKey||e.altKey)return null;const c=e.code??'';
 const k=/^Key[A-Z]$/.test(c)?c.slice(3).toLowerCase():/^Digit\d$/.test(c)?c.slice(5):/^F([1-9]|1[0-2])$/.test(c)?c.toLowerCase():PUNCT[c];
 return k?(e.shiftKey?'shift+':'')+k:null;
}
// Why a pressed key cannot be a master key, or null when it can.
export function reservedReason(e){
 if(e.metaKey||e.ctrlKey||e.altKey)return 'Keys with ⌘, Ctrl or Option stay with the app';
 if(RESERVED[e.code])return RESERVED[e.code];
 return keyOf(e)?null:'That key cannot be used for a master';
}
export const keyLabel=k=>!k?'':k.split('+').map(p=>p==='shift'?'⇧':p.length===1?p.toUpperCase():p.toUpperCase()).join('');
