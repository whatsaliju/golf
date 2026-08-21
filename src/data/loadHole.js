// Resolve a HOLES[] entry into a hole model + GeoJSON for MapLibre.
// Preference: baked JSON → live Overpass → labelled placeholder.
// Elevation change is filled in by the map after terrain loads (live/placeholder)
// or read from the baked file.

import { fetchOverpass, parseOverpass, filterToCourse, fetchContext, parseContext } from './overpass.js';
import { assembleHole } from './holeModel.js';
import { holeToGeoJSON, contextToGeoJSON } from './holeGeoJSON.js';
import { pathLengthMeters, M_TO_YD } from './geo.js';

async function loadBaked(resolved) {
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  const res = await fetch(`${base}holes/${resolved.id}.json`, { cache: 'no-cache' }).catch(() => null);
  if (!res || !res.ok) return null;
  const baked = await res.json();
  return {
    meta: { title: resolved.title || baked.title, subtitle: resolved.subtitle || `Hole ${baked.hole.ref}`,
      location: baked.location, attribution: baked.attribution, source: 'baked' },
    hole: baked.hole,
    geojson: holeToGeoJSON(baked.hole),
    context: contextToGeoJSON(baked.context || null),
    course: resolved.course,
  };
}

async function loadLive(resolved, onProgress) {
  const { course, ref } = resolved;
  onProgress?.('Querying OpenStreetMap (Overpass)…');
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(25000) : undefined;
  const json = await fetchOverpass(course.bbox, { signal });
  const parsed = filterToCourse(parseOverpass(json), course.courseNameFilter);
  if (!parsed.holes.length && !parsed.tees.length) throw new Error('No golf features for this bbox/course');

  const hole = assembleHole(parsed, ref, null); // elevation filled after terrain loads

  return {
    meta: { title: resolved.title || course.displayName, subtitle: resolved.subtitle || `Hole ${ref}`,
      location: course.location, attribution: '', source: 'live' },
    hole,
    geojson: holeToGeoJSON(hole),
    context: contextToGeoJSON(null), // populated later, in the background
    // Best-effort 3D context — fetched AFTER the flyover is on screen so it
    // never blocks the reveal. Returns GeoJSON collections or null.
    loadContext: async () => {
      try {
        const csignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
        return contextToGeoJSON(parseContext(await fetchContext(hole.bbox, { signal: csignal })));
      } catch (e) { console.warn('context skipped:', e.message); return null; }
    },
    course,
  };
}

function loadPlaceholder(resolved, reason) {
  const { course } = resolved;
  const cx = (course.bbox.west + course.bbox.east) / 2;
  const cy = (course.bbox.south + course.bbox.north) / 2;
  const dN = 350 / 111320; // ~350 m north
  const dE = 40 / (111320 * Math.cos((cy * Math.PI) / 180));
  const centerline = [
    [cx, cy], [cx + dE, cy + dN * 0.3], [cx + dE * 1.6, cy + dN * 0.6], [cx + dE * 0.4, cy + dN],
  ];
  const hole = {
    ref: resolved.ref, par: 4, name: null,
    centerline, tee: centerline[0], greenCenter: centerline[centerline.length - 1],
    greenRing: [], fairwayRings: [], bunkerRings: [], waterRings: [], teeRings: [],
    yardage: Math.round(pathLengthMeters(centerline) * M_TO_YD), elevationChangeFt: null,
    bbox: { west: cx - dE, south: cy - dN * 0.1, east: cx + dE * 2, north: cy + dN * 1.1 },
  };
  return {
    meta: { title: resolved.title || course.displayName, subtitle: `${resolved.subtitle || ''} · PLACEHOLDER`.trim(),
      location: course.location, attribution: '', source: 'placeholder', reason },
    hole, geojson: holeToGeoJSON(hole), context: contextToGeoJSON(null), course,
  };
}

export async function loadHole(resolved, onProgress) {
  try {
    const baked = await loadBaked(resolved);
    if (baked) return baked;
  } catch (e) { console.warn('baked load failed:', e); }

  // Live path, but with a hard wall-clock guarantee: whatever happens (slow
  // Overpass, a network that blocks it, a browser that ignores an abort), the
  // promise resolves to *something* within the deadline so the UI never hangs.
  const live = loadLive(resolved, onProgress).catch((e) => {
    console.error('live load failed, using placeholder:', e);
    return loadPlaceholder(resolved, e.message);
  });
  const guard = new Promise((res) =>
    setTimeout(() => res(loadPlaceholder(resolved, 'OpenStreetMap did not respond in time')), 28000)
  );
  return Promise.race([live, guard]);
}
