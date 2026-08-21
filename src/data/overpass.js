// Overpass API: query builder, fetch, and a pure parser that classifies golf
// features by their `golf=*` tag and keeps geometry in lng/lat for MapLibre.

import { overpassEndpoints } from './endpoints.js';
import { ringCenter, pointInRing } from './geo.js';

/**
 * POST an Overpass query, trying each mirror in turn. Each attempt gets its own
 * timeout (default 20s) so one slow/hung mirror can't stall the whole load; the
 * next mirror is tried on any failure. Rejects only if every mirror fails.
 */
async function postOverpass(query, { fetchImpl = fetch, perTryMs = 20000, signal } = {}) {
  const body = new URLSearchParams({ data: query });
  let lastErr;
  for (const url of overpassEndpoints()) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), perTryMs) : null;
    if (signal && ctrl) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const res = await fetchImpl(url, {
        method: 'POST', body, signal: ctrl ? ctrl.signal : signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Explicit Accept + User-Agent: Overpass rejects header-less requests
          // (e.g. Node's default fetch) with 406 Not Acceptable. Browsers ignore
          // attempts to set User-Agent, so this is a no-op there and a fix in Node.
          Accept: 'application/json,*/*',
          'User-Agent': 'golf-hole-flyover (+https://github.com/whatsaliju/golf)',
        },
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (signal && signal.aborted) break; // caller gave up entirely
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new Error('All Overpass endpoints failed');
}

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

export async function fetchOverpass(bbox, opts = {}) {
  return postOverpass(buildQuery(bbox), opts);
}

/** Context features (buildings, tree cover) for 3D realism, in a bbox. */
export function buildContextQuery(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:90];
(
  way["building"](${b});
  way["natural"="wood"](${b});
  way["landuse"="forest"](${b});
  way["natural"="scrub"](${b});
  node["natural"="tree"](${b});
);
out geom tags;`;
}

export async function fetchContext(bbox, opts = {}) {
  return postOverpass(buildContextQuery(bbox), opts);
}

const num = (v) => (v == null || v === '' ? undefined : Number(v));

function buildingHeight(tags) {
  const h = num(tags.height);
  if (Number.isFinite(h)) return h;
  const lv = num(tags['building:levels']);
  if (Number.isFinite(lv)) return Math.max(3, lv * 3.2);
  return 6;
}

/** Classify context features into extrudable buildings, tree canopy, tree points. */
export function parseContext(json) {
  const out = { buildings: [], canopy: [], trees: [] };
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'node' && tags.natural === 'tree') {
      if (Number.isFinite(el.lon) && Number.isFinite(el.lat)) out.trees.push([el.lon, el.lat]);
      continue;
    }
    const ring = toRing(el.geometry);
    if (ring.length < 3) continue;
    if (tags.building) {
      out.buildings.push({ ring, height: buildingHeight(tags), minHeight: num(tags.min_height) || 0 });
    } else if (tags.natural === 'wood' || tags.landuse === 'forest') {
      out.canopy.push({ ring, height: 12 });
    } else if (tags.natural === 'scrub') {
      out.canopy.push({ ring, height: 4 });
    }
  }
  return out;
}
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
