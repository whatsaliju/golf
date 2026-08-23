// Cinematic flyover driven by map.jumpTo() per frame — a Catmull-Rom glide down
// the hole (looking ahead) that eases in closer, then an orbit around the green.
//
// This deliberately does NOT use MapLibre's FreeCamera API: FreeCamera +
// setTerrain is fragile (setFreeCameraOptions can throw once 3D terrain is on),
// which froze the camera while the flight timer kept running. jumpTo() with
// center/bearing/pitch/zoom is rock-solid with terrain and gives the same
// chase-cam-down-the-fairway look.

import { catmullRom, bearing as bearingOf, haversineMeters } from '../data/geo.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function buildFrames(hole, opts = {}) {
  // Orient the play line so the flight always ENDS at the green, regardless of
  // how the OSM hole line happened to be stored (tee→green or green→tee).
  const cl = hole.centerline.slice();
  const green = hole.greenCenter;
  if (cl.length >= 2 && haversineMeters(cl[0], green) < haversineMeters(cl[cl.length - 1], green)) {
    cl.reverse();
  }

  const N = opts.flightSamples ?? 240;
  const lengthM = (hole.yardage || 400) * 0.9144;

  // Stay close enough to see individual golf features. The old 14.4 travel zoom
  // framed almost the entire course and read like a satellite view rather than
  // a flyover. A small zoom change now simulates a steady low-altitude chase.
  const zTravel = clamp(17.15 - Math.log2(Math.max(lengthM, 180) / 360) * 0.18, 16.8, 17.35);
  const zGreen = zTravel + 0.45;
  const startAGL = clamp(lengthM * 0.1, 42, 68), endAGL = 24; // HUD readout only

  // Local travel direction (look down the hole); stable near the endpoints.
  const dirAt = (e) => bearingOf(catmullRom(cl, Math.max(e - 0.05, 0)), catmullRom(cl, Math.min(e + 0.05, 1)));

  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = easeInOut(t); // smooth accel out of the tee, decel into the green
    frames.push({
      center: catmullRom(cl, e), // sweeps tee → green along the play line
      bearing: dirAt(e),
      pitch: lerp(72, 76, e),
      zoom: lerp(zTravel, zGreen, e),
      agl: lerp(startAGL, endAGL, e),
    });
  }

  // Finish with a short reveal instead of spinning a full revolution. Keep the
  // same altitude as the arrival so the HUD and camera do not jump upward.
  const orbit = opts.orbitSamples ?? 45;
  const base = frames[frames.length - 1].bearing;
  for (let i = 1; i <= orbit; i++) {
    frames.push({ center: green, bearing: base + (i / orbit) * 65, pitch: 74, zoom: zGreen, agl: endAGL });
  }
  return frames;
}

export function createFlyover(map, hud) {
  let frames = [], hole = null, idx = 0, playing = false, speed = 1, raf = null, last = 0;
  let onDone = null;
  let holdUntil = 0;
  const PACE = 0.62; // <1 slows the flight so it reads as a cinematic flyover

  function apply(frame) {
    try {
      map.jumpTo({ center: frame.center, bearing: frame.bearing, pitch: frame.pitch, zoom: frame.zoom });
    } catch { /* transient (map not ready this frame); next frame retries */ }
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!frames.length) return;
    const dt = last ? (ts - last) / 16.67 : 1; last = ts;
    if (!playing) return; // idle → let the user pan/orbit freely after the flight
    if (ts < holdUntil) { apply(frames[Math.floor(idx)]); return; } // opening hold
    idx += speed * dt * PACE;
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
      holdUntil = performance.now() + (opts.holdMs ?? 1000); // hold the opening shot
      apply(frames[0]);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    replay(done) { idx = 0; playing = true; last = 0; holdUntil = performance.now() + 500; onDone = done || null; },
    setSpeed(s) { speed = s; },
    isReady: () => frames.length > 0,
  };
}
