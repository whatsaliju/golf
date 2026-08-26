#!/usr/bin/env node
// One-off recon for Blackwolf Run: the course boundaries are OSM multipolygon
// RELATIONS the current parser drops. This (a) lists every leisure=golf_course
// element (way/relation) with its name, (b) prototypes stitching a relation's
// outer members into a ring, and (c) counts how many golf=hole centers fall
// inside each named course — to confirm that name-based isolation of the
// Meadow Valleys 18 will work before porting the logic into overpass.js.

import { fetchOverpass } from '../src/data/overpass.js';
import { pointInRing } from '../src/data/geo.js';

const bbox = { west: -87.80, south: 43.705, east: -87.765, north: 43.740 };
const json = await fetchOverpass(bbox, { perTryMs: 60000 });
const els = json.elements || [];
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// golf=hole play lines with a rough center (vertex mean)
const holes = [];
for (const el of els) {
  const t = el.tags || {};
  if (t.golf === 'hole' && Array.isArray(el.geometry) && el.geometry.length) {
    const pts = el.geometry.map((p) => [p.lon, p.lat]);
    const c = pts.reduce(([x, y], [a, b]) => [x + a / pts.length, y + b / pts.length], [0, 0]);
    holes.push({ ref: t.ref, name: t.name, par: t.par, center: c });
  }
}

// stitch relation outer members into one closed ring (endpoint matching)
function stitchOuter(members) {
  const segs = members.filter((m) => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  if (!segs.length) return null;
  const ring = segs.shift().slice();
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  let guard = 0;
  while (segs.length && guard++ < 999) {
    const end = ring[ring.length - 1];
    let i = segs.findIndex((s) => near(s[0], end) || near(s[s.length - 1], end));
    if (i < 0) break;
    let s = segs.splice(i, 1)[0];
    if (near(s[s.length - 1], end)) s = s.reverse();
    ring.push(...s.slice(1));
  }
  return ring;
}

console.log(`total elements: ${els.length}   holes: ${holes.length}`);
for (const el of els) {
  const t = el.tags || {};
  if (t.leisure !== 'golf_course') continue;
  let ring = null;
  if (el.type === 'way' && Array.isArray(el.geometry)) ring = el.geometry.map((p) => [p.lon, p.lat]);
  else if (el.type === 'relation') ring = stitchOuter(el.members || []);
  const closed = ring && ring.length > 3 && near2(ring[0], ring[ring.length - 1]);
  const inside = ring && ring.length > 3 ? holes.filter((h) => pointInRing(h.center, ring)) : [];
  console.log(`\ngolf_course type=${el.type} id=${el.id} name=${JSON.stringify(t.name)} ringPts=${ring ? ring.length : 0} closed=${!!closed} holesInside=${inside.length}`);
  for (const h of inside.sort((a, b) => String(a.ref ?? '').localeCompare(String(b.ref ?? ''), undefined, { numeric: true }))) {
    console.log(`   ref ${String(h.ref).padStart(2)} par${h.par ?? '?'} [${r5(h.center[0])},${r5(h.center[1])}] ${h.name ?? ''}`);
  }
}
function near2(a, b) { return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6; }
