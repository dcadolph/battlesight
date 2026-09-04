// Schematic coordinates derived from geography.
//
// A replay carries two coordinate systems: geographic lat/lng for the
// surface map, and 0-100 schematic x/y for the tactical view. Authoring
// a battle from real coordinates leaves x/y at the 50/50 placeholder,
// and TacticalMap drops any entity still sitting on that placeholder,
// so a replay authored purely from geography renders an empty schematic.
// Cannae, the flagship reconstruction, was one of them.
//
// Rather than hand-place hundreds of units, project the geography into
// schematic space: fit every point in the replay to the frame, keeping
// the real shape of the deployment. The projection is uniform, so a line
// that bows in the world still bows on the schematic.
import type { Replay } from '../types/replay';

// fill is the fraction of the frame the deployment occupies, leaving a
// margin so labels and arrowheads at the edge are not clipped.
const fill = 0.84;

// point is one geographic position that needs a schematic counterpart.
type point = { lat: number; lng: number };

// geoPoints returns every geographic position in the replay.
function geoPoints(replay: Replay): point[] {
  const out: point[] = [];
  for (const phase of replay.phases ?? []) {
    for (const u of phase.units ?? []) {
      if (typeof u.lat === 'number' && typeof u.lng === 'number') out.push({ lat: u.lat, lng: u.lng });
    }
    for (const m of phase.movements ?? []) {
      if (typeof m.fromLat === 'number' && typeof m.fromLng === 'number') {
        out.push({ lat: m.fromLat, lng: m.fromLng });
      }
      if (typeof m.toLat === 'number' && typeof m.toLng === 'number') {
        out.push({ lat: m.toLat, lng: m.toLng });
      }
    }
  }
  return out;
}

// isPlaceheld reports whether every entity in the replay is still on the
// 50/50 placeholder. A replay with any hand-placed schematic position is
// left alone, because that placement is authored intent.
function isPlaceheld(replay: Replay): boolean {
  let seen = false;
  for (const phase of replay.phases ?? []) {
    for (const u of phase.units ?? []) {
      seen = true;
      if (u.x !== 50 || u.y !== 50) return false;
    }
    for (const m of phase.movements ?? []) {
      seen = true;
      if (m.fromX !== 50 || m.fromY !== 50 || m.toX !== 50 || m.toY !== 50) return false;
    }
  }
  return seen;
}

// deriveSchematicXY returns the replay with schematic x/y projected from
// geography when the replay carries no authored schematic placement. The
// replay is returned unchanged when there is nothing to derive.
export function deriveSchematicXY(replay: Replay): Replay {
  if (!isPlaceheld(replay)) return replay;
  const points = geoPoints(replay);
  if (points.length === 0) return replay;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  // A degree of longitude is shorter than a degree of latitude away from
  // the equator, so east-west offsets are scaled before they are compared.
  const lngScale = Math.cos((centerLat * Math.PI) / 180) || 1;
  const aspect = replay.aspectRatio && replay.aspectRatio > 0 ? replay.aspectRatio : 1.6;

  let halfNorth = 0;
  let halfEast = 0;
  for (const p of points) {
    halfNorth = Math.max(halfNorth, Math.abs(p.lat - centerLat));
    halfEast = Math.max(halfEast, Math.abs(p.lng - centerLng) * lngScale);
  }
  // One scale for both axes keeps the deployment's real proportions. The
  // frame is `aspect` times wider than tall, so an east-west offset needs
  // proportionally less of the horizontal range than the same distance
  // north-south needs of the vertical.
  const scale = Math.max(halfNorth, halfEast / aspect) || 1e-6;

  // Battle lines are wide and shallow. Projected honestly, Cannae's whole
  // deployment occupies a quarter of the frame's height and the rest of the
  // canvas is empty, which leaves no room for labels and makes the shape of
  // a formation impossible to read. The surface map is the geographic
  // record; this view is the diagram, and the app already tells the reader
  // its positions are schematic. So depth is exaggerated to fill the frame,
  // capped so a genuinely deep battle is not squashed and a shallow one is
  // not stretched into nonsense.
  const usedDepth = halfNorth / scale;
  const depthStretch = Math.min(3, Math.max(1, 0.78 / Math.max(usedDepth, 0.02)));

  const toX = (lng: number) =>
    50 + (((lng - centerLng) * lngScale) / scale / aspect) * 50 * fill;
  const toY = (lat: number) =>
    50 - ((lat - centerLat) / scale) * 50 * fill * depthStretch;

  return {
    ...replay,
    phases: (replay.phases ?? []).map((phase) => ({
      ...phase,
      units: (phase.units ?? []).map((u) =>
        typeof u.lat === 'number' && typeof u.lng === 'number'
          ? { ...u, x: toX(u.lng), y: toY(u.lat) }
          : u,
      ),
      movements: (phase.movements ?? []).map((m) => {
        const next = { ...m };
        if (typeof m.fromLat === 'number' && typeof m.fromLng === 'number') {
          next.fromX = toX(m.fromLng);
          next.fromY = toY(m.fromLat);
        }
        if (typeof m.toLat === 'number' && typeof m.toLng === 'number') {
          next.toX = toX(m.toLng);
          next.toY = toY(m.toLat);
        }
        return next;
      }),
    })),
  };
}
