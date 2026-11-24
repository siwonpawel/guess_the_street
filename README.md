# Guess the Street

A static, frontend-only browser game. Pick a city, the game secretly picks a
random named street in it, and you click on an OpenStreetMap **street-only**
map (CARTO Positron tiles — no satellite/aerial imagery) where you think that
street is. After each guess you see exactly how far off you were ("missed by
137 m") plus the points you scored.

See [SCOPING.md](SCOPING.md) for the full scoping plan (rules, architecture,
data strategy, milestones, risks).

## Develop

```sh
npm install
npm run dev
```

If `public/data/cities/` has not been generated yet, the app automatically
falls back to a small embedded demo city (a fictional street grid in Kraków,
`src/mock-data.ts`) and shows a "demo data" badge, so the game is fully
playable without the data pipeline.

## Build

```sh
npm run build
```

Type-checks (`tsc --noEmit`) and produces a static site in `dist/`.

## Test

```sh
npm test
```

Vitest unit tests for the geometry helpers (`src/geo.ts`), the scoring
formula, target-street picking, and the game state machine
(`tests/geo.test.ts`, `tests/game.test.ts`).

## Preview a production build

```sh
npm run preview
```

## Data (city street GeoJSON)

At runtime the app only fetches same-origin static files under
`data/cities/` (`index.json` + `<slug>.geojson`, served from
`public/data/cities/`) and CARTO raster tiles. It never calls
openstreetmap.org or Overpass at runtime. The GeoJSON is pre-baked at build
time by the data pipeline — see `scripts/README.md` for how to regenerate it.

## Deploy

`npm run build`, then serve `dist/` on any static host (GitHub Pages,
Netlify, Cloudflare Pages). Vite is configured with `base: './'`, so the
build works from any subpath. Required map attribution (© OpenStreetMap
contributors, © CARTO) is shown both in the map corner and in the footer.

### GitHub Pages (automatic)

`.github/workflows/deploy.yml` builds and tests on every push to `main`
and deploys `dist/` to GitHub Pages. To enable it once:

1. In the repo settings → Pages, set **Source** to *GitHub Actions*.
2. Push to `main` (or run the workflow manually via *Run workflow*).

The game will be live at `https://<user>.github.io/<repo>/`.
