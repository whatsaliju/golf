// Assemble a playable hole from parsed OSM features (lng/lat). Yardage comes
// from the real play-line length; elevation change from an optional elevation
// sampler (MapLibre's queryTerrainElevation at runtime, or a DEM in the baker).

import { haversineMeters, pathLengthMeters, bboxOf, M_TO_YD, M_TO_FT } from './geo.js';

const dist = (a, b) => haversineMeters(a, b);

function nearest(point, features) {
  let best = null, bestD = Infinity;
  for (const f of features) {
    const d = dist(point, f.center);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/**
 * A fairway-following route between tee and green.
 *
 * The OSM `golf=hole` play line is often drawn straighter than the fairway, so
 * a camera that flies it cuts the corner of a bend. This bends the route toward
 * the fairway's midline: project every fairway-polygon vertex onto the
 * tee→green axis, bin by progress along it, and take the mean perpendicular
 * offset per bin. Both fairway edges shift together through a curve, so their
 * mean tracks the centre of the fairway and the route hugs the turf.
 *
 * Returns null (keep the straight play line) when there isn't enough fairway
 * geometry to trust — a green-only or unmapped hole.
 */
export function fairwaySpine(tee, green, fairwayRings) {
  if (!fairwayRings || !fairwayRings.length) return null;
  const lat0 = (tee[1] + green[1]) / 2;
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lon, lat]) => [lon * mLon, lat * mLat];
  const T = toXY(tee), G = toXY(green);
  const ax = G[0] - T[0], ay = G[1] - T[1];
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L, uy = ay / L;   // along tee→green
  const px = -uy, py = ux;          // perpendicular (left positive)

  const BINS = 12;
  const bin = Array.from({ length: BINS }, () => ({ sumD: 0, n: 0 }));
  let used = 0;
  for (const ring of fairwayRings) {
    for (const c of ring) {
      const [x, y] = toXY(c);
      const dx = x - T[0], dy = y - T[1];
      const s = dx * ux + dy * uy;      // metres along the axis
      if (s < -25 || s > L + 25) continue;
      const d = dx * px + dy * py;      // metres off the axis
      let k = Math.floor((s / L) * BINS);
      k = Math.max(0, Math.min(BINS - 1, k));
      bin[k].sumD += d; bin[k].n++; used++;
    }
  }
  if (used < 6) return null;

  const spine = [tee];
  for (let k = 0; k < BINS; k++) {
    if (!bin[k].n) continue;
    const s = ((k + 0.5) / BINS) * L;
    const d = bin[k].sumD / bin[k].n;   // fairway midline offset in this slice
    spine.push([(T[0] + ux * s + px * d) / mLon, (T[1] + uy * s + py * d) / mLat]);
  }
  spine.push(green);
  return spine.length >= 3 ? spine : null;
}

/** Shortest distance (m) from a lng/lat point to a lng/lat polyline. */
function distToPolyline(pt, line) {
  // planar approximation in local degrees scaled to metres — fine at hole scale
  const mLat = 111320, mLon = 111320 * Math.cos((pt[1] * Math.PI) / 180);
  const P = [pt[0] * mLon, pt[1] * mLat];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = [line[i - 1][0] * mLon, line[i - 1][1] * mLat];
    const b = [line[i][0] * mLon, line[i][1] * mLat];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(P[0] - (a[0] + t * dx), P[1] - (a[1] + t * dy)));
  }
  return best;
}

export function assembleHole(parsed, ref, sampleElevation) {
  const refStr = String(ref);
  const holeLine = parsed.holes.find((h) => String(h.ref) === refStr);
  const teeByRef = parsed.tees.filter((t) => String(t.ref) === refStr);
  const greenByRef = parsed.greens.filter((g) => String(g.ref) === refStr);

  let centerline, teePt, greenCenter, greenFeat;
  const par = holeLine?.par ?? null;
  const osmDistM = holeLine?.dist;

  if (holeLine && holeLine.line.length >= 2) {
    const line = holeLine.line.slice();
    const start = line[0], end = line[line.length - 1];
    const teeCand = teeByRef.length ? teeByRef : parsed.tees;
    const greenCand = greenByRef.length ? greenByRef : parsed.greens;
    const tNearStart = nearest(start, teeCand), tNearEnd = nearest(end, teeCand);
    const startIsTee = tNearStart && tNearEnd
      ? dist(start, tNearStart.center) <= dist(end, tNearEnd.center) : true;
    centerline = startIsTee ? line : line.reverse();
    teePt = (startIsTee ? tNearStart : tNearEnd)?.center || centerline[0];
    greenFeat = nearest(centerline[centerline.length - 1], greenCand);
    greenCenter = greenFeat?.center || centerline[centerline.length - 1];
  } else {
    const tee = teeByRef[0], green = greenByRef[0];
    if (!tee || !green) throw new Error(`Hole ${refStr}: no golf=hole line and missing ref-tagged tee/green`);
    teePt = tee.center; greenFeat = green; greenCenter = green.center;
    const spine = parsed.fairways
      .filter((f) => distToPolyline(f.center, [teePt, greenCenter]) < 120)
      .map((f) => f.center)
      .sort((a, b) => dist(teePt, a) - dist(teePt, b));
    centerline = [teePt, ...spine, greenCenter];
  }

  const corridor = 70;
  const near = (f) => distToPolyline(f.center, centerline) < corridor;
  const bunkers = parsed.bunkers.filter(near);
  const water = parsed.water.filter(near);
  const fairways = parsed.fairways.filter(near);
  const tees = teeByRef.length ? teeByRef : parsed.tees.filter(near);

  // Camera route that hugs the fairway through bends (falls back to play line).
  const route = fairwaySpine(teePt, greenCenter, fairways.map((f) => f.ring)) || centerline;

  const yardage = Math.round((osmDistM ? osmDistM : pathLengthMeters(centerline)) * M_TO_YD);

  let elevationChangeFt = null;
  if (typeof sampleElevation === 'function') {
    const t = sampleElevation(teePt[0], teePt[1]);
    const g = sampleElevation(greenCenter[0], greenCenter[1]);
    if (Number.isFinite(t) && Number.isFinite(g)) elevationChangeFt = Math.round((g - t) * M_TO_FT);
  }

  const bbox = bboxOf(
    [centerline, greenFeat?.ring || [], ...bunkers.map((b) => b.ring), ...water.map((w) => w.ring), ...tees.map((t) => t.ring)],
    70
  );

  return {
    ref: refStr, par, name: holeLine?.name,
    centerline, route, tee: teePt, greenCenter,
    greenRing: greenFeat?.ring || [],
    fairwayRings: fairways.map((f) => f.ring),
    bunkerRings: bunkers.map((b) => b.ring),
    waterRings: water.map((w) => w.ring),
    teeRings: tees.map((t) => t.ring),
    yardage, elevationChangeFt, bbox,
  };
}
