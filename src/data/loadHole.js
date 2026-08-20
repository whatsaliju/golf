// Orchestrates turning a HOLES[] entry into everything the scene needs, from
// real data. Order of preference:
//   1. baked  → /holes/<id>.json produced by `npm run bake` (fast, offline)
//   2. live   → Overpass + Terrarium DEM + Esri imagery, fetched in-browser
//   3. placeholder → clearly-labelled procedural fallback if the network fails
//
// Returns a uniform shape regardless of source so the scene never branches.

import * as THREE from 'three';
import { makeProjection } from './projection.js';
import { fetchOverpass, parseOverpass, filterToCourse } from './overpass.js';
import { assembleHole } from './holeModel.js';
import { buildHeightField } from './elevation.js';
import { buildImagery } from './imagery.js';

function localBoundsToGeoBbox(projection, b, pad = 40) {
  const corners = [
    [b.minX - pad, b.minZ - pad],
    [b.maxX + pad, b.minZ - pad],
    [b.minX - pad, b.maxZ + pad],
    [b.maxX + pad, b.maxZ + pad],
  ].map(([x, z]) => projection.toLatLon(x, z));
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return {
    west: Math.min(...lons), east: Math.max(...lons),
    south: Math.min(...lats), north: Math.max(...lats),
  };
}

async function loadLive(resolved, onProgress) {
  const { course, ref } = resolved;
  const origin = {
    lat: (course.bbox.south + course.bbox.north) / 2,
    lon: (course.bbox.west + course.bbox.east) / 2,
  };
  const projection = makeProjection(origin);

  onProgress?.('Querying OpenStreetMap (Overpass)…');
  const json = await fetchOverpass(course.bbox);
  const parsed = filterToCourse(parseOverpass(json, projection), course.courseNameFilter);

  if (!parsed.holes.length && !parsed.tees.length) {
    throw new Error('No golf features returned for this bbox/course');
  }

  // First pass: geometry + bounds (no elevation yet).
  const geo0 = assembleHole(parsed, ref, null);
  const holeBbox = localBoundsToGeoBbox(projection, geo0.localBounds);

  onProgress?.('Fetching USGS/Terrarium elevation…');
  const dem = await buildHeightField({ bbox: holeBbox, projection });

  // Second pass with the elevation sampler → real elevationChangeFt.
  const hole = assembleHole(parsed, ref, dem.sample);

  onProgress?.('Fetching satellite imagery…');
  const imagery = await buildImagery({ bbox: holeBbox, projection, source: course.imagerySource });

  return {
    meta: {
      title: resolved.title || course.displayName,
      subtitle: resolved.subtitle || `Hole ${ref}`,
      location: course.location,
      attribution: imagery.attribution,
      source: 'live',
    },
    projection,
    hole,
    sampleElevation: dem.sample,
    elevation: dem,
    imagery,
    holeBbox,
  };
}

async function loadBaked(resolved) {
  const res = await fetch(`/holes/${resolved.id}.json`, { cache: 'no-cache' });
  if (!res.ok) return null;
  const baked = await res.json();
  const projection = makeProjection(baked.origin);

  // Reconstruct a bilinear sampler from the stored coarse grid.
  const { bbox, nx, nz, data } = baked.heightGrid;
  const sample = (x, z) => {
    const u = ((x - bbox.minX) / (bbox.maxX - bbox.minX)) * (nx - 1);
    const v = ((z - bbox.minZ) / (bbox.maxZ - bbox.minZ)) * (nz - 1);
    const x0 = Math.max(0, Math.min(nx - 1, Math.floor(u)));
    const z0 = Math.max(0, Math.min(nz - 1, Math.floor(v)));
    const x1 = Math.min(nx - 1, x0 + 1), z1 = Math.min(nz - 1, z0 + 1);
    const fx = Math.max(0, Math.min(1, u - x0)), fz = Math.max(0, Math.min(1, v - z0));
    const a = data[z0 * nx + x0], b = data[z0 * nx + x1];
    const c = data[z1 * nx + x0], d = data[z1 * nx + x1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  };

  let imagery = null;
  if (baked.imageUrl) {
    const texture = await new THREE.TextureLoader().loadAsync(baked.imageUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const ib = baked.imageBbox; // local-metre bbox the PNG spans, linear map
    const uvFor = (x, z) => [
      (x - ib.minX) / (ib.maxX - ib.minX),
      1 - (z - ib.minZ) / (ib.maxZ - ib.minZ),
    ];
    imagery = { texture, uvFor, attribution: baked.attribution };
  }

  return {
    meta: {
      title: resolved.title || baked.title,
      subtitle: resolved.subtitle || `Hole ${baked.hole.ref}`,
      location: baked.location,
      attribution: baked.attribution,
      source: 'baked',
    },
    projection,
    hole: baked.hole,
    sampleElevation: sample,
    elevation: { sample, min: baked.heightGrid.min, max: baked.heightGrid.max },
    imagery,
    holeBbox: baked.holeBbox,
  };
}

function loadPlaceholder(resolved, reason) {
  const centerline = [
    [0, 0], [8, -60], [22, -140], [55, -230], [70, -320], [60, -380],
  ];
  const elevChangeFt = 18;
  const elevChangeM = elevChangeFt * 0.3048;
  const sample = (x, z) => {
    const t = Math.max(0, Math.min(1, -z / 380));
    return t * elevChangeM + Math.sin(x * 0.02) * 1.2 + Math.sin(z * 0.015 + 1.5);
  };
  const greenCenter = centerline[centerline.length - 1];
  const hole = {
    ref: resolved.ref, par: 4, name: null, centerline,
    tee: centerline[0], greenCenter,
    greenRing: [], fairwayRings: [], bunkerRings: [], waterRings: [], teeRings: [],
    yardage: 412, elevationChangeFt: elevChangeFt,
    localBounds: { minX: -60, maxX: 130, minZ: -440, maxZ: 60 },
  };
  return {
    meta: {
      title: resolved.title || 'Placeholder hole',
      subtitle: `${resolved.subtitle || ''} · PLACEHOLDER`.trim(),
      location: '', attribution: 'procedural placeholder', source: 'placeholder',
      reason,
    },
    projection: makeProjection({ lat: 0, lon: 0 }),
    hole, sampleElevation: sample, elevation: { sample, min: 0, max: elevChangeM },
    imagery: null,
    holeBbox: null,
  };
}

/**
 * @param resolved  hole config with `.course` attached (see resolveHole)
 * @param onProgress optional (msg)=>void for the loading overlay
 */
export async function loadHole(resolved, onProgress) {
  try {
    const baked = await loadBaked(resolved);
    if (baked) return baked;
  } catch (e) {
    console.warn('baked load failed, falling back to live:', e);
  }
  try {
    return await loadLive(resolved, onProgress);
  } catch (e) {
    console.error('live load failed, using placeholder:', e);
    return loadPlaceholder(resolved, e.message);
  }
}
