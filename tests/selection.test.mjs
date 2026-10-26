import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../engine/engine.mjs';import {encode} from '../engine/render.mjs';
const make=()=>new Engine({clock:()=>1,output:{armed:false,send(){},status(){return {armed:false}}}});
test('Select all replaces a partial selection and exposes the same group to UI/MCP without changing DMX',async()=>{
 const e=make();await e.command('fixture.set',{ids:['401'],values:{intensity:.5,color:'#ff0000'}});const packets=encode(e.show,e.frames);const show=structuredClone(e.show);
 await e.command('selection.set',{ids:['401','705'],group:'all'});await e.command('selection.group',{group:'grid'});
 assert.deepEqual(e.runtime().selection.ids,e.show.groups.find(g=>g.id==='grid').fixtures);assert.equal(e.runtime().selection.group,'grid');assert.equal(e.runtime().selection.revision,2);assert.deepEqual(encode(e.show,e.frames),packets);assert.deepEqual(e.show,show);
 await e.command('selection.group',{group:'all'});assert.deepEqual(e.runtime().selection.ids,e.show.fixtures.filter(f=>f.enabled).map(f=>f.id));
 await e.command('selection.set',{ids:[],group:'grid'});assert.deepEqual(e.runtime().selection.ids,[]);
});
test('Invalid selection leaves existing selection intact',async()=>{
 const e=make();await e.command('selection.group',{group:'backlights'});const before=e.runtime().selection;await assert.rejects(e.command('selection.group',{group:'missing'}));await assert.rejects(e.command('selection.set',{ids:['missing']}));assert.deepEqual(e.runtime().selection,before);
});
