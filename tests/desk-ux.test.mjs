import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fmtSeconds,cueTime,isTyping,createMessageLog,entryByNumber,shortcutRows,presetLayer,argControls,argLabel} from '../public/desk-ux.js';
import {keyLabel} from '../public/keys.js';

test('Seconds read like an operator says them',()=>{
 assert.equal(fmtSeconds(9.5027),'9.5 s');assert.equal(fmtSeconds(27.9879),'28 s');assert.equal(fmtSeconds(0.25),'0.3 s');
 assert.equal(fmtSeconds(65.2),'1:05');assert.equal(fmtSeconds(119.7),'2:00');assert.equal(fmtSeconds(0),'0 s');
});
test('The GO bar shows elapsed and time left, and only elapsed for a loop',()=>{
 assert.equal(cueTime({elapsed:4.2,duration:9.5}),'0:04 · 0:05 left');
 assert.equal(cueTime({elapsed:70,duration:20,loop:true}),'1:10');
 assert.equal(cueTime(null),'');
});
test('Only text-like fields swallow desk shortcuts; sliders and checkboxes do not',()=>{
 for(const type of ['text','search','number'])assert.equal(isTyping({tagName:'INPUT',type}),true,type);
 for(const type of ['range','checkbox','color','radio','button'])assert.equal(isTyping({tagName:'INPUT',type}),false,type);
 assert.equal(isTyping({tagName:'TEXTAREA'}),true);assert.equal(isTyping({tagName:'SELECT'}),true);
 assert.equal(isTyping({tagName:'BUTTON'}),false);assert.equal(isTyping({tagName:'DIV',isContentEditable:true}),true);assert.equal(isTyping(null),false);
});
test('The message log keeps the newest first and folds quick repeats',()=>{
 let t=0;const log=createMessageLog(3,()=>t);
 log.push('A');t+=1000;log.push('B','error');t+=1000;log.push('B','error');
 assert.deepEqual(log.list().map(r=>[r.text,r.count]),[['B',2],['A',1]]);assert.equal(log.errors(),1);
 t+=20000;log.push('B','error');log.push('C');log.push('D');
 assert.equal(log.list().length,3,'capped at the limit');assert.equal(log.list()[0].text,'D');
});
test('Typing a cue number finds that row of the cue list',()=>{
 const page={cues:[{id:'a'},{id:'b'},{id:'c'}]};
 assert.equal(entryByNumber(page,'2').id,'b');assert.equal(entryByNumber(page,'4'),null);assert.equal(entryByNumber(page,'0'),null);assert.equal(entryByNumber(null,'1'),null);
});
test('The shortcut sheet lists desk keys, every keyed master and its Shift sound switch',()=>{
 const masters={desk:{clear:'c',highlight:'shift+h',blackout:'b',tap:'t'},slots:[{id:'m1',key:'a',cue:'x'},{id:'m2'},{id:'m3',key:'d',sound:{channel:1}}]};
 const rows=shortcutRows(masters,keyLabel,m=>m.cue?'Big look':'');
 const find=a=>rows.find(r=>r.action.startsWith(a));
 assert.deepEqual(find('Clear').keys,['C']);assert.deepEqual(find('Highlight').keys,['⇧H']);
 assert.deepEqual(find('Master 1').keys,['A']);assert.match(find('Master 1').action,/Big look/);
 assert.equal(rows.some(r=>r.action.startsWith('Master 2')),false,'a master without a key is not listed');
 assert.deepEqual(find('Master 3: sound').keys,['⇧D']);
});
test('A code preset chooses its own layer; others take their effect’s',()=>{
 const effects={code:{layer:'intensity'},chase:{layer:'intensity'},rainbow:{layer:'color'}};
 assert.equal(presetLayer({effect:'code',layer:'position'},effects),'position');
 assert.equal(presetLayer({effect:'code'},effects),'intensity');
 assert.equal(presetLayer({effect:'rainbow'},effects),'color');
});
test('Code effect args get the right control',()=>{
 const c=argControls({rate:.3,tail:8,tint:'#ff8800',even:true,steps:[1,2]});
 assert.deepEqual(c.map(x=>x.kind),['slider','number','color','check','fixed']);
 assert.equal(argLabel('tailLength'),'Tail length');assert.equal(argLabel('rate'),'Rate');
});
test('The desk wires the new helpers in',()=>{
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/from '\.\/desk-ux\.js/);assert.match(app,/isTyping\(document\.activeElement\)/,'shortcuts use isTyping');
 assert.match(app,/presetLayer\(p,schema\.effects\)/,'custom presets use p.layer ?? effect layer');
 assert.match(app,/addEventListener\('pointerup',releasePointerMasters/,'a pointer let-go anywhere releases its master');
 assert.match(app,/addEventListener\('close',\(\)=>\{deskLearning=null;if\(\$\('#dialog'\)\.contains\(document\.activeElement\)\)document\.activeElement\.blur\(\)/,'closing a dialog drops focus from fields inside it');
 assert.match(app,/if\(!\$\('#dialog'\)\.open\)\{deskLearning=null;if\(\$\('#dialog'\)\.contains\(document\.activeElement\)\)document\.activeElement\.blur\(\)\}/,'a key press drops focus left inside a closed dialog');
});
test('Armed output that cannot send says so and cannot be dismissed; output off is a dismissible hint',async()=>{
 const {outputBar}=await import('../public/desk-ux.js');
 const f=outputBar({armed:true,failing:true,recovering:true,lastError:'EHOSTUNREACH 10.0.0.1',sendErrors:12},true,true);
 assert.equal(f.show,true);assert.equal(f.failing,true);assert.equal(f.dismissible,false);assert.equal(f.pill,'LIVE · NOT SENDING');
 assert.match(f.detail,/EHOSTUNREACH 10\.0\.0\.1 · reopening the network socket · 12 failed sends/);
 assert.equal(outputBar({armed:true,failing:false},true,false).show,false,'healthy armed output shows no bar');
 assert.equal(outputBar({armed:false},true,false).show,true);assert.equal(outputBar({armed:false},true,true).show,false,'dismissed');
 assert.equal(outputBar({armed:false},false,false).show,false,'nothing lit');
});
test('The shortcut sheet lists Stop all only when set, both undos, and says when a master has no Shift sound switch',()=>{
 const masters={desk:{clear:'c',highlight:'shift+h',blackout:'b',tap:'t'},slots:[{id:'m6',key:'h',cue:'x',sound:{channel:23}}]};
 let rows=shortcutRows(masters,keyLabel);
 assert.equal(rows.some(r=>r.action.startsWith('Stop all')),false);
 assert.ok(rows.some(r=>r.keys[0]==='⌘Z')&&rows.some(r=>r.keys[0]==='⇧⌘Z'));
 assert.match(rows.find(r=>r.keys[0]==='⇧H'&&r.group==='Masters').action,/no sound switch from the keyboard \(⇧H is Highlight\)/);
 rows=shortcutRows({...masters,desk:{...masters.desk,stop:'x'}},keyLabel);
 assert.deepEqual(rows.find(r=>r.action.startsWith('Stop all')).keys,['X']);
});
test('Show undo labels read as words, and a second press reads as redo',async()=>{
 const {undoText}=await import('../public/desk-ux.js');
 assert.equal(undoText('cue.delete').menu,'Undo: delete cue');
 assert.deepEqual(undoText('undo of cue.delete'),{redo:true,words:'delete cue',menu:'Redo: delete cue'});
 assert.equal(undoText('undo of undo of cue.delete').menu,'Undo: delete cue','undo, redo, then undo again');
 assert.equal(undoText('Rename group').menu,'Undo: Rename group');assert.equal(undoText(null),null);
});
