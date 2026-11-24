#!/usr/bin/env node
/**
 * fetch-streets.mjs — build-time data pipeline for "Guess the Street" (milestone M1).
 *
 * For every city in scripts/cities.json this script:
 *   1. queries the Overpass API for all named ways with a `highway` tag inside
 *      the city bbox (`way["highway"]["name"](S,W,N,E); out geom;`),
 *   2. keeps only routable street classes (see KEEP_HIGHWAY),
 *   3. simplifies each way geometry with Douglas–Peucker (~8 m tolerance),
 *   4. quantizes coordinates to 5 decimal places,
 *   5. writes a compact GeoJSON FeatureCollection to public/data/cities/<slug>.geojson,
 *   6. updates public/data/cities/index.json.
 *
 * Usage:
 *   node scripts/fetch-streets.mjs                # all cities
 *   node scripts/fetch-streets.mjs --only paris   # a single city
 *
 * Plain Node (>= 18, global fetch), zero npm dependencies.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CITIES_FILE = path.join(SCRIPT_DIR, 'cities.json');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'cities');

// Overpass mirrors, tried in order. The first one that answers wins.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// A descriptive User-Agent is REQUIRED: overpass-api.de's nginx answers 406
// to requests without one.
const USER_AGENT = 'guessthestreet-fetch-streets/1.0 (build-time OSM data pipeline for a static browser game)';

// Street classes kept in the game data.
const KEEP_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service', 'pedestrian', 'footway',
]);

const BASE_TOLERANCE_M = 8;            // Douglas–Peucker tolerance, meters
const MAX_FILE_BYTES = 2.5 * 1024 * 1024; // hard limit: fail loudly above this
const ATTEMPTS_PER_MIRROR = 4;         // ~4 attempts per mirror, exponential backoff + jitter
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000;  // per-attempt client timeout (server can be slow)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms * (0.5 + Math.random())); // 50%..150% of ms

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

/**
 * Run one Overpass query, cycling through mirrors with retries.
 * Retries on network errors, 429, 5xx and non-JSON (HTML error) bodies.
 * Throws after all mirrors/attempts are exhausted.
 */
