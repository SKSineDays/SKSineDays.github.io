import test from 'node:test';
import assert from 'node:assert/strict';
import { globePoints } from '../js/globe-points.js';
import { GLOBE_REGIONS } from '../shared/globe-regions.js';
import { GLOBE_CITIES, GLOBE_CITY_BY_KEY } from '../shared/globe-cities.js';
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

test('city groups resolve a single bounded public light, including duplicates and mixed snapshots', () => {
  const city = {precision:'city',regionKey:'US',cityKey:'us-census-0566080',count:50};
  assert.deepEqual(globePoints([city]),[]); // Catalog failure omits optional cities safely.
  const points = globePoints([city,city,{regionKey:'US',count:2}],GLOBE_CITY_BY_KEY);
  assert.equal(points.length,3);
  assert.equal(points[0].size,Math.min(5.5,2.6+Math.log2(50)*.3));
  assert.ok(Math.abs(Math.hypot(...points[0].position)-1.006)<1e-6);
  assert.deepEqual(globePoints([{...city,regionKey:'CA'},{...city,cityKey:'fake'},{...city,precision:'region'}],GLOBE_CITY_BY_KEY),[]);
  assert.equal(new Set(GLOBE_CITIES.map(city=>city.key)).size,GLOBE_CITIES.length);
  assert.ok(GLOBE_CITIES.every(city=>GLOBE_REGIONS.some(region=>region.key===city.regionKey) && Math.abs(city.latitude)<=90 && Math.abs(city.longitude)<=180));
});
