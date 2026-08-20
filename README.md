# Golf Hole Flyover — real data

A Three.js cinematic hole flyover, rebuilt on a **real data layer**:

- **Hole geometry** from OpenStreetMap (`golf=hole` / `tee` / `fairway` / `green` /
  `bunker` / `water_hazard`) via the **Overpass API**, projected to local metres.
- **Terrain** from a real **DEM** (USGS 3DEP over the US, delivered in-browser as
  tokenless Terrarium terrain-RGB tiles; raw 3DEP GeoTIFF available in the bake CLI).
- **Satellite drape** from **Esri World Imagery** (tokenless) — or Mapbox Satellite
  if you supply a token.
- **Yardage** and **elevation change** are *computed from the geometry + DEM*, not
  hardcoded. The camera choreography (Catmull-Rom spline, ease-in-out altitude
  descent, orbit-around-green finish) and the telemetry HUD are preserved from the
  original demo.

First hole wired: **Whistling Straits — The Straits, Hole 1** (Haven, WI).

## Run

```bash
npm install
npm run dev        # open the printed localhost URL
```

`npm run dev` fetches everything live in your browser. The Vite dev server
reverse-proxies the data hosts (see `vite.config.js`) so CORS never bites.

```bash
npm run build && npm run preview   # production build
npm test                           # offline unit tests (projection, tiles, parsing, metrics)
```

> **No Mapbox account needed.** Defaults are Esri imagery + 3DEP/Terrarium
> elevation, both tokenless. To use Mapbox instead, copy `.env.example` to `.env`,
> set `VITE_MAPBOX_TOKEN`, and set `imagerySource: 'mapbox'` for the course in
> `src/config/holes.js`.

## Adding holes (toward a full 18)

Everything is driven by `src/config/holes.js`:

```js
export const HOLES = [
  { id: 'ws-1', courseId: 'whistling-straits', ref: '1', title: '…', subtitle: 'Hole 1' },
  { id: 'ws-2', courseId: 'whistling-straits', ref: '2', title: '…', subtitle: 'Hole 2' },
  // …
];
```

`ref` is the OSM `golf=hole` reference. The **"Hole ▸"** button cycles the array;
the same order is your 18-hole reel. Add a new course by adding an entry to
`COURSES` (name filter + bbox + region).

## Baking (fast, offline, reproducible)

Live fetching is convenient but hits the network each load. To freeze a hole into
static assets, run the bake CLI **on a machine with open network egress**:

```bash
npm i -D sharp                 # one-time, used only by the bake step
npm run bake -- --hole ws-1
```

This writes `public/holes/ws-1.json` (geometry + yardage + elevation change +
height grid) and `public/holes/ws-1/sat.png` (stitched imagery). The runtime
prefers baked assets when present (`loadHole` → baked → live → placeholder), so a
baked hole loads instantly with no API calls. Bake all 18 for a distributable reel.

## Architecture

```
src/
  config/holes.js      COURSES + HOLES[] registry
  data/
    endpoints.js       URL resolver (dev proxy vs direct)
    tiles.js           Web-Mercator tile math + Terrarium decode (pure)
    projection.js      equirectangular lat/lon ↔ local metres (pure)
    overpass.js        query builder + fetch + classify/project parser (pure parse)
    holeModel.js       assemble centerline, compute yardage + elevationChangeFt (pure)
    elevation.js       Terrarium DEM → bilinear height sampler (browser)
    imagery.js         Esri/Mapbox tiles → draped THREE texture + UV mapper (browser)
    loadHole.js        orchestrator: baked → live → placeholder
  scene/
    world.js           terrain mesh from DEM + imagery + OSM feature overlays
    flight.js          Catmull-Rom flight, ease-in-out descent, green orbit (preserved)
    hud.js             telemetry wiring
  main.js              bootstrap + render loop + controls
scripts/bake-hole.mjs  local Node baker (sharp)
test/                  offline unit tests
```

Data-source URLs and the dev proxy paths live together in `src/data/endpoints.js`
and `vite.config.js` — change them in those two places to swap providers.

## Notes on data quality

- OSM golf coverage varies. If a hole looks off, check that the course's `bbox`
  in `COURSES` fully contains it and that OSM actually tags that hole
  (`golf=hole ref=N`). When a hole line is missing, the model synthesises a
  centerline from the ref-tagged tee and green.
- Terrarium's US elevation is resampled from USGS 3DEP; for survey-grade 3DEP
  precision, extend `scripts/bake-hole.mjs` with the 3DEP `exportImage` GeoTIFF
  endpoint (`elevation.nationalmap.gov/.../3DEPElevation/ImageServer`).
- If live fetching fails entirely, the app renders a clearly-labelled procedural
  **placeholder** so it never blank-screens.
