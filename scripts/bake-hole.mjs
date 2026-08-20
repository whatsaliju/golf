#!/usr/bin/env node
// Bake a hole's geometry + metrics to a static JSON so the runtime skips the
// Overpass round-trip. MapLibre streams terrain + imagery tiles itself, so we
// only freeze the OSM-derived geometry and the computed yardage / elevation.
//
// Run on a machine with open network egress:
//   npm run bake -- --hole ws-1
//   npm run bake -- --course whistling-straits --ref 1 --id ws-1
//
// Elevation change is sampled from Terrarium DEM tiles; that needs `sharp`:
//   npm i -D sharp     (optional — omit and elevation is left for the runtime)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSES, HOLES } from '../src/config/holes.js';
import { fetchOverpass, parseOverpass, filterToCourse, fetchContext, parseContext } from '../src/data/overpass.js';
import { assembleHole } from '../src/data/holeModel.js';
import { imagerySource } from '../src/data/endpoints.js';
import { lonToTileX, latToTileY, tileRangeForBbox, pickZoomForBbox, terrariumToMeters } from '../src/data/tiles.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

async function terrariumSampler(bbox) {
  let sharp;
  try { sharp = (await import('sharp')).default; }
  catch { console.warn('  (sharp not installed → elevation left for runtime)'); return null; }

  const z = pickZoomForBbox(bbox, { minPx: 256, maxZoom: 14, minZoom: 11, maxTiles: 16 });
  const { x0, x1, y0, y1 } = tileRangeForBbox(bbox, z);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, W = nx * 256, H = ny * 256;
  const grid = new Float32Array(W * H);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`);
      if (!res.ok) continue;
      const { data } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ox = (tx - x0) * 256, oy = (ty - y0) * 256;
      for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
        const p = (py * 256 + px) * 4;
        grid[(oy + py) * W + (ox + px)] = terrariumToMeters(data[p], data[p + 1], data[p + 2]);
      }
    }
  }
  return (lng, lat) => {
    const ix = Math.max(0, Math.min(W - 1, Math.round((lonToTileX(lng, z) - x0) * 256)));
    const iy = Math.max(0, Math.min(H - 1, Math.round((latToTileY(lat, z) - y0) * 256)));
    return grid[iy * W + ix];
  };
}

async function main() {
  const id = arg('hole') || arg('id');
  let courseId = arg('course'), ref = arg('ref');
  const cfg = id && HOLES.find((h) => h.id === id);
  if (cfg) { courseId = courseId || cfg.courseId; ref = ref || cfg.ref; }
  if (!courseId || !ref) { console.error('Need --hole <id> or --course <id> --ref <n>'); process.exit(1); }
  const course = COURSES[courseId];
  const outId = id || `${courseId}-${ref}`;

  console.log(`Baking ${outId}: ${course.displayName} hole ${ref}`);
  console.log('  → Overpass…');
  const parsed = filterToCourse(parseOverpass(await fetchOverpass(course.bbox)), course.courseNameFilter);

  const geo0 = assembleHole(parsed, ref, null);
  console.log('  → elevation…');
  const sampler = await terrariumSampler(geo0.bbox);
  const hole = assembleHole(parsed, ref, sampler);

  console.log('  → 3D context (buildings, trees)…');
  let context = null;
  try { context = parseContext(await fetchContext(hole.bbox)); }
  catch (e) { console.warn('  (context skipped:', e.message, ')'); }

  await mkdir(resolve(ROOT, 'public/holes'), { recursive: true });
  const doc = {
    id: outId, title: course.displayName, location: course.location, hole, context,
    attribution: imagerySource(course.imagerySource).attribution,
  };
  await writeFile(resolve(ROOT, 'public/holes', `${outId}.json`), JSON.stringify(doc));
  console.log(`✓ public/holes/${outId}.json  (${hole.yardage} yd, elev ${hole.elevationChangeFt ?? 'runtime'} ft)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
