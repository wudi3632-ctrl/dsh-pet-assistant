import test from 'node:test';
import assert from 'node:assert/strict';
import {stripWake} from '../public/core.mjs';
test('only remove wake homophone after independent KWS match',()=>{
  assert.equal(stripWake('打肥鱼今天心情很好','大肥鱼'),'今天心情很好');
  assert.equal(stripWake('打肥鱼今天心情很好'),'打肥鱼今天心情很好');
  assert.equal(stripWake('请写下打肥鱼','大肥鱼'),'请写下打肥鱼');
});
