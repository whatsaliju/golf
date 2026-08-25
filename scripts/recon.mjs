#!/usr/bin/env node
// One-off recon: query Overpass for candidate course bboxes and print the
// golf_course polygon names, the available golf=hole refs WITH CENTERS (so
// overlapping courses in one bbox can be separated spatially), and counts.

import { fetchOverpass, parseOverpass } from '../src/data/overpass.js';

const boxes = {
  // Blackwolf Run complex (River + Meadow Valleys interweave) — need to isolate
  // the Meadow Valleys routing spatially.
  'blackwolf-run': { west: -87.80, south: 43.705, east: -87.765, north: 43.740 },
  // River Vale CC — shifted north (earlier bbox clipped it at 41.022).
  'river-vale': { west: -74.025, south: 41.005, east: -73.985, north: 41.045 },
};

const r5 = (n) => Math.round(n * 1e5) / 1e5;

for (const [label, bbox] of Object.entries(boxes)) {
  console.log(`\n=== ${label}  ${JSON.stringify(bbox)} ===`);
  try {
    const parsed = parseOverpass(await fetchOverpass(bbox, { perTryMs: 60000 }));
    console.log('courses:', parsed.courses.map((c) => c.name));
    const holes = parsed.holes
      .map((h) => ({ ref: h.ref, par: h.par, name: h.name, c: [r5(h.center[0]), r5(h.center[1])] }))
      .sort((a, b) => String(a.ref ?? '').localeCompare(String(b.ref ?? ''), undefined, { numeric: true }));
    console.log(`holes (${parsed.holes.length}):`);
    for (const h of holes) console.log(`  ref ${String(h.ref).padStart(2)} par${h.par ?? '?'} [${h.c}] ${h.name ?? ''}`);
    console.log(`tees ${parsed.tees.length}  greens ${parsed.greens.length}  fairways ${parsed.fairways.length}  bunkers ${parsed.bunkers.length}`);
  } catch (e) {
    console.log('FAILED:', e.message);
  }
}
