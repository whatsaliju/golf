// Cinematic flyover driven by map.jumpTo() per frame — a Catmull-Rom glide down
// the hole (looking ahead) that eases in closer, then an orbit around the green.
//
// This deliberately does NOT use MapLibre's FreeCamera API: FreeCamera +
// setTerrain is fragile (setFreeCameraOptions can throw once 3D terrain is on),
// which froze the camera while the flight timer kept running. jumpTo() with
// center/bearing/pitch/zoom is rock-solid with terrain and gives the same
// chase-cam-down-the-fairway look.

import { densify, catmullRom, bearing as bearingOf } from '../data/geo.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function buildFrames(hole, opts) {
  const centerline = hole.centerline;
  const N = opts.flightSamples ?? 240;
  const lengthM = (hole.yardage || 400) * 0.9144;

  // Wider (lower zoom) opening for longer holes so the whole hole is in frame.
  const startZoom = clamp(16.4 - Math.log2(Math.max(lengthM, 120) / 90), 14.2, 15.6);
  const endZoom = startZoom + 1.4;
  const startPitch = 58, endPitch = 67;
  const startAGL = clamp(lengthM * 0.16, 55, 150), endAGL = 26; // HUD readout only

  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = easeInOut(t);
    const camT = Math.min(t * 1.08, 1);
    const p = catmullRom(centerline, camT);
    const ahead = catmullRom(centerline, Math.min(camT + 0.05, 1));
    // Center slightly ahead so we look down the hole; bearing = travel direction.
    const center = catmullRom(centerline, Math.min(camT + 0.03, 1));
    frames.push({
      center,
      bearing: bearingOf(p, ahead),
      pitch: lerp(startPitch, endPitch, e),
      zoom: lerp(startZoom, endZoom, e),
      agl: lerp(startAGL, endAGL, e),
    });
  }

  // Orbit the green: hold center on the pin and sweep the bearing around it.
  const gc = hole.greenCenter;
  const orbit = opts.orbitSamples ?? 120;
  const baseBearing = frames.length ? frames[frames.length - 1].bearing : 0;
  for (let i = 1; i <= orbit; i++) {
    frames.push({
      center: gc,
      bearing: baseBearing + (i / orbit) * 500,
      pitch: 64,
      zoom: endZoom,
      agl: 40,
    });
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
