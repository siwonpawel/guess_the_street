import { describe, expect, it } from 'vitest';
import {
  bboxDiagonalMeters,
  formatDistance,
  haversineMeters,
  nearestPointOnPolyline,
  pointToPolylineMeters,
  pointToSegmentMeters,
} from '../src/geo';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 50, lon: 19 }, { lat: 50, lon: 19 })).toBe(0);
  });

  it('1 degree of longitude at the equator is ≈ 111.195 km', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111194.93, 1);
  });

  it('1 degree of latitude is ≈ 111.195 km at any latitude', () => {
    expect(haversineMeters({ lat: 50, lon: 19 }, { lat: 51, lon: 19 })).toBeCloseTo(111194.93, 1);
  });
});

describe('pointToSegmentMeters', () => {
  const a = { lat: 50.06, lon: 19.93 };
  const b = { lat: 50.06, lon: 19.95 };

  it('is zero when the point lies on the segment', () => {
    expect(pointToSegmentMeters({ lat: 50.06, lon: 19.94 }, a, b)).toBeCloseTo(0, 6);
  });

  it('measures a perpendicular offset (0.001° lat ≈ 111.19 m)', () => {
    expect(pointToSegmentMeters({ lat: 50.061, lon: 19.94 }, a, b)).toBeCloseTo(111.19, 1);
  });

  it('clamps to the nearer endpoint beyond the segment end', () => {
    const p = { lat: 50.06, lon: 19.96 };
    expect(pointToSegmentMeters(p, a, b)).toBeCloseTo(haversineMeters(p, b), 1);
  });

  it('handles a degenerate segment (a == b)', () => {
    const p = { lat: 50.061, lon: 19.94 };
    const c = { lat: 50.06, lon: 19.94 };
    expect(pointToSegmentMeters(p, c, c)).toBeCloseTo(111.19, 1);
  });
});

describe('pointToPolylineMeters / nearestPointOnPolyline', () => {
  // GeoJSON order: [lon, lat]
  const coords: [number, number][] = [
    [19.93, 50.06],
    [19.94, 50.065],
    [19.95, 50.06],
  ];

  it('is zero for a point on the polyline', () => {
    expect(pointToPolylineMeters({ lat: 50.06, lon: 19.93 }, coords)).toBeCloseTo(0, 6);
    expect(pointToPolylineMeters({ lat: 50.0625, lon: 19.935 }, coords)).toBeLessThan(1);
  });

  it('nearest point matches the min distance and reports its segment', () => {
    const p = { lat: 50.0626, lon: 19.9351 };
    const np = nearestPointOnPolyline(p, coords);
    expect(np.distanceMeters).toBeCloseTo(pointToPolylineMeters(p, coords), 9);
    expect(np.segmentIndex).toBe(0);
    expect(np.point.lat).toBeGreaterThan(50.06);
    expect(np.point.lat).toBeLessThan(50.065);
  });

  it('snaps to the last vertex beyond the polyline end', () => {
    const p = { lat: 50.06, lon: 19.96 };
    const np = nearestPointOnPolyline(p, coords);
    expect(np.point.lon).toBeCloseTo(19.95, 9);
    expect(np.point.lat).toBeCloseTo(50.06, 9);
    expect(np.distanceMeters).toBeCloseTo(haversineMeters(p, { lat: 50.06, lon: 19.95 }), 1);
  });

  it('supports a single-point polyline', () => {
    expect(pointToPolylineMeters({ lat: 50.061, lon: 19.94 }, [[19.94, 50.06]])).toBeCloseTo(111.19, 1);
  });
});

describe('formatDistance', () => {
  it('says "on the street!" below 1 m', () => {
    expect(formatDistance(0)).toBe('on the street!');
    expect(formatDistance(0.4)).toBe('on the street!');
  });

  it('formats meters below 1 km', () => {
    expect(formatDistance(137.4)).toBe('137 m');
    expect(formatDistance(999.4)).toBe('999 m');
  });

  it('formats km with two decimals at 1 km and above', () => {
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(1523)).toBe('1.52 km');
  });
});

describe('bboxDiagonalMeters', () => {
  it('equals the haversine distance across the bbox', () => {
    const bbox: [number, number, number, number] = [19.9, 50.0, 20.0, 50.1];
    expect(bboxDiagonalMeters(bbox)).toBeCloseTo(
      haversineMeters({ lat: 50.0, lon: 19.9 }, { lat: 50.1, lon: 20.0 }),
      6,
    );
  });
});
