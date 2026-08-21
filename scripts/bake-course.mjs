#!/usr/bin/env node
// Bake every hole in HOLES[] to static JSON so the deployed site needs ZERO
// live Overpass calls — visitors load instant geometry from same-origin JSON.
//
// One Overpass query per course (not per hole), so it's rate-limit friendly.
// Elevation is left null and computed at runtime from the terrain; no `sharp`
// needed. Runs in CI before `vite build` (see .github/workflows/deploy-pages.yml).
//
//   npm run bake:all

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSES, HOLES } from '../src/config/holes.js';
import { fetchOverpass, parseOverpass, filterToCourse, fetchContext, parseContext } from '../src/data/overpass.js';
import { assembleHole } from '../src/data/holeModel.js';
import { imagerySource } from '../src/data/endpoints.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const inBbox = ([lng, lat], b) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north;
const ringInBbox = (ring, b) => ring.some((p) => inBbox(p, b));

// keep only context features near this hole (raw parseContext shape)
function filterContext(ctx, b) {
  return {
    buildings: ctx.buildings.filter((x) => ringInBbox(x.ring, b)),
    canopy: ctx.canopy.filter((x) => ringInBbox(x.ring, b)),
    trees: ctx.trees.filter((p) => inBbox(p, b)),
  };
}

async function main() {
  const byCourse = new Map();
  for (const h of HOLES) {
    if (!byCourse.has(h.courseId)) byCourse.set(h.courseId, []);
    byCourse.get(h.courseId).push(h);
  }

  await mkdir(resolve(ROOT, 'public/holes'), { recursive: true });
  let ok = 0, skipped = 0;

  for (const [courseId, holes] of byCourse) {
    const course = COURSES[courseId];
    console.log(`\n${course.displayName}: one Overpass fetch for ${holes.length} holes…`);

    let parsed;
    try {
      parsed = filterToCourse(parseOverpass(await fetchOverpass(course.bbox)), course.courseNameFilter);
    } catch (e) {
      console.error(`  ! hole query failed (${e.message}) — skipping course, runtime will fetch live`);
      skipped += holes.length;
      continue;
    }

    let ctxAll = { buildings: [], canopy: [], trees: [] };
    try {
      ctxAll = parseContext(await fetchContext(course.bbox));
    } catch (e) {
      console.warn(`  ~ context query failed (${e.message}) — baking without 3D context`);
    }

    for (const cfg of holes) {
      try {
        const hole = assembleHole(parsed, cfg.ref, null); // elevation filled at runtime
        const doc = {
          id: cfg.id, title: cfg.title || course.displayName, location: course.location,
          hole, context: filterContext(ctxAll, hole.bbox),
          attribution: imagerySource(course.imagerySource).attribution,
        };
        await writeFile(resolve(ROOT, 'public/holes', `${cfg.id}.json`), JSON.stringify(doc));
        console.log(`  ✓ ${cfg.id}  (${hole.yardage} yd, par ${hole.par ?? '?'})`);
        ok++;
      } catch (e) {
        console.warn(`  · ${cfg.id} skipped (${e.message}) — runtime will fetch live`);
        skipped++;
      }
    }
  }

  console.log(`\nBaked ${ok} holes, ${skipped} skipped.`);
  // Non-fatal: an empty bake just means the runtime fetches live as before.
}

main().catch((e) => { console.error(e); process.exit(1); });
