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
 * a camera that flies it cuts the corner of a bend. This snaps the route onto
 * the fairway's midline: measure every fairway-polygon vertex against the play
 * line by ARC LENGTH along it (not a straight tee→green chord) with a signed
 * perpendicular offset, bin by progress, and take the mean offset per slice.
 *
 * Projecting along the play line's own arc length (with a local normal at each
 * slice) is what keeps a dogleg honest: a fairway that runs straight and THEN
 * turns produces near-zero offsets early and a growing offset only past the
 * corner, so the route holds the line and turns late — instead of the smooth
 * bow a straight-chord projection produces, which drifts toward the hole from
 * the tee.
 *
 * Returns null (keep the straight play line) when there isn't enough fairway
 * geometry to trust — a green-only or unmapped hole.
 */
export function fairwaySpine(centerline, fairwayRings) {
  if (!fairwayRings || !fairwayRings.length || !centerline || centerline.length < 2) return null;
  const lat0 = centerline[Math.floor(centerline.length / 2)][1];
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([lon, lat]) => [lon * mLon, lat * mLat];
  const toLL = ([x, y]) => [x / mLon, y / mLat];
  const cl = centerline.map(toXY);

  // Segments of the play line with cumulative arc length and unit direction.
  const seg = [];
  let total = 0;
  for (let i = 0; i < cl.length - 1; i++) {
    const dx = cl[i + 1][0] - cl[i][0], dy = cl[i + 1][1] - cl[i][1];
    const len = Math.hypot(dx, dy) || 1e-9;
    seg.push({ a: cl[i], ux: dx / len, uy: dy / len, len, s0: total });
    total += len;
  }
  if (total < 1) return null;

  // Nearest point on the play line → { s: arc length, d: signed offset (+left) }.
  const project = (p) => {
    let best = null, bestD = Infinity;
    for (const g of seg) {
      let t = (p[0] - g.a[0]) * g.ux + (p[1] - g.a[1]) * g.uy;
      t = Math.max(0, Math.min(g.len, t));
      const cx = g.a[0] + g.ux * t, cy = g.a[1] + g.uy * t;
      const dd = Math.hypot(p[0] - cx, p[1] - cy);
      if (dd < bestD) { bestD = dd; best = { s: g.s0 + t, d: (p[0] - cx) * -g.uy + (p[1] - cy) * g.ux }; }
    }
    return best;
  };
  // Point + left-normal on the play line at arc length s.
  const atS = (s) => {
    s = Math.max(0, Math.min(total, s));
    let g = seg[0];
    for (const h of seg) { if (s <= h.s0 + h.len) { g = h; break; } g = h; }
    const t = s - g.s0;
    return { p: [g.a[0] + g.ux * t, g.a[1] + g.uy * t], nx: -g.uy, ny: g.ux };
  };

  const BINS = 16;
  const bin = Array.from({ length: BINS }, () => ({ sum: 0, n: 0 }));
  let used = 0;
  for (const ring of fairwayRings) {
    for (const c of ring) {
      const pr = project(toXY(c));
      if (!pr || pr.s < -20 || pr.s > total + 20) continue;
      let k = Math.floor((pr.s / total) * BINS);
      k = Math.max(0, Math.min(BINS - 1, k));
      bin[k].sum += pr.d; bin[k].n++; used++;
    }
  }
  if (used < 6) return null;

  const spine = [centerline[0]];
  for (let k = 0; k < BINS; k++) {
    if (!bin[k].n) continue;
    const s = ((k + 0.5) / BINS) * total;
    const d = bin[k].sum / bin[k].n;       // fairway midline offset at this slice
    const a = atS(s);
    spine.push(toLL([a.p[0] + a.nx * d, a.p[1] + a.ny * d]));
  }
  spine.push(centerline[centerline.length - 1]);
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
  const route = fairwaySpine(centerline, fairways.map((f) => f.ring)) || centerline;

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
