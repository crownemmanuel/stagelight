import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uid} from '../public/ids.js';
test('play request IDs work in WebViews without randomUUID',()=>{
 const cryptoApi={getRandomValues:array=>{array.set([1,2,3,4]);return array}};
 assert.equal(uid('ui',cryptoApi),'ui-00000001000000020000000300000004');
 assert.notEqual(uid('ui',null),uid('ui',null));
 assert.match(uid('ui'),/^ui-/);
});
