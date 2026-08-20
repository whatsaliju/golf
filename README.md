# Golf Hole Flyover — real data (MapLibre GL JS)

A cinematic golf-hole flyover built on a **100% free & open-source** data + rendering
stack. No API keys, no accounts, no paid tiers required.

- **Engine:** [MapLibre GL JS](https://maplibre.org/) (BSD-3, FOSS) — real 3D terrain
  + satellite draping, driven by the FreeCamera API for the flight.
- **Hole geometry:** OpenStreetMap (`golf=hole` / `tee` / `fairway` / `green` /
  `bunker` / `water_hazard`) via the **Overpass API** (ODbL open data).
- **Terrain:** AWS **Terrain Tiles** (Terrarium terrain-RGB, open data; US relief is
  USGS **3DEP**-sourced), used as a MapLibre `raster-dem` source with hillshade.
- **Satellite:** **USGS Imagery / NAIP** — **public domain**, no token
  (`basemap.nationalmap.gov`). Esri World Imagery and Mapbox are optional fallbacks.
- **3D realism:** OSM buildings (clubhouse) and tree cover extruded in 3D, an
  extruded flagstick at the pin, warm directional lighting, atmospheric sky, a
  toggleable terrain **Relief** exaggeration (1×/1.5×/2× — makes the dunes read),
  and subtly animated water hazards.
- **One-click video export:** the **● Record** button captures a fresh flyover from
  the map canvas and downloads it as a `.webm`.
- **Yardage** and **elevation change** are computed from the real geometry +
  terrain (`queryTerrainElevation`), not hardcoded. The camera choreography
  (Catmull-Rom spline, ease-in-out descent, orbit-around-green) and the telemetry
  HUD are carried over from the original demo.

First hole wired: **Whistling Straits — The Straits, Hole 1** (Haven, WI).

## Is any of it paid?

No. Everything above is free. One nuance on *open*:

| Layer | Source | Cost | Open? |
|---|---|---|---|
| Geometry | OpenStreetMap / Overpass | Free | ✅ ODbL |
| Terrain | AWS Terrain Tiles / USGS 3DEP | Free | ✅ Open / public domain |
| Satellite (default) | **USGS / NAIP** | Free | ✅ Public domain |
| Satellite (option) | Esri World Imagery | Free | ⚠️ Free-to-use, proprietary |
| Satellite (option) | Mapbox Satellite | Free tier | ❌ Proprietary, needs token |

The default (`imagerySource: 'usgs'`) is fully public-domain. Switch per course in
`src/config/holes.js`.

## View online (no local install)

Can't install Node locally? Deploy it to the web and open it as a URL:

**GitHub Pages (free, built in the cloud):** a workflow at
`.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`.
One-time: **Settings → Pages → Source = "GitHub Actions"**, then open
`https://<user>.github.io/<repo>/`. (Free Pages needs a **public** repo, or GitHub
Pro for a private one.)

**Netlify / Cloudflare Pages (free, works with private repos):** "Add site → import
from GitHub", pick this repo. Build command `npm run build`, publish directory
`dist`. It auto-builds and gives you a URL.

**Instant, zero setup:** open `https://stackblitz.com/github/<user>/<repo>` — runs the
dev server in your browser (sign in with GitHub for a private repo).

## Run locally

```bash
npm install
npm run dev        # open the printed localhost URL
```

Everything is fetched live in the browser (all sources are CORS-enabled; no proxy
needed). Drag to orbit, scroll to zoom, right-drag to rotate/pitch. After the
flyover finishes the camera is released for free exploration.

Controls (top-right): **Replay flyover**, **Speed** (1x/2x/0.5x), **Relief**
(terrain exaggeration 1x/1.5x/2x — makes the dunes read), **● Record** (exports a
`.webm` of a fresh flyover), and **Hole ▸** once more than one hole is registered.

```bash
npm run build && npm run preview   # production build
npm test                           # offline unit tests
```

> Note: the imagery for the very close ground shots comes from USGS/NAIP, which caps
> around zoom 16 (~2.4 m/px). For sharper close-ups set `imagerySource: 'esri'`
> (zoom ~19) — free to use, but proprietary rather than open.

## Adding holes (toward a full 18)

Driven entirely by `src/config/holes.js`:

```js
export const HOLES = [
  { id: 'ws-1', courseId: 'whistling-straits', ref: '1', title: '…', subtitle: 'Hole 1' },
  { id: 'ws-2', courseId: 'whistling-straits', ref: '2', title: '…', subtitle: 'Hole 2' },
  // …
];
```

`ref` is the OSM `golf=hole` reference. The **"Hole ▸"** button cycles the array —
the same order is your 18-hole reel. Add a new course by adding a `COURSES` entry
(name filter + bbox + imagery source).

## Baking (optional — skip the Overpass round-trip)

MapLibre streams terrain + imagery itself, so baking only freezes the OSM geometry
and computed metrics. Run on a machine with open egress:

```bash
npm i -D sharp                 # optional: enables baked elevation change
npm run bake -- --hole ws-1
```

Writes `public/holes/ws-1.json`. The runtime prefers it when present
(`loadHole` → baked → live → placeholder).

## Architecture

```
src/
  config/holes.js        COURSES + HOLES[] registry
  data/
    endpoints.js         source URLs (imagery / terrain / overpass)
    geo.js               haversine, centroid, point-in-ring, Catmull-Rom (pure)
    tiles.js             Web-Mercator tile math + Terrarium decode (pure, baker)
    overpass.js          query + fetch + classify parser → lng/lat (pure parse)
    holeModel.js         centerline, real yardage, elevation change (pure)
    holeGeoJSON.js       hole model → MapLibre GeoJSON sources
    loadHole.js          orchestrator: baked → live → placeholder
  scene/
    flyover.js           FreeCamera Catmull-Rom flight + green orbit
    hud.js               telemetry wiring
  main.js                MapLibre map (terrain + sky + imagery + overlays) + controls
scripts/bake-hole.mjs    optional local baker (sharp)
test/                    offline unit tests
reference/               original single-file mock demo, for provenance
```

## Why MapLibre (vs Three.js / Cesium)

MapLibre gives accurate geo terrain + imagery draping and a cinematic camera out of
the box, is fully FOSS (BSD-3), and needs no token. Cesium (Apache-2.0) is the other
strong FOSS option for globe-accurate 3D; Three.js gives the most bespoke art control
but you hand-build the geospatial plumbing. This project uses MapLibre for the best
realism-per-effort while staying free and open.
