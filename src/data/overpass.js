// Overpass API: query builder, fetch, and a pure parser that classifies golf
// features by their `golf=*` tag and keeps geometry in lng/lat for MapLibre.

import { overpassUrl } from './endpoints.js';
import { ringCenter, pointInRing } from './geo.js';

/** Overpass QL for every golf feature in a bbox, with inline geometry. */
export function buildQuery(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:120];
(
  way["leisure"="golf_course"](${b});
  relation["leisure"="golf_course"](${b});
  way["golf"](${b});
  relation["golf"](${b});
  way["natural"="water"](${b});
);
out geom tags;`;
}

export async function fetchOverpass(bbox, { fetchImpl = fetch, signal } = {}) {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  const res = await fetchImpl(overpassUrl(), {
    method: 'POST', body, signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
  return res.json();
}

const num = (v) => (v == null || v === '' ? undefined : Number(v));
const toRing = (geometry) =>
  Array.isArray(geometry) ? geometry.map((p) => [p.lon, p.lat]) : [];

/** Classify + keep lng/lat geometry. */
export function parseOverpass(json) {
  const out = { courses: [], holes: [], fairways: [], greens: [], tees: [], bunkers: [], water: [] };
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const ring = toRing(el.geometry);
    if (ring.length < 2) continue;
    const base = { id: el.id, type: el.type, tags, ring, center: ringCenter(ring) };

    if (tags.leisure === 'golf_course') { out.courses.push({ ...base, name: tags.name || '(unnamed course)' }); continue; }
    const g = tags.golf;
    if (g === 'hole') {
      out.holes.push({ ...base, line: ring, ref: tags.ref, par: num(tags.par), dist: num(tags.dist), name: tags.name });
    } else if (g === 'fairway') out.fairways.push(base);
    else if (g === 'green') out.greens.push({ ...base, ref: tags.ref });
    else if (g === 'tee') out.tees.push({ ...base, ref: tags.ref });
    else if (g === 'bunker') out.bunkers.push(base);
    else if (g === 'water_hazard' || g === 'lateral_water_hazard') out.water.push(base);
    else if (tags.natural === 'water') out.water.push(base);
  }
  return out;
}

/** Keep only features whose centre falls inside the named course polygon. */
export function filterToCourse(parsed, courseName) {
  if (!courseName) return parsed;
  const wanted = parsed.courses.filter((c) => c.name.toLowerCase().includes(courseName.toLowerCase()));
  if (wanted.length === 0) return parsed;
  const inAny = (pt) => wanted.some((c) => pointInRing(pt, c.ring));
  const keep = (arr) => arr.filter((f) => inAny(f.center));
  return {
    courses: wanted,
    holes: keep(parsed.holes), fairways: keep(parsed.fairways), greens: keep(parsed.greens),
    tees: keep(parsed.tees), bunkers: keep(parsed.bunkers), water: keep(parsed.water),
  };
}

export { pointInRing };
