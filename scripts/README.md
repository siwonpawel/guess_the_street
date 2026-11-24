# Data pipeline scripts

Build-time tooling that turns OpenStreetMap data into the static per-city
GeoJSON files the game loads at runtime. Nothing here runs in the browser and
there are **no npm dependencies** — plain Node (>= 18, global `fetch`).

## Regenerate the data

```sh
node scripts/fetch-streets.mjs              # all cities in scripts/cities.json
node scripts/fetch-streets.mjs --only paris # just one city (index.json keeps the others)
```

For each city the script queries the Overpass API for named ways inside the
city bbox, keeps routable street classes (`motorway` … `residential`, plus
`living_street`, `service`, `pedestrian`, `footway`), simplifies every polyline
with Douglas–Peucker (~8 m tolerance, doubled once if the file would exceed
2.5 MB), quantizes coordinates to 5 decimal places, and writes:

- `public/data/cities/<slug>.geojson` — compact FeatureCollection, one Feature
  per street, `properties: { name, highway }`
- `public/data/cities/index.json` — `[{ slug, name, country, center, bbox,
  streetCount, generatedAt, source }]`

The generated files are committed to the repo, so deploys are fully static and
never depend on Overpass at runtime.

## Add a city

1. Append an entry to `scripts/cities.json`:
   `{ "slug": "berlin", "name": "Berlin", "country": "Germany",
      "center": [52.52, 13.405], "bbox": [52.46, 13.30, 52.58, 13.52] }`
   — `bbox` is `[south, west, north, east]`. Keep it a hand-drawn box around
   the city proper (not the whole metro area) to keep the file small.
2. Run `node scripts/fetch-streets.mjs --only berlin`.
3. Check the logged file size. If a city file exceeds ~2 MB, tighten its bbox
   in `scripts/cities.json` and re-run; the script itself fails loudly above
   2.5 MB (after one automatic retry with a doubled simplification tolerance).
4. Commit the new `<slug>.geojson` and updated `index.json`.

## Overpass etiquette

- The script sends a descriptive `User-Agent` (required — overpass-api.de
  rejects requests without one with HTTP 406).
- One query per city, run sequentially, at build time only — never at runtime.
- Mirrors are tried in order (`overpass-api.de`, `overpass.kumi.systems`,
  `overpass.private.coffee`) with ~4 attempts each, exponential backoff and
  jitter, so a busy/429-ing server is handled gracefully.
- If a query keeps failing, wait a few minutes and re-run with `--only <slug>`
  instead of hammering the API. Big-city queries are heavy; prefer off-peak
  hours and keep bboxes tight.
- OSM data is © OpenStreetMap contributors, ODbL — the game shows the
  attribution; keep it when you re-use the generated files.
