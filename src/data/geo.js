// Geodesy helpers in lng/lat space. MapLibre consumes lng/lat directly, so —
// unlike the earlier Three.js build — we keep geometry in degrees and only drop
// to metres for distance/length. Pure module: unit-tested, no DOM.

const DEG = Math.PI / 180;
const R = 6371008.8; // mean Earth radius, metres
export const M_TO_YD = 1 / 0.9144;
export const M_TO_FT = 3.280839895;

/** Great-circle distance between [lng,lat] points, metres. */
export function haversineMeters(a, b) {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const la1 = a[1] * DEG, la2 = b[1] * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Total length of a lng/lat polyline, metres. */
export function pathLengthMeters(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversineMeters(pts[i - 1], pts[i]);
  return s;
}

/** Area-weighted centroid of a lng/lat ring; vertex-average fallback. */
export function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length || 1;
    return ring.reduce(([sx, sy], [x, y]) => [sx + x / n, sy + y / n], [0, 0]);
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * Representative centre of a feature's geometry. Uses the true area centroid
 * for closed polygons, and a plain vertex mean for open lines (e.g. a
 * `golf=hole` centreline, where the polygon-area formula is meaningless).
 */
export function ringCenter(ring) {
  const n = ring.length;
  const closed = n >= 4 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  if (closed) return centroid(ring);
  let x = 0, y = 0;
  for (const [a, b] of ring) { x += a; y += b; }
  return [x / n, y / n];
}

/** Even-odd point-in-ring for [lng,lat]. */
export function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Initial bearing a→b, degrees (0=N, 90=E). */
export function bearing(a, b) {
  const φ1 = a[1] * DEG, φ2 = b[1] * DEG, Δλ = (b[0] - a[0]) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Catmull-Rom interpolation over lng/lat control points, param t∈[0,1].
 * The hole spans a few hundred metres, so treating lng/lat as planar here is
 * well within a metre — fine for a smooth camera path.
 */
export function catmullRom(points, t) {
  const n = points.length - 1;
  const seg = Math.min(Math.floor(t * n), n - 1);
  const lt = t * n - seg;
  const p0 = points[Math.max(seg - 1, 0)];
  const p1 = points[seg];
  const p2 = points[Math.min(seg + 1, n)];
  const p3 = points[Math.min(seg + 2, n)];
  const cr = (a, b, c, d) => {
    const t2 = lt * lt, t3 = t2 * lt;
    return 0.5 * (2 * b + (-a + c) * lt + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

/** Densify a lng/lat polyline via Catmull-Rom into `samples` points. */
export function densify(points, samples = 200) {
  if (points.length < 2) return points.slice();
  const out = [];
  for (let i = 0; i <= samples; i++) out.push(catmullRom(points, i / samples));
  return out;
}

/** Bounding box {west,south,east,north} of many lng/lat point sets, padded (m). */
export function bboxOf(sets, padMeters = 60) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const set of sets) for (const [x, y] of set) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  const dLat = padMeters / 111320;
  const dLon = padMeters / (111320 * Math.cos(((s + n) / 2) * DEG) || 1);
  return { west: w - dLon, south: s - dLat, east: e + dLon, north: n + dLat };
}
