// Point-in-polygon hit testing for clicks/highlighting on country
// polygons. Shared by BattleGlobe + GlobeReplay so the host-country
// highlight identifies the same feature on both globes.
import type { Feature, Geometry, Position } from 'geojson';

// pointInPolygon runs the ray-cast algorithm against a single Polygon's
// coordinate rings ([outer, hole, hole, ...] in GeoJSON order). Returns
// true if (lat, lng) is inside the outer ring and not inside any hole.
export function pointInPolygon(lat: number, lng: number, coords: Position[][]): boolean {
  for (const ring of coords) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

// findCountry walks the supplied country features and returns the first
// whose geometry contains (lat, lng). Handles both Polygon and
// MultiPolygon geometries. O(features * vertices) — fine for the
// ~250-feature Natural Earth set.
export function findCountry(lat: number, lng: number, countries: Feature<Geometry>[]): Feature<Geometry> | null {
  for (const c of countries) {
    const geom = c.geometry;
    if (geom.type === 'Polygon') {
      if (pointInPolygon(lat, lng, geom.coordinates)) return c;
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        if (pointInPolygon(lat, lng, poly)) return c;
      }
    }
  }
  return null;
}

// arcDistance is a cheap surrogate for great-circle distance in degrees,
// using haversine on a unit sphere. Returns 0–180. Good enough to scale
// camera altitude on the war-playback flythrough without pulling in a
// real geo dependency.
export function arcDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dphi = toRad(b.lat - a.lat);
  const dlambda = toRad(b.lng - a.lng);
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return (c * 180) / Math.PI;
}
