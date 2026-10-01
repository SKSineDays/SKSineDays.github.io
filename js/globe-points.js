// Catalog anchors are public land positions, never member coordinates.
import { GLOBE_REGION_BY_KEY } from '../shared/globe-regions.js';
export function globePoints(groups, cities = new Map()) {
  const points = [];
  const seen = new Set();
  for (const group of groups || []) {
    const region = GLOBE_REGION_BY_KEY.get(group.regionKey);
    if (!region || !Number.isSafeInteger(group.count) || group.count < 1) continue;
    const city = group.cityKey ? cities.get(group.cityKey) : null;
    if (group.cityKey && (!city || city.regionKey !== region.key)) continue;
    if (group.precision && group.precision !== (city ? 'city' : 'region')) continue;
    const key = city ? `city:${city.key}` : `region:${region.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const anchors = city ? [[city.latitude, city.longitude]] : region.anchors;
    const visibleCount = Math.min(group.count, anchors.length);
    for (let i = 0; i < visibleCount; i++) {
      const [latitude, longitude] = anchors[i];
      const lat = latitude * Math.PI / 180;
      const lon = longitude * Math.PI / 180;
      points.push({
        position: [1.006 * Math.cos(lat) * Math.cos(lon), 1.006 * Math.sin(lat), -1.006 * Math.cos(lat) * Math.sin(lon)],
        size: Math.min(5.5, 2.6 + Math.log2(Math.max(1, group.count / visibleCount)) * .3)
      });
    }
  }
  return points;
}
