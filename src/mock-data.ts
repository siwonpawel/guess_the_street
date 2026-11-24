// Embedded fallback city so the game is fully playable in dev even when the
// data pipeline (public/data/cities/) has not been generated yet.
// A fictional street grid "in Kraków" — clearly not real OSM data.

import type { CityInfo, StreetFeature } from './data';

export const MOCK_CITY: CityInfo = {
  slug: 'demo-krakow',
  name: 'Kraków (demo)',
  country: 'Poland',
  center: [19.94, 50.06], // [lon, lat]
  bbox: [19.925, 50.052, 19.955, 50.068], // [west, south, east, north]
  streetCount: 12,
};

function line(name: string, coords: [number, number][], highway = 'residential'): StreetFeature {
  return {
    type: 'Feature',
    properties: { name, highway },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

const W = 19.925;
const E = 19.955;
const S = 50.052;
const N = 50.068;

// 5 north–south streets, 4 east–west streets, 3 diagonals = a dozen named streets.
const NAMES_NS = ['Ulica Fikcyjna', 'Ulica Przykładowa', 'Ulica Wirtualna', 'Ulica Testowa', 'Ulica Mockowa'];
const NAMES_EW = ['Aleja Wymyślona', 'Ulica Demo', 'Ulica Prototypowa', 'Ulica Szkicowa'];
const NAMES_DIAG = ['Ulica Sample', 'Ulica Zapasowa', 'Ulica Brudnopisowa'];

export const MOCK_STREET_FEATURES: StreetFeature[] = [
  ...NAMES_NS.map((name, i) => line(name, [[19.93 + 0.005 * i, S], [19.93 + 0.005 * i, N]], i === 0 ? 'primary' : 'residential')),
  ...NAMES_EW.map((name, i) => line(name, [[W, 50.054 + 0.004 * i], [E, 50.054 + 0.004 * i]], 'secondary')),
  line(NAMES_DIAG[0], [[W, S], [E, N]], 'tertiary'),
  line(NAMES_DIAG[1], [[W, 50.058], [E, 50.066]], 'tertiary'),
  line(NAMES_DIAG[2], [[19.93, N], [E, S]], 'tertiary'),
];
