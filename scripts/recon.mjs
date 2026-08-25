#!/usr/bin/env node
// One-off recon: query Overpass for candidate course bboxes and print the
// golf_course polygon names, the available golf=hole refs, and feature counts.
// Used to calibrate a new course's bbox + courseNameFilter before wiring it
// into COURSES/HOLES. Not part of the build; run manually or in CI.

import { fetchOverpass, parseOverpass } from '../src/data/overpass.js';

const boxes = {
  'blackwolf-run': { west: -87.80, south: 43.705, east: -87.765, north: 43.740 },
  'river-vale': { west: -74.02, south: 40.998, east: -73.99, north: 41.022 },
};

for (const [label, bbox] of Object.entries(boxes)) {
  console.log(`\n=== ${label}  ${JSON.stringify(bbox)} ===`);
  try {
    const parsed = parseOverpass(await fetchOverpass(bbox, { perTryMs: 60000 }));
    console.log('courses:', parsed.courses.map((c) => c.name));
    const refs = parsed.holes
      .map((h) => ({ ref: h.ref, par: h.par, name: h.name }))
      .sort((a, b) => String(a.ref ?? '').localeCompare(String(b.ref ?? ''), undefined, { numeric: true }));
    console.log(`holes (${parsed.holes.length}):`, JSON.stringify(refs));
    console.log(`tees ${parsed.tees.length}  greens ${parsed.greens.length}  fairways ${parsed.fairways.length}  bunkers ${parsed.bunkers.length}`);
  } catch (e) {
    console.log('FAILED:', e.message);
  }
}
