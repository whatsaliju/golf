// Cinematic flyover via MapLibre's FreeCamera API — the same choreography as the
// original demo (Catmull-Rom down the hole, ease-in-out altitude descent,
// orbit-around-green finish), now over real 3D terrain.

import { MercatorCoordinate } from 'maplibre-gl';
import { densify, catmullRom, haversineMeters } from '../data/geo.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// metres → degrees offset near a latitude
const offsetDeg = (lngLat, east, north) => {
  const dLat = north / 111320;
  const dLon = east / (111320 * Math.cos((lngLat[1] * Math.PI) / 180) || 1);
  return [lngLat[0] + dLon, lngLat[1] + dLat];
};

function buildFrames(hole, opts) {
  const line = densify(hole.centerline, opts.flightSamples ?? 260);
  const lengthM = hole.yardage * 0.9144;
  const startAGL = clamp(lengthM * 0.16, 55, 150);
  const endAGL = 26;
  const frames = [];

  for (let i = 0; i < line.length; i++) {
    const t = i / (line.length - 1);
    const camT = Math.min(t * 1.12, 1);
    const p = catmullRom(hole.centerline, camT);
    const ahead = catmullRom(hole.centerline, Math.min(camT + 0.05, 1));
    // tangent (metres) for behind/lateral offsets
    const mLon = 111320 * Math.cos((p[1] * Math.PI) / 180);
    let tx = (ahead[0] - p[0]) * mLon, ty = (ahead[1] - p[1]) * 111320;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const lateral = Math.sin(t * Math.PI * 0.6) * 12;
    const behind = 16 * (1 - t) + 6;
    const east = -tx * behind + -ty * lateral;
    const north = -ty * behind + tx * lateral;
    frames.push({
      cam: offsetDeg(p, east, north),
      target: ahead,
      agl: clamp(startAGL + (endAGL - startAGL) * easeInOut(Math.min(t * 1.05, 1)), endAGL, startAGL),
    });
  }

  // orbit around the green
  const gc = hole.greenCenter;
  const orbit = opts.orbitSamples ?? 110;
  const r = 55;
  for (let i = 0; i <= orbit; i++) {
    const a = (i / orbit) * Math.PI * 1.5;
    frames.push({ cam: offsetDeg(gc, Math.cos(a) * r, Math.sin(a) * r * 0.7), target: gc, agl: 40 });
  }
  return frames;
}

export function createFlyover(map, hud) {
  let frames = [], hole = null, idx = 0, playing = false, speed = 1, raf = null, last = 0;
  let onDone = null;

  const groundAt = (lngLat) => {
    const e = map.queryTerrainElevation(lngLat, { exaggerated: false });
    return Number.isFinite(e) ? e : 0;
  };

  function apply(frame) {
    const cam = map.getFreeCameraOptions();
    const alt = groundAt(frame.cam) + frame.agl;
    cam.position = MercatorCoordinate.fromLngLat(frame.cam, alt);
    cam.lookAtPoint(frame.target);
    map.setFreeCameraOptions(cam);
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!frames.length) return;
    const dt = last ? (ts - last) / 16.67 : 1; last = ts;
    if (!playing) return; // idle → let the user pan/orbit freely after the flight
    idx += speed * dt;
    let finished = false;
    if (idx >= frames.length - 1) { idx = frames.length - 1; playing = false; finished = true; }
    const frame = frames[Math.floor(idx)];
    apply(frame);
    const progress = Math.floor(idx) / (frames.length - 1);
    hud.update({ altitude: frame.agl }, progress, hole);
    if (finished && onDone) { const cb = onDone; onDone = null; cb(); }
  }

  return {
    load(h, opts = {}) {
      hole = h;
      frames = buildFrames(h, opts);
      idx = 0; playing = true; last = 0;
      apply(frames[0]);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    replay(done) { idx = 0; playing = true; onDone = done || null; },
    setSpeed(s) { speed = s; },
    isReady: () => frames.length > 0,
  };
}