async function overpassQuery(query) {
  let lastError = null;
  for (const mirror of MIRRORS) {
    let connFailures = 0; // connection-level failures (DNS/connect/timeout) on this mirror
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MIRROR; attempt++) {
      if (attempt > 1) {
        const waitMs = jitter(2000 * 2 ** (attempt - 1));
        console.log(`    retry ${attempt}/${ATTEMPTS_PER_MIRROR} on ${mirror} in ${(waitMs / 1000).toFixed(1)}s ...`);
        await sleep(waitMs);
      }
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
        const res = await fetch(mirror, {
          method: 'POST',
          signal: ctl.signal,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: 'data=' + encodeURIComponent(query),
        });
        clearTimeout(timer);
        const text = await res.text();
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (res.status === 400) {
          throw new Error(`Overpass 400 (bad query, will not retry): ${text.slice(0, 300)}`);
        }
        if (res.ok && text.trimStart().startsWith('{')) {
          console.log(`    ${mirror} -> 200 OK in ${secs}s (${fmtBytes(text.length)})`);
          return JSON.parse(text);
        }
        // 429 / 5xx / HTML error page -> retryable on the same mirror
        connFailures = 0;
        lastError = new Error(`${mirror} -> HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
        console.log(`    ${mirror} -> HTTP ${res.status} in ${secs}s (retryable)`);
      } catch (err) {
        if (err.message.startsWith('Overpass 400')) throw err;
        lastError = err.name === 'AbortError'
          ? new Error(`${mirror} -> client timeout after ${REQUEST_TIMEOUT_MS / 1000}s`)
          : err;
        console.log(`    ${mirror} -> ${lastError.name || 'error'}: ${String(lastError.message).slice(0, 160)}`);
        connFailures++;
        if (connFailures >= 2) {
          console.log(`    ${mirror} looks unreachable, skipping to next mirror`);
          break;
        }
      }
    }
    await sleep(jitter(3000)); // brief pause before the next mirror
  }
  throw new Error(`Overpass query failed on all ${MIRRORS.length} mirrors. Last error: ${lastError}`);
}

/**
 * Douglas–Peucker simplification. Points are [{lat, lon}]; tolerance is in
 * meters, using a local equirectangular projection (fine at city scale).
 * Iterative (stack-based) to avoid recursion limits on long ways.
 */
function simplifyWay(points, toleranceM) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const pts = points.map((p) => [p.lon * kx, p.lat * ky]);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    const ax = pts[a][0], ay = pts[a][1];
    const dx = pts[b][0] - ax, dy = pts[b][1] - ay;
    const len = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0], py = pts[i][1];
      const d = len === 0 ? Math.hypot(px - ax, py - ay)
                          : Math.abs(dy * px - dx * py + pts[b][0] * ay - pts[b][1] * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const quantize = (v) => Math.round(v * 1e5) / 1e5;

/** Filter raw Overpass elements and build the GeoJSON FeatureCollection. */
function buildFeatureCollection(data, toleranceM) {
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const rawCount = elements.length;
  const features = [];
  let kept = 0;
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags || !el.geometry || el.geometry.length < 2) continue;
    const highway = el.tags.highway;
    const name = el.tags.name;
    if (!name || !KEEP_HIGHWAY.has(highway)) continue;
    kept++;
    const simple = simplifyWay(el.geometry, toleranceM);
    features.push({
      type: 'Feature',
      properties: { name, highway },
      geometry: {
        type: 'LineString',
        coordinates: simple.map((p) => [quantize(p.lon), quantize(p.lat)]),
      },
    });
  }
  return { featureCollection: { type: 'FeatureCollection', features }, rawCount, kept };
}

async function fetchCity(city) {
  const [s, w, n, e] = city.bbox;
  const query = `[out:json][timeout:120];way["highway"]["name"](${s},${w},${n},${e});out geom;`;
  console.log(`\n=== ${city.name} (${city.slug}) bbox=[${city.bbox.join(', ')}]`);
  console.log(`    query: ${query}`);
  const data = await overpassQuery(query);
  return data;
}

async function processCity(city) {
  const data = await fetchCity(city);

  let tolerance = BASE_TOLERANCE_M;
  let { featureCollection, rawCount, kept } = buildFeatureCollection(data, tolerance);
  let json = JSON.stringify(featureCollection);
  let bytes = Buffer.byteLength(json);
  console.log(`    raw ways: ${rawCount}, kept streets: ${kept}, size at ${tolerance} m tolerance: ${fmtBytes(bytes)}`);

  // If the file is over the hard limit, increase simplification tolerance and retry once.
  if (bytes > MAX_FILE_BYTES) {
    tolerance *= 2;
    console.log(`    file too big (${fmtBytes(bytes)} > 2.5 MB); retrying once with tolerance ${tolerance} m`);
    ({ featureCollection, rawCount, kept } = buildFeatureCollection(data, tolerance));
    json = JSON.stringify(featureCollection);
    bytes = Buffer.byteLength(json);
    console.log(`    retry at ${tolerance} m tolerance: ${kept} streets, ${fmtBytes(bytes)}`);
  }
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(
      `${city.slug}: output ${fmtBytes(bytes)} exceeds the 2.5 MB hard limit even at ${tolerance} m tolerance. ` +
      `Shrink the bbox in scripts/cities.json or raise BASE_TOLERANCE_M.`
    );
  }

  const file = path.join(OUT_DIR, `${city.slug}.geojson`);
  await writeFile(file, json);
  console.log(`    wrote ${file} (${fmtBytes(bytes)}, ${kept} features)`);
  return {
    slug: city.slug,
    name: city.name,
    country: city.country,
    center: city.center,
    bbox: city.bbox,
    streetCount: featureCollection.features.length,
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap',
    _bytes: bytes,
    _tolerance: tolerance,
  };
}

async function readExistingIndex() {
  try {
    const text = await readFile(path.join(OUT_DIR, 'index.json'), 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/fetch-streets.mjs [--only <slug>]');
    process.exit(0);
  }
  let only = null;
  const oi = args.indexOf('--only');
  if (oi !== -1) {
    only = args[oi + 1];
    if (!only) {
      console.error('Error: --only requires a city slug');
      process.exit(1);
    }
  }

  const cities = JSON.parse(await readFile(CITIES_FILE, 'utf8'));
  const selected = only ? cities.filter((c) => c.slug === only) : cities;
  if (selected.length === 0) {
    console.error(`Error: no city with slug "${only}" in scripts/cities.json`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Fetching streets for ${selected.length} cit${selected.length === 1 ? 'y' : 'ies'}: ${selected.map((c) => c.slug).join(', ')}`);

  const existingIndex = await readExistingIndex();
  const results = [];
  for (const city of selected) {
    const entry = await processCity(city);
    results.push(entry);
    console.log(`    -> ${city.slug}: ${entry.streetCount} streets, ${fmtBytes(entry._bytes)} (tolerance ${entry._tolerance} m)`);
  }

  // Merge with the existing index so `--only <slug>` runs don't drop other cities.
  const bySlug = new Map(existingIndex.map((e) => [e.slug, e]));
  for (const r of results) {
    const { _bytes, _tolerance, ...entry } = r;
    bySlug.set(r.slug, entry);
  }
  const ordered = [
    ...cities.filter((c) => bySlug.has(c.slug)).map((c) => bySlug.get(c.slug)),
    ...existingIndex.filter((e) => !cities.some((c) => c.slug === e.slug)),
  ];
  const indexFile = path.join(OUT_DIR, 'index.json');
  await writeFile(indexFile, JSON.stringify(ordered));
  console.log(`\nwrote ${indexFile} (${ordered.length} cities)`);

  console.log('\nSummary:');
  for (const r of results) {
    console.log(`  ${r.slug.padEnd(10)} ${String(r.streetCount).padStart(6)} streets  ${fmtBytes(r._bytes).padStart(9)}  (tolerance ${r._tolerance} m)`);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
