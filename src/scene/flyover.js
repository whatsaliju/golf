// Cinematic flyover driven by map.jumpTo() per frame — a Catmull-Rom glide down
// the hole that starts with an establishing look and finishes over the green.
//
// This deliberately does NOT use MapLibre's FreeCamera API: FreeCamera +
// setTerrain is fragile (setFreeCameraOptions can throw once 3D terrain is on),
// which froze the camera while the flight timer kept running. jumpTo() with
// center/bearing/pitch/zoom is rock-solid with terrain and gives the same
// chase-cam-down-the-fairway look.

import { catmullRom, bearing as bearingOf, haversineMeters } from '../data/geo.js';

// Quintic smootherstep has zero velocity and acceleration at both ends. That
// avoids the abrupt launch the quadratic easing produced after the opening hold.
const easeInOut = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

// MapLibre derives camera height from zoom, viewport height, latitude and pitch.
// Inverting that relationship lets us request a real height above the terrain
// instead of displaying an AGL number that has no connection to the camera.
function zoomForAGL([, lat], aglFt, pitch, viewportHeight) {
  const altitudeM = aglFt / 3.28084;
  const cameraDistancePx = viewportHeight * 1.5; // MapLibre's default 36.87° FOV
  const groundMetersPerWorldPixel = Math.cos((lat * Math.PI) / 180) * EARTH_CIRCUMFERENCE_M / 512;
  return Math.log2(
    Math.cos((pitch * Math.PI) / 180) * cameraDistancePx * groundMetersPerWorldPixel / altitudeM
  );
}

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
  const viewportHeight = opts.viewportHeight ?? 900;
  // A golf-hole establishing pass is more useful around 160–220 ft than at the
  // previous 65–85 ft: it keeps the tee, landing area, hazards, and green in
  // context while remaining far below a course-wide aerial view.
  const startAGL = clamp(lengthM * 0.42, 160, 220), endAGL = 110;

  // Local travel direction (look down the hole); stable near the endpoints.
  const dirAt = (e) => bearingOf(catmullRom(cl, Math.max(e - 0.05, 0)), catmullRom(cl, Math.min(e + 0.05, 1)));

  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = easeInOut(t); // smooth accel out of the tee, decel into the green
    const center = catmullRom(cl, e);
    const pitch = lerp(48, 55, e);
    const agl = lerp(startAGL, endAGL, e);
    frames.push({
      center, // sweeps tee → green along the play line
      bearing: dirAt(e),
      pitch,
      zoom: zoomForAGL(center, agl, pitch, viewportHeight),
      agl,
    });
  }

  // Stop over the green. Rotating around a stationary center reads as a map
  // spin, not flight, and made the camera appear to climb after the approach.
  return frames;
}

export function createFlyover(map, hud) {
  let frames = [], hole = null, idx = 0, playing = false, speed = 1, raf = null, last = 0;
  let onDone = null;
  let holdUntil = 0;
  const PACE = 0.48; // deliberate enough to read hazards and the intended route

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
    const frame = frameAt(idx);
    apply(frame);
    const progress = Math.floor(idx) / (frames.length - 1);
    hud.update({ altitudeFt: frame.agl }, progress, hole);
    if (finished && onDone) { const cb = onDone; onDone = null; cb(); }
  }

  return {
    load(h, opts = {}) {
      hole = h;
      frames = buildFrames(h, { viewportHeight: map.getCanvas().clientHeight, ...opts });
      idx = 0; playing = true; last = 0;
      holdUntil = performance.now() + (opts.holdMs ?? 1800); // establish the tee and route
      apply(frames[0]);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    replay(done) { idx = 0; playing = true; last = 0; holdUntil = performance.now() + 1200; onDone = done || null; },
    setSpeed(s) { speed = s; },
    isReady: () => frames.length > 0,
  };
}
