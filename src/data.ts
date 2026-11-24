// Data loading: city index + per-city GeoJSON (same-origin static files),
// plus random target-street picking. Falls back to the embedded mock city
// when the generated data files are not available.

import type { Feature, LineString, MultiLineString } from 'geojson';
import { DATA_BASE, VISIBLE_CITY_SLUGS } from './config';
import { MOCK_CITY, MOCK_STREET_FEATURES } from './mock-data';

export interface CityInfo {
  slug: string;
  name: string;
  country: string;
  /** [lon, lat] */
  center: [number, number];
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  streetCount: number;
}

/**
 * `index.json` is written by scripts/fetch-streets.mjs straight from
 * scripts/cities.json, so it stores `center` as [lat, lon] and `bbox` as
 * [south, west, north, east] (Overpass order). Internally the app uses
 * [lon, lat] and [west, south, east, north] — normalize on load.
 */
function normalizeIndexCity(c: CityInfo): CityInfo {
  const [s, w, n, e] = c.bbox;
  const [lat, lon] = c.center;
  return { ...c, center: [lon, lat], bbox: [w, s, e, n] };
}

export type StreetGeometry = LineString | MultiLineString;
export type StreetFeature = Feature<StreetGeometry, { name: string; highway?: string }>;

export interface CityData {
  city: CityInfo;
  features: StreetFeature[];
  usingMock: boolean;
}

/** Polylines of a street feature as arrays of [lon, lat] tuples. */
export function polylinesOfFeature(f: StreetFeature): [number, number][][] {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates as [number, number][]];
  if (g.type === 'MultiLineString') return g.coordinates as [number, number][][];
  return [];
}

let citiesCache: { cities: CityInfo[]; usingMock: boolean } | null = null;

/**
 * Load the city index (`data/cities/index.json`). If it cannot be fetched
 * (e.g. the data pipeline has not run in this worktree), fall back to the
 * embedded mock city and report `usingMock: true`.
 */
export async function loadCities(): Promise<{ cities: CityInfo[]; usingMock: boolean }> {
  if (citiesCache) return citiesCache;
  try {
    const res = await fetch(`${DATA_BASE}index.json`);
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    const data = (await res.json()) as CityInfo[];
    if (!Array.isArray(data) || data.length === 0) throw new Error('index.json: no cities');
    const slugs = VISIBLE_CITY_SLUGS;
    const visible = slugs ? data.filter((c) => slugs.includes(c.slug)) : data;
    if (visible.length === 0) throw new Error('index.json: no visible cities');
    citiesCache = { cities: visible.map(normalizeIndexCity), usingMock: false };
  } catch {
    citiesCache = { cities: [MOCK_CITY], usingMock: true };
  }
  return citiesCache;
}

const cityCache = new Map<string, CityData>();

/**
 * Lazily load one city's street GeoJSON (`data/cities/<slug>.geojson`) and
 * cache it. When the real index is available but this city's file fails to
 * load, the error is thrown so the UI can show a graceful error state. The
 * embedded mock city is only used when the index itself is unavailable (dev
 * without generated data); `usingMock` marks that.
 */
export async function loadCity(slug: string): Promise<CityData> {
  const hit = cityCache.get(slug);
  if (hit) return hit;
  const { cities, usingMock } = await loadCities();
  if (usingMock) {
    const data: CityData = { city: MOCK_CITY, features: MOCK_STREET_FEATURES, usingMock: true };
    cityCache.set(slug, data);
    return data;
  }
  const res = await fetch(`${DATA_BASE}${slug}.geojson`);
  if (!res.ok) throw new Error(`${slug}.geojson: HTTP ${res.status}`);
  const gj = (await res.json()) as { features?: StreetFeature[] };
  const features = gj.features ?? [];
  if (features.length === 0) throw new Error(`${slug}.geojson: no features`);
  const city = cities.find((c) => c.slug === slug) ?? infoFromFeatures(slug, features);
  const data: CityData = { city, features, usingMock: false };
  cityCache.set(slug, data);
  return data;
}

/** Derive a CityInfo from the features themselves if the index lacks the slug. */
function infoFromFeatures(slug: string, features: StreetFeature[]): CityInfo {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const f of features) {
    for (const line of polylinesOfFeature(f)) {
      for (const [lon, lat] of line) {
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      }
    }
  }
  if (!Number.isFinite(w)) {
    w = 0; s = 0; e = 0; n = 0;
  }
  return {
    slug,
    name: slug,
    country: '',
    center: [(w + e) / 2, (s + n) / 2],
    bbox: [w, s, e, n],
    streetCount: features.length,
  };
}

/**
 * Pick `n` distinct random streets (by feature index — never the same street
 * twice within a game). `rng` defaults to Math.random; inject a seeded rng
 * in tests. Caps at the available number of features.
 */
export function pickTargetStreets(
  features: StreetFeature[],
  n: number,
  rng: () => number = Math.random,
): StreetFeature[] {
  const idx = features.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const count = Math.min(n, idx.length);
  return idx.slice(0, count).map((i) => features[i]);
}

/** Test hook: clear module-level caches. */
export function __resetDataCaches(): void {
  citiesCache = null;
  cityCache.clear();
}
