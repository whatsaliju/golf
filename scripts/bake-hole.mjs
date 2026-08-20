#!/usr/bin/env node
// Bake a hole's real data to static assets so the runtime loads instantly and
// offline. Run this on a machine with open network egress:
//
//   npm run bake -- --hole ws-1
//   npm run bake -- --course whistling-straits --ref 1 --id ws-1
//
// Writes:
//   public/holes/<id>.json      geometry + yardage + elevationChangeFt + height grid
//   public/holes/<id>/sat.png   stitched satellite imagery
//
// Requires `sharp` for PNG decode/encode:  npm i -D sharp
// (kept optional so the browser bundle never depends on it.)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSES, HOLES } from '../src/config/holes.js';
import { makeProjection } from '../src/data/projection.js';
import { fetchOverpass, parseOverpass, filterToCourse } from '../src/data/overpass.js';
import { assembleHole } from '../src/data/holeModel.js';
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
  tileRangeForBbox, pickZoomForBbox, terrariumToMeters,
} from '../src/data/tiles.js';
import { terrariumTileUrl, esriTileUrl } from '../src/data/endpoints.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.error('This script needs `sharp`. Install it with:  npm i -D sharp');
    process.exit(1);
  }
}

async function fetchTileRGBA(sharp, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// Build a Float32 elevation grid (nx×nz) over local bounds from Terrarium tiles.
async function bakeHeightGrid(sharp, bbox, projection, localBounds, gridN = 160) {
  const z = pickZoomForBbox(bbox, { minPx: 512, maxZoom: 14, minZoom: 11, maxTiles: 25 });
  const { x0, x1, y0, y1 } = tileRangeForBbox(bbox, z);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const W = nx * 256, H = ny * 256;
  const mosaic = new Float32Array(W * H);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const { data } = await fetchTileRGBA(sharp, terrariumTileUrl(z, tx, ty));
      const ox = (tx - x0) * 256, oy = (ty - y0) * 256;
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const p = (py * 256 + px) * 4;
          mosaic[(oy + py) * W + (ox + px)] = terrariumToMeters(data[p], data[p + 1], data[p + 2]);
        }
      }
    }
  }
  const sampleMosaic = (lon, lat) => {
    const px = (lonToTileX(lon, z) - x0) * 256;
    const py = (latToTileY(lat, z) - y0) * 256;
    const ix = Math.max(0, Math.min(W - 1, Math.round(px)));
    const iy = Math.max(0, Math.min(H - 1, Math.round(py)));
    return mosaic[iy * W + ix];
  };

  const b = localBounds;
  const grid = new Array(gridN * gridN);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const x = b.minX + ((b.maxX - b.minX) * j) / (gridN - 1);
      const zc = b.minZ + ((b.maxZ - b.minZ) * i) / (gridN - 1);
      const [lon, lat] = projection.toLatLon(x, zc);
      const e = sampleMosaic(lon, lat);
      grid[i * gridN + j] = e;
      if (e < min) min = e; if (e > max) max = e;
    }
  }
  const sample = (x, zc) => {
    const u = ((x - b.minX) / (b.maxX - b.minX)) * (gridN - 1);
    const v = ((zc - b.minZ) / (b.maxZ - b.minZ)) * (gridN - 1);
    const xi = Math.max(0, Math.min(gridN - 1, Math.round(u)));
    const zi = Math.max(0, Math.min(gridN - 1, Math.round(v)));
    return grid[zi * gridN + xi];
  };
  return {
    heightGrid: { bbox: localBounds, nx: gridN, nz: gridN, data: grid.map((v) => +v.toFixed(2)), min, max },
    sample,
  };
}

async function bakeImagery(sharp, bbox, projection, outPath) {
  const z = pickZoomForBbox(bbox, { minPx: 1024, maxZoom: 19, minZoom: 14, maxTiles: 36 });
  const { x0, x1, y0, y1 } = tileRangeForBbox(bbox, z);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const composites = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const res = await fetch(esriTileUrl(z, tx, ty));
      if (!res.ok) continue;
      composites.push({ input: Buffer.from(await res.arrayBuffer()), left: (tx - x0) * 256, top: (ty - y0) * 256 });
    }
  }
  await sharp({ create: { width: nx * 256, height: ny * 256, channels: 3, background: '#2c3d2c' } })
    .composite(composites).png().toFile(outPath);

  const west = tileXToLon(x0, z), east = tileXToLon(x1 + 1, z);
  const north = tileYToLat(y0, z), south = tileYToLat(y1 + 1, z);
  const [minX, minZ] = projection.toLocal(west, north); // north → smaller z
  const [maxX, maxZ] = projection.toLocal(east, south);
  return { imageBbox: { minX, maxX, minZ, maxZ }, attribution: 'Esri, Maxar, Earthstar Geographics' };
}

async function main() {
  const sharp = await loadSharp();
  const id = arg('hole') || arg('id');
  let courseId = arg('course');
  let ref = arg('ref');
  if (id) {
    const cfg = HOLES.find((h) => h.id === id);
    if (cfg) { courseId = courseId || cfg.courseId; ref = ref || cfg.ref; }
  }
  if (!courseId || !ref) { console.error('Need --hole <id> or --course <id> --ref <n>'); process.exit(1); }
  const course = COURSES[courseId];
  const outId = id || `${courseId}-${ref}`;

  console.log(`Baking ${outId}: ${course.displayName} hole ${ref}`);
  const origin = {
    lat: (course.bbox.south + course.bbox.north) / 2,
    lon: (course.bbox.west + course.bbox.east) / 2,
  };
  const projection = makeProjection(origin);

  console.log('  → Overpass…');
  const json = await fetchOverpass(course.bbox);
  const parsed = filterToCourse(parseOverpass(json, projection), course.courseNameFilter);

  const geo0 = assembleHole(parsed, ref, null);
  const holeBbox = (() => {
    const b = geo0.localBounds, pad = 40;
    const c = [[b.minX - pad, b.minZ - pad], [b.maxX + pad, b.minZ - pad], [b.minX - pad, b.maxZ + pad], [b.maxX + pad, b.maxZ + pad]]
      .map(([x, z]) => projection.toLatLon(x, z));
    const lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
    return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) };
  })();

  console.log('  → elevation (Terrarium/3DEP)…');
  const { heightGrid, sample } = await bakeHeightGrid(sharp, holeBbox, projection, geo0.localBounds);
  const hole = assembleHole(parsed, ref, sample);

  await mkdir(resolve(ROOT, 'public/holes', outId), { recursive: true });
  console.log('  → imagery (Esri)…');
  const satPath = resolve(ROOT, 'public/holes', outId, 'sat.png');
  const { imageBbox, attribution } = await bakeImagery(sharp, holeBbox, projection, satPath);

  const doc = {
    id: outId, title: course.displayName, location: course.location,
    origin, hole, heightGrid, holeBbox,
    imageUrl: `/holes/${outId}/sat.png`, imageBbox, attribution,
  };
  await writeFile(resolve(ROOT, 'public/holes', `${outId}.json`), JSON.stringify(doc));
  console.log(`✓ Wrote public/holes/${outId}.json  (${hole.yardage} yd, elev ${hole.elevationChangeFt ?? 'n/a'} ft)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
