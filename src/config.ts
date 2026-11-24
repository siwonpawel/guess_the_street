// All tunables for Guess the Street live in this one file.

/** Rounds (distinct target streets) per game. */
export const ROUNDS_PER_GAME = 5;

/** A guess within this many meters of the target street is a bullseye (1000 pts). */
export const BULLSEYE_METERS = 25;

/**
 * Base path for pre-baked city data, relative so the app works from any
 * deploy base path (vite `base: './'`). Expects `index.json` and
 * `<slug>.geojson` under it (served from `public/data/cities/`).
 */
export const DATA_BASE = 'data/cities/';

/** localStorage key for the best total score. */
export const BEST_SCORE_KEY = 'gts.best';

/**
 * City slugs shown on the city-select screen. Set to `['szczecin']` to show
 * only Szczecin; set to `null` to show every city present in the data index.
 */
export const VISIBLE_CITY_SLUGS: string[] | null = ['szczecin'];

// Basemap tiles — standard OpenStreetMap raster tiles (a street map; no
// satellite/aerial imagery anywhere). Keyless and fine for low-traffic use
// under the OSM tile usage policy. (CARTO Positron basemaps now require an
// API key, so they are not used.)
export const TILE_URL_NORMAL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_SUBDOMAINS = 'abc';

// Required attribution (ODbL) — shown in the map corner and footer.
export const ATTRIBUTION_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Map zoom clamp. */
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 19;

/**
 * Score for a guess that missed the target street by `distanceM` meters in a
 * city whose scale is `scaleM` (half the city bbox diagonal).
 *
 * - `d <= BULLSEYE_METERS` → bullseye, full 1000 points.
 * - otherwise `round(1000 * max(0, 1 - d / D))` — a guess at the far edge of
 *   the city (d = D) scores ~0.
 */
export function scoreForDistance(distanceM: number, scaleM: number): number {
  if (distanceM <= BULLSEYE_METERS) return 1000;
  if (scaleM <= 0) return 0;
  return Math.round(1000 * Math.max(0, 1 - distanceM / scaleM));
}
