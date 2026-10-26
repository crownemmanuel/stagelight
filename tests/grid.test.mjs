import test from 'node:test';import assert from 'node:assert/strict';
import {defaults,gridFixtures,gridGroups} from '../engine/model.mjs';import {baseState,encode} from '../engine/render.mjs';import {validateShow} from '../engine/spec.mjs';
test('Grid matches photo patch and six counted rows without inventing missing addresses',()=>{
 const fixtures=gridFixtures();assert.equal(fixtures.length,23);assert.deepEqual(gridGroups().slice(1).map(g=>g.fixtures.length),[5,3,4,3,5,3]);
 assert.deepEqual(fixtures.slice(0,21).map(f=>[f.universe,f.address]),[[4,1],[4,6],[4,36],[4,11],[4,16],[4,21],[4,26],[4,31],[4,41],[4,46],[4,51],[5,56],[5,61],[5,66],[5,71],[5,76],[5,81],[5,86],[5,91],[5,96],[5,101]]);
 for(const f of fixtures.slice(21)){assert.equal(f.enabled,false);assert.equal(f.address,0);assert.equal(f.universe,0)}validateShow(defaults());
});
test('Q120 five-channel dimmer/RGB/warm white encoding stops before adjacent Rogue',()=>{
 const show=defaults(),frames=show.fixtures.map(baseState);Object.assign(frames.find(f=>f.id==='221'),{intensity:1,color:[0,.5,1],white:.25});
 const baseline=encode(show,show.fixtures.map(baseState)).get(4),packet=encode(show,frames).get(4);
 assert.deepEqual([...packet.subarray(100,105)],[255,0,128,255,64]);assert.deepEqual(packet.subarray(105),baseline.subarray(105));assert.deepEqual(packet.subarray(0,100),baseline.subarray(0,100));
});
