// Overpass API: query builder, fetch, and a pure parser that projects the
// returned lat/lon geometry into local metres and classifies features by their
// `golf=*` tag.

import { overpassUrl } from './endpoints.js';

/**
 * Build an Overpass QL query for every golf feature inside a bbox, returning
 * inline geometry (`out geom`) so we never have to resolve node refs.
 * @param {{west:number,south:number,east:number,north:number}} bbox
 */
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

/** POST a query to Overpass and return parsed JSON. Works in browser and Node. */
export async function fetchOverpass(bbox, { fetchImpl = fetch, signal } = {}) {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  const res = await fetchImpl(overpassUrl(), {
    method: 'POST',
    body,
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
  return res.json();
}

// ---- pure parsing -----------------------------------------------------------

function ringFromGeometry(geometry, projection) {
  if (!Array.isArray(geometry)) return [];
  return geometry.map((n) => projection.toLocal(n.lon, n.lat));
}

function centroid(ring) {
  // area-weighted centroid; falls back to vertex average for degenerate rings.
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[i + 1];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    const n = ring.length || 1;
    return ring.reduce(([sx, sz], [x, z]) => [sx + x / n, sz + z / n], [0, 0]);
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

/** Even-odd point-in-polygon. pt and ring vertices are [x,z]. */
export function pointInRing(pt, ring) {
  let inside = false;
  const [x, z] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

const num = (v) => (v == null || v === '' ? undefined : Number(v));

/**
 * Classify + project an Overpass response.
 * @returns {{courses:Array, holes:Array, fairways:Array, greens:Array,
 *            tees:Array, bunkers:Array, water:Array}}
 */
export function parseOverpass(json, projection) {
  const out = { courses: [], holes: [], fairways: [], greens: [], tees: [], bunkers: [], water: [] };
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const ring = ringFromGeometry(el.geometry, projection);
    if (ring.length < 2) continue;
    const base = { id: el.id, type: el.type, tags, ring, center: centroid(ring) };

    if (tags.leisure === 'golf_course') {
      out.courses.push({ ...base, name: tags.name || '(unnamed course)' });
      continue;
    }
    const g = tags.golf;
    if (g === 'hole') {
      out.holes.push({
        ...base,
        line: ring,
        ref: tags.ref,
        par: num(tags.par),
        dist: num(tags.dist), // metres, per OSM golf spec
        handicap: num(tags.handicap ?? tags.stroke_index),
        name: tags.name,
      });
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
  const wanted = parsed.courses.filter((c) =>
    c.name.toLowerCase().includes(courseName.toLowerCase())
  );
  if (wanted.length === 0) return parsed; // name not found → don't over-filter
  const inAny = (pt) => wanted.some((c) => pointInRing(pt, c.ring));
  const keep = (arr) => arr.filter((f) => inAny(f.center));
  return {
    courses: wanted,
    holes: keep(parsed.holes),
    fairways: keep(parsed.fairways),
    greens: keep(parsed.greens),
    tees: keep(parsed.tees),
    bunkers: keep(parsed.bunkers),
    water: keep(parsed.water),
  };
}
