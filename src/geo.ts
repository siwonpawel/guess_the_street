// Pure geometry helpers. No DOM, no Leaflet — unit-tested in tests/geo.test.ts.

export interface LatLng {
  lat: number;
  lon: number;
}

/** GeoJSON coordinate order: [lon, lat]. */
export type LngLatTuple = [number, number];

/** GeoJSON-style bbox: [west, south, east, north]. */
export type BBox = [number, number, number, number];

const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

interface Vec {
  x: number;
  y: number;
}

/**
 * Local equirectangular projection anchored at `cosLat0` (cosine of the
 * anchor latitude). Accurate enough at city scale (mid-latitude cities).
 */
function project(p: LatLng, cosLat0: number): Vec {
  return {
    x: p.lon * DEG * cosLat0 * EARTH_RADIUS_M,
    y: p.lat * DEG * EARTH_RADIUS_M,
  };
}

function unproject(v: Vec, cosLat0: number): LatLng {
  return {
    lat: v.y / (DEG * EARTH_RADIUS_M),
    lon: v.x / (DEG * cosLat0 * EARTH_RADIUS_M),
  };
}

/** Distance from `p` to segment a–b in meters, in p's local equirectangular plane. */
export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const cosLat0 = Math.cos(p.lat * DEG);
  const P = project(p, cosLat0);
  const A = project(a, cosLat0);
  const B = project(b, cosLat0);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * abx;
  const cy = A.y + t * aby;
  return Math.hypot(P.x - cx, P.y - cy);
}

export interface NearestPoint {
  point: LatLng;
  distanceMeters: number;
  /** Index of the segment the nearest point lies on (-1 for single-point lines). */
  segmentIndex: number;
  /** Parametric position on the segment, 0..1. */
  t: number;
}

/**
 * Nearest point on a polyline to `p`. `coords` are [lon, lat] tuples
 * (GeoJSON order). All segments are measured in p's local equirectangular
 * projection.
 */
export function nearestPointOnPolyline(p: LatLng, coords: LngLatTuple[]): NearestPoint {
  if (coords.length === 0) throw new Error('nearestPointOnPolyline: empty polyline');
  const pts: LatLng[] = coords.map(([lon, lat]) => ({ lat, lon }));
  if (pts.length === 1) {
    return {
      point: pts[0],
      distanceMeters: haversineMeters(p, pts[0]),
      segmentIndex: -1,
      t: 0,
    };
  }
  const cosLat0 = Math.cos(p.lat * DEG);
  const P = project(p, cosLat0);
  let best: NearestPoint = {
    point: pts[0],
    distanceMeters: Infinity,
    segmentIndex: 0,
    t: 0,
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const A = project(pts[i], cosLat0);
    const B = project(pts[i + 1], cosLat0);
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq === 0 ? 0 : ((P.x - A.x) * abx + (P.y - A.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = A.x + t * abx;
    const cy = A.y + t * aby;
    const d = Math.hypot(P.x - cx, P.y - cy);
    if (d < best.distanceMeters) {
      best = { point: unproject({ x: cx, y: cy }, cosLat0), distanceMeters: d, segmentIndex: i, t };
    }
  }
  return best;
}

/** Distance from `p` to the nearest point on the polyline, in meters. */
export function pointToPolylineMeters(p: LatLng, coords: LngLatTuple[]): number {
  return nearestPointOnPolyline(p, coords).distanceMeters;
}

/** Human-readable miss distance: "on the street!" / "X m" / "X.XX km". */
export function formatDistance(m: number): string {
  if (m < 1) return 'on the street!';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** Diagonal of a [west, south, east, north] bbox, in meters. */
export function bboxDiagonalMeters(bbox: BBox): number {
  const [w, s, e, n] = bbox;
  return haversineMeters({ lat: s, lon: w }, { lat: n, lon: e });
}
