// Camera flight path — the same choreography as the original demo (Catmull-Rom
// spline down the hole, ease-in-out altitude descent, orbit-around-green
// finish), now driven by the real centerline and real ground elevation.

import * as THREE from 'three';

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Catmull-Rom on an array of [x,z] control points, param t in [0,1]. */
export function catmullRom2D(points, t) {
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

/**
 * @param hole      hole model (centerline, greenCenter, greenRing, yardage)
 * @param heightAt  (x,z)=>metres, scene-relative ground height
 * @returns {Array<{pos:THREE.Vector3, lookAt:THREE.Vector3, altitude:number}>}
 */
export function buildFlight(hole, heightAt, opts = {}) {
  const line = hole.centerline;
  const lengthM = hole.yardage * 0.9144;
  const startAlt = opts.startAlt ?? THREE.MathUtils.clamp(lengthM * 0.16, 60, 150);
  const endAlt = opts.endAlt ?? 16;
  const FLIGHT = opts.flightSamples ?? 280;
  const ORBIT = opts.orbitSamples ?? 90;

  const eps = 1e-3;
  const tangent = (t) => {
    const a = catmullRom2D(line, Math.max(0, t - eps));
    const b = catmullRom2D(line, Math.min(1, t + eps));
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };

  const frames = [];
  for (let i = 0; i <= FLIGHT; i++) {
    const t = i / FLIGHT;
    const camT = Math.min(t * 1.15, 1);
    const [cx, cz] = catmullRom2D(line, camT);
    const [tx, tz] = tangent(camT);
    const perp = [-tz, tx]; // left normal
    const lateral = Math.sin(t * Math.PI * 0.6) * 14;
    const behind = 14 * (1 - t);
    const altitude = THREE.MathUtils.lerp(startAlt, endAlt, easeInOut(Math.min(t * 1.05, 1)));
    const px = cx + perp[0] * lateral - tx * behind;
    const pz = cz + perp[1] * lateral - tz * behind;
    const pos = new THREE.Vector3(px, heightAt(cx, cz) + altitude, pz);

    const [lx, lz] = catmullRom2D(line, Math.min(camT + 0.06, 1));
    const lookAt = new THREE.Vector3(lx, heightAt(lx, lz) + 2, lz);
    frames.push({ pos, lookAt, altitude });
  }

  // Orbit finish around the green.
  const gc = hole.greenCenter;
  const greenY = heightAt(gc[0], gc[1]);
  const r = Math.max(38, greenRadius(hole) * 2.4);
  for (let i = 0; i <= ORBIT; i++) {
    const a = (i / ORBIT) * Math.PI * 1.4;
    const x = gc[0] + Math.cos(a) * r;
    const z = gc[1] + Math.sin(a) * r * 0.7;
    frames.push({
      pos: new THREE.Vector3(x, greenY + 22, z),
      lookAt: new THREE.Vector3(gc[0], greenY + 1, gc[1]),
      altitude: 22,
    });
  }
  return frames;
}

function greenRadius(hole) {
  if (!hole.greenRing || hole.greenRing.length < 3) return 15;
  const gc = hole.greenCenter;
  let max = 0;
  for (const [x, z] of hole.greenRing) max = Math.max(max, Math.hypot(x - gc[0], z - gc[1]));
  return max;
}
