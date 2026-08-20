// Assemble a single playable hole from projected OSM features. Pure: takes
// parsed features (local metres) plus an optional elevation sampler and returns
// everything the scene + HUD need. Yardage and elevation change are computed
// from the real geometry, never hardcoded.

import { M_TO_YD, M_TO_FT } from './projection.js';

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const dist = (a, b) => Math.sqrt(dist2(a, b));

function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

function nearest(point, features) {
  let best = null, bestD = Infinity;
  for (const f of features) {
    const d = dist2(point, f.center);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/** Shortest distance from a point to a polyline (segments), metres. */
function distToPolyline(pt, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1e-9;
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, pz = a[1] + t * dz;
    best = Math.min(best, Math.hypot(pt[0] - px, pt[1] - pz));
  }
  return best;
}

function boundsOf(pointsSets, pad = 60) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const set of pointsSets) {
    for (const [x, z] of set) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

/**
 * @param parsed   output of parseOverpass/filterToCourse (local metres)
 * @param ref      hole number as string, e.g. "1"
 * @param sampleElevation optional (x,z)=>metres; enables elevationChangeFt
 */
export function assembleHole(parsed, ref, sampleElevation) {
  const refStr = String(ref);
  let holeLine = parsed.holes.find((h) => String(h.ref) === refStr);

  // Match tee & green to this hole, preferring an explicit ref then proximity.
  const teeByRef = parsed.tees.filter((t) => String(t.ref) === refStr);
  const greenByRef = parsed.greens.filter((g) => String(g.ref) === refStr);

  let centerline;
  let par = holeLine?.par;
  let osmDistM = holeLine?.dist;
  let teePt, greenCenter, greenFeat;

  if (holeLine && holeLine.line.length >= 2) {
    const line = holeLine.line.slice();
    const start = line[0];
    const end = line[line.length - 1];
    // Decide which end is the tee: matching-ref tee, else the nearest tee box.
    const teeCandidates = teeByRef.length ? teeByRef : parsed.tees;
    const greenCandidates = greenByRef.length ? greenByRef : parsed.greens;
    const teeNearStart = nearest(start, teeCandidates);
    const teeNearEnd = nearest(end, teeCandidates);
    const startIsTee =
      teeNearStart && teeNearEnd
        ? dist(start, teeNearStart.center) <= dist(end, teeNearEnd.center)
        : true;
    centerline = startIsTee ? line : line.reverse();
    teePt = (teeNearStart && startIsTee ? teeNearStart : teeNearEnd)?.center || centerline[0];
    greenFeat = nearest(centerline[centerline.length - 1], greenCandidates);
    greenCenter = greenFeat?.center || centerline[centerline.length - 1];
  } else {
    // No hole line in OSM: synthesise tee → (fairway) → green.
    const tee = teeByRef[0] || null;
    const green = greenByRef[0] || null;
    if (!tee || !green) {
      throw new Error(
        `Hole ${refStr}: no golf=hole line and missing ref-tagged tee/green in OSM data`
      );
    }
    teePt = tee.center;
    greenFeat = green;
    greenCenter = green.center;
    const spine = parsed.fairways
      .filter((f) => distToPolyline(f.center, [teePt, greenCenter]) < 120)
      .map((f) => f.center)
      .sort((a, b) => dist(teePt, a) - dist(teePt, b));
    centerline = [teePt, ...spine, greenCenter];
  }

  // Nearby hazards: within a corridor of the play line.
  const corridor = 70; // metres either side
  const near = (f) => distToPolyline(f.center, centerline) < corridor;
  const bunkerRings = parsed.bunkers.filter(near).map((f) => f.ring);
  const waterRings = parsed.water.filter(near).map((f) => f.ring);
  const fairwayRings = parsed.fairways.filter(near).map((f) => f.ring);
  const teeRings = (teeByRef.length ? teeByRef : parsed.tees.filter(near)).map((f) => f.ring);
  const greenRing = greenFeat?.ring || [];

  // Metrics from real geometry.
  const geomYards = polylineLength(centerline) * M_TO_YD;
  const yardage = Math.round(osmDistM ? osmDistM * M_TO_YD : geomYards);

  let elevationChangeFt = null;
  if (typeof sampleElevation === 'function') {
    const teeEl = sampleElevation(teePt[0], teePt[1]);
    const greenEl = sampleElevation(greenCenter[0], greenCenter[1]);
    if (Number.isFinite(teeEl) && Number.isFinite(greenEl)) {
      elevationChangeFt = Math.round((greenEl - teeEl) * M_TO_FT);
    }
  }

  const localBounds = boundsOf(
    [centerline, greenRing, ...bunkerRings, ...waterRings, ...fairwayRings, teeRings.flat()],
    70
  );

  return {
    ref: refStr,
    par: par ?? null,
    name: holeLine?.name,
    centerline,
    tee: teePt,
    greenCenter,
    greenRing,
    fairwayRings,
    bunkerRings,
    waterRings,
    teeRings,
    yardage,
    elevationChangeFt,
    localBounds,
  };
}
