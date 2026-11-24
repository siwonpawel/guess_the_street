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

// Basemap tiles — street-only CARTO Positron styles. No imagery anywhere.
export const TILE_URL_NORMAL =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export const TILE_URL_HARDCORE =
  'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
export const TILE_SUBDOMAINS = 'abcd';

// Required attribution (ODbL / CARTO terms) — shown in the map corner and footer.
export const ATTRIBUTION_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const ATTRIBUTION_CARTO =
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

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
