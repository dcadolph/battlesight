// Centroid helpers for placing labels/markers on country polygons.
// Two flavours:
//   - largestPolygonCentroid: vertex-average of the LARGEST ring (by
//     perimeter) inside a MultiPolygon. Anchors faction labels on the
//     country's mainland, not the average of every island + colony.
//   - polygonCentroid: vertex-average of EVERY coordinate. Coarser but
//     fine for transient pulse-ring placement.
import type { Feature, Geometry, Position } from 'geojson';

// largestPolygonCentroid returns the [lat, lng] vertex-average of the
// LARGEST ring inside a MultiPolygon feature (by perimeter, a fast proxy
// for area). Used to anchor faction labels on the country's mainland.
export function largestPolygonCentroid(feat: Feature<Geometry>): [number, number] | null {
  const g = feat.geometry as Geometry;
  const ringSize = (ring: Position[]): number => {
    let sum = 0;
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i][0] - ring[i - 1][0];
      const dy = ring[i][1] - ring[i - 1][1];
      sum += Math.hypot(dx, dy);
    }
    return sum;
  };
  const ringCentroid = (ring: Position[]): [number, number] => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const [lng, lat] of ring) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        sx += lng;
        sy += lat;
        n++;
      }
    }
    return n > 0 ? [sy / n, sx / n] : [NaN, NaN];
  };
  if (g.type === 'Polygon') {
    return ringCentroid(g.coordinates[0] as Position[]);
  }
  if (g.type === 'MultiPolygon') {
    let bestRing: Position[] | null = null;
    let bestSize = -1;
    for (const poly of g.coordinates) {
      const outer = poly[0] as Position[];
      const sz = ringSize(outer);
      if (sz > bestSize) {
        bestSize = sz;
        bestRing = outer;
      }
    }
    if (!bestRing) return null;
    return ringCentroid(bestRing);
  }
  return null;
}

// polygonCentroid averages every coordinate of a polygon or multipolygon
// geometry to produce a rough centroid. Good enough for transient
// territory-flip pulse animations. Not cartographically accurate. Returns
// [lat, lng] or null when the geometry has no usable coordinates.
export function polygonCentroid(geom: Geometry): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (rings: Position[][]) => {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          sx += lng;
          sy += lat;
          n++;
        }
      }
    }
  };
  if (geom.type === 'Polygon') {
    walk(geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) walk(poly);
  } else {
    return null;
  }
  if (n === 0) return null;
  return [sy / n, sx / n];
}
