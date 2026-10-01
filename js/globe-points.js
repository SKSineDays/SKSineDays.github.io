// Catalog anchors are public land positions, never member coordinates.
import { GLOBE_REGION_BY_KEY } from '../shared/globe-regions.js';
export function globePoints(groups) {
  const points = [];
  const seen = new Set();
  for (const group of groups || []) {
    const region = GLOBE_REGION_BY_KEY.get(group.regionKey);
    if (!region || seen.has(region.key) || !Number.isSafeInteger(group.count) || group.count < 1) continue;
    seen.add(region.key);
    const visibleCount = Math.min(group.count, region.anchors.length);
    for (let i = 0; i < visibleCount; i++) {
      const [latitude, longitude] = region.anchors[i];
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
