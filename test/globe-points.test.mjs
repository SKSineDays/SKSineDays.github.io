import test from 'node:test';
import assert from 'node:assert/strict';
import { globePoints } from '../js/globe-points.js';
import { GLOBE_REGIONS } from '../shared/globe-regions.js';
test('anonymous point counts are bounded, deterministic and never exceed participating accounts', () => {
  assert.deepEqual(globePoints([]), []);
  assert.deepEqual(globePoints([{regionKey:'ZZ',count:1},{regionKey:'US',count:-1}]), []);
  const input = [{regionKey:'US',count:3}];
  assert.equal(globePoints(input).length, 3);
  assert.deepEqual(globePoints(input),globePoints(input));
  assert.equal(globePoints([...input,...input]).length,3);
  const dense = globePoints(GLOBE_REGIONS.map(region=>({regionKey:region.key,count:1000000})));
  assert.ok(dense.length < 4000);
  for (const p of dense) assert.ok(Math.abs(Math.hypot(...p.position)-1.006) < 1e-6);
});
