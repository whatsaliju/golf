import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { HOLES, resolveHole } from './config/holes.js';
import { loadHole } from './data/loadHole.js';
import { imagerySource, TERRARIUM } from './data/endpoints.js';
import { createFlyover } from './scene/flyover.js';
import { createHud } from './scene/hud.js';
import { bearing, M_TO_FT } from './data/geo.js';

// ---- status overlay --------------------------------------------------------
const statusEl = document.getElementById('status');
const statusMsg = document.getElementById('status-msg');
const statusDetail = document.getElementById('status-detail');
const showStatus = (m, d = '') => { statusEl.classList.remove('hidden'); statusMsg.textContent = m; statusDetail.textContent = d; };
const hideStatus = () => statusEl.classList.add('hidden');

// ---- base style (real terrain + real imagery) ------------------------------
const firstCourse = resolveHole(HOLES[0]).course;
function baseStyle(imgName) {
  const img = imagerySource(imgName);
  return {
    version: 8,
    sources: {
      sat: { type: 'raster', tiles: img.tiles, tileSize: img.tileSize, maxzoom: img.maxzoom, attribution: img.attribution },
      dem: { type: 'raster-dem', tiles: TERRARIUM.tiles, tileSize: TERRARIUM.tileSize, encoding: TERRARIUM.encoding, maxzoom: TERRARIUM.maxzoom, attribution: TERRARIUM.attribution },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b1512' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: {
        'raster-fade-duration': 120,
        'raster-resampling': 'linear',
        'raster-saturation': 0.12,
        'raster-contrast': 0.1,
        'raster-brightness-min': 0.04,
        'raster-brightness-max': 0.96,
      } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
        'hillshade-exaggeration': 0.38,
        'hillshade-illumination-anchor': 'map',
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': '#162a20',
        'hillshade-highlight-color': '#d8d1b4',
        'hillshade-accent-color': '#416044',
      } },
    ],
    sky: {},
  };
}

const cx = (firstCourse.bbox.west + firstCourse.bbox.east) / 2;
const cy = (firstCourse.bbox.south + firstCourse.bbox.north) / 2;

const map = new maplibregl.Map({
  container: 'map',
  style: baseStyle(firstCourse.imagerySource),
  center: [cx, cy],
  zoom: 15,
  maxZoom: 24, // low-AGL flyover overzooms imagery while preserving terrain/geometry
  pitch: 65,
  maxPitch: 85,
  antialias: true,
  preserveDrawingBuffer: true, // enables canvas capture for the Record button
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

// Keep the canvas matched to the window. MapLibre can lock in a too-small size
// if the container hadn't reached full size when the map initialised (the map
// then fills only part of the screen), and mobile rotation / tab-switching can
// leave it stale. Re-measure on every viewport change and just after load.
const resizeMap = () => { try { map.resize(); } catch { /* map not ready yet */ } };
window.addEventListener('resize', resizeMap);
window.addEventListener('orientationchange', () => setTimeout(resizeMap, 250));
document.addEventListener('visibilitychange', () => { if (!document.hidden) resizeMap(); });
map.once('load', () => setTimeout(resizeMap, 0));

const hud = createHud();
const flyover = createFlyover(map, hud);

// ---- hole overlay layers ----------------------------------------------------
const OVERLAY_IDS = [
  'buildings-3d', 'canopy-3d', 'tree-trunks-3d', 'tree-crowns-3d', 'trees',
  'water-fill', 'water-line', 'fairway-fill', 'fairway-casing', 'fairway-line',
  'bunker-fill', 'bunker-casing', 'bunker-line', 'green-fill', 'green-line', 'tee-fill', 'tee-line', 'centerline', 'pin', 'teept',
  'flagstick-3d',
];
const SOURCE_IDS = ['fairways', 'greens', 'bunkers', 'water', 'tees', 'centerline', 'pin', 'teePoint',
  'buildings', 'canopy', 'ctxTrees', 'treeModels', 'flagstick'];

function clearOverlays() {
  for (const id of OVERLAY_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCE_IDS) if (map.getSource(id)) map.removeSource(id);
}

// tiny square (metres) around a lng/lat, for the extruded flagstick pole
function squareAround([lng, lat], m) {
  const dLat = m / 111320, dLon = m / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return [[lng - dLon, lat - dLat], [lng + dLon, lat - dLat], [lng + dLon, lat + dLat], [lng - dLon, lat + dLat], [lng - dLon, lat - dLat]];
}

// A real flagstick, draped on the terrain at the pin: a white pole plus a red
// cloth that streams toward `toward` (the tee) so the camera flying in sees it.
// Both are extrusions on the map, so they always sit on the green — unlike a
// screen-space DOM marker, which floats off pitched terrain.
function flagSource(center, toward) {
  const [clng, clat] = center;
  const mLat = 111320, mLon = 111320 * Math.cos((clat * Math.PI) / 180) || 1;
  let ux = (toward[0] - clng) * mLon, uy = (toward[1] - clat) * mLat;
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; // unit vector toward the tee
  const px = -uy, py = ux;                                 // perpendicular
  const M = (ex, ey) => [clng + ex / mLon, clat + ey / mLat];
  const w = 0.06, len = 1.5; // cloth 6 cm half-width, 1.5 m long
  const cloth = [M(px * w, py * w), M(ux * len + px * w, uy * len + py * w),
    M(ux * len - px * w, uy * len - py * w), M(-px * w, -py * w)];
  cloth.push(cloth[0]);
  return { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { color: '#f4f4ef', base: 0, height: 4.7 },
      geometry: { type: 'Polygon', coordinates: [squareAround(center, 0.07)] } },
    { type: 'Feature', properties: { color: '#c0392b', base: 3.4, height: 4.6 },
      geometry: { type: 'Polygon', coordinates: [cloth] } },
  ] };
}

function addOverlays(geo, ctx, hole) {
  for (const id of ['fairways', 'greens', 'bunkers', 'water', 'tees', 'centerline', 'pin', 'teePoint']) {
    map.addSource(id, { type: 'geojson', data: geo[id] });
  }
  map.addSource('buildings', { type: 'geojson', data: ctx.buildings });
  map.addSource('canopy', { type: 'geojson', data: ctx.canopy });
  map.addSource('ctxTrees', { type: 'geojson', data: ctx.trees });
  map.addSource('treeModels', { type: 'geojson', data: ctx.treeModels });
  map.addSource('flagstick', { type: 'geojson', data: flagSource(hole.greenCenter, hole.tee) });

  // 3D context first (extrusions), then draped hole overlays on top
  map.addLayer({ id: 'canopy-3d', type: 'fill-extrusion', source: 'canopy', paint: {
    'fill-extrusion-color': '#2f6b34', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0,
    'fill-extrusion-opacity': 0.85 } });
  map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', paint: {
    'fill-extrusion-color': '#c9c3b6', 'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'minHeight'], 'fill-extrusion-opacity': 0.95,
    'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'tree-trunks-3d', type: 'fill-extrusion', source: 'treeModels', paint: {
    'fill-extrusion-color': '#60452d', 'fill-extrusion-base': 0,
    'fill-extrusion-height': ['get', 'trunkTop'], 'fill-extrusion-opacity': 0.95 } });
  map.addLayer({ id: 'tree-crowns-3d', type: 'fill-extrusion', source: 'treeModels', paint: {
    'fill-extrusion-color': '#39723c', 'fill-extrusion-base': ['get', 'trunkTop'],
    'fill-extrusion-height': ['get', 'crownTop'], 'fill-extrusion-opacity': 0.9,
    'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'trees', type: 'circle', source: 'ctxTrees', paint: {
    'circle-radius': 3, 'circle-color': '#3f7a3f', 'circle-opacity': 0.85 } });
  map.addLayer({ id: 'water-fill', type: 'fill', source: 'water', paint: { 'fill-color': '#2b6ca3', 'fill-opacity': 0.45 } });
  map.addLayer({ id: 'water-line', type: 'line', source: 'water', paint: { 'line-color': '#8ecbff', 'line-width': 1.2, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'fairway-fill', type: 'fill', source: 'fairways', paint: { 'fill-color': '#72c565', 'fill-opacity': 0.2 } });
  // Crisp fairway outline so its shape reads clearly on the satellite imagery: a
  // dark casing under a bright edge, both scaled with zoom so the border stays
  // legible from the establishing height down to the low flyover pass.
  map.addLayer({ id: 'fairway-casing', type: 'line', source: 'fairways', layout: { 'line-join': 'round' }, paint: {
    'line-color': '#183a22', 'line-opacity': 0.6, 'line-blur': 0.3,
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2.6, 17, 5, 20, 8, 22, 10] } });
  map.addLayer({ id: 'fairway-line', type: 'line', source: 'fairways', layout: { 'line-join': 'round' }, paint: {
    'line-color': '#eaffdf', 'line-opacity': 0.95,
    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 17, 2.4, 20, 4.2, 22, 5.5] } });
  map.addLayer({ id: 'bunker-fill', type: 'fill', source: 'bunkers', paint: { 'fill-color': '#e4cd94', 'fill-opacity': 0.58 } });
  // A dark, soft casing reads as the recessed lip of the bunker; a bright thin
  // line on top is the sunlit sand rim — together they give the sand depth.
  map.addLayer({ id: 'bunker-casing', type: 'line', source: 'bunkers', layout: { 'line-join': 'round' }, paint: {
    'line-color': '#6f5a30', 'line-opacity': 0.6, 'line-blur': 0.8,
    'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 4, 21, 7] } });
  map.addLayer({ id: 'bunker-line', type: 'line', source: 'bunkers', layout: { 'line-join': 'round' }, paint: {
    'line-color': '#fbf1cf', 'line-opacity': 0.9,
    'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 1.8, 21, 3] } });
  map.addLayer({ id: 'green-fill', type: 'fill', source: 'greens', paint: { 'fill-color': '#72dc69', 'fill-opacity': 0.34 } });
  map.addLayer({ id: 'green-line', type: 'line', source: 'greens', paint: { 'line-color': '#d7ffd0', 'line-width': 2.4, 'line-opacity': 0.95 } });
  map.addLayer({ id: 'tee-fill', type: 'fill', source: 'tees', paint: { 'fill-color': '#d8ffd0', 'fill-opacity': 0.3 } });
  map.addLayer({ id: 'tee-line', type: 'line', source: 'tees', paint: {
    'line-color': '#f4fff1', 'line-width': 2.5, 'line-opacity': 1, 'line-blur': 0.15 } });
  map.addLayer({ id: 'centerline', type: 'line', source: 'centerline', paint: { 'line-color': '#f2bc72', 'line-width': 1.4, 'line-dasharray': [2, 3], 'line-opacity': 0.58 } });
  map.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 6, 'circle-color': '#c0392b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'teept', type: 'circle', source: 'teePoint', paint: {
    'circle-radius': 8, 'circle-color': '#f5fff2', 'circle-opacity': 0.95,
    'circle-stroke-color': '#24552a', 'circle-stroke-width': 3 } });
  // 3D flagstick (pole + cloth) draped on the green — colour/base/height are
  // per-feature so the one layer draws both parts.
  map.addLayer({ id: 'flagstick-3d', type: 'fill-extrusion', source: 'flagstick', paint: {
    'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 1 } });
}

// ---- elevation change from real terrain ------------------------------------
function fillElevation(data) {
  if (data.hole.elevationChangeFt != null) return; // baked already has it
  const te = map.queryTerrainElevation(data.hole.tee, { exaggerated: false });
  const ge = map.queryTerrainElevation(data.hole.greenCenter, { exaggerated: false });
  if (Number.isFinite(te) && Number.isFinite(ge)) {
    data.hole.elevationChangeFt = Math.round((ge - te) * M_TO_FT);
    hud.setHole(data.meta, data.hole);
  }
}

// ---- load + present a hole --------------------------------------------------
let holeIdx = 0;
let current = null;

async function present(i) {
  holeIdx = (i + HOLES.length) % HOLES.length;
  const resolved = resolveHole(HOLES[holeIdx]);
  showStatus('Fetching real course data…', resolved.title || '');

  const data = await loadHole(resolved, (m) => showStatus(m, resolved.title || ''));
  current = data;
  data.meta.attribution = data.meta.attribution || imagerySource(resolved.course.imagerySource).attribution;

  clearOverlays();
  addOverlays(data.geojson, data.context, data.hole);
  hud.setHole(data.meta, data.hole);

  const b = bearing(data.hole.tee, data.hole.greenCenter);
  map.jumpTo({
    center: [(data.hole.bbox.west + data.hole.bbox.east) / 2, (data.hole.bbox.south + data.hole.bbox.north) / 2],
    zoom: 15.4, pitch: 68, bearing: b,
  });

  // 3D context (buildings/trees) loads in the background and is dropped in when
  // ready — it never blocks the reveal.
  if (data.loadContext) {
    data.loadContext().then((ctx) => {
      if (!ctx || data !== current) return; // ignore if the user switched holes
      for (const [srcId, key] of [
        ['buildings', 'buildings'], ['canopy', 'canopy'], ['ctxTrees', 'trees'], ['treeModels', 'treeModels'],
      ]) {
        const s = map.getSource(srcId);
        if (s) s.setData(ctx[key]);
      }
    });
  }

  // Reveal on terrain 'idle', with a hard fallback so the overlay never hangs
  // (slow tiles / Overpass shouldn't leave the user staring at a spinner).
  let revealed = false;
  const reveal = () => {
    if (revealed || data !== current) return;
    revealed = true;
    // Hide the overlay FIRST — nothing below is allowed to keep the user on the
    // spinner. Elevation sampling and the camera can throw before terrain tiles
    // are ready; those are best-effort, never blockers.
    if (data.meta.source === 'placeholder') {
      showStatus('Live fetch failed — placeholder hole on real terrain', data.meta.reason || '');
      setTimeout(hideStatus, 2800);
    } else hideStatus();
    resizeMap(); // ensure the flight reads a full-screen canvas height, not a stale one
    try { fillElevation(data); } catch (e) { console.warn('elevation:', e); }
    try { flyover.load(data.hole); } catch (e) { console.warn('flyover:', e); }
  };
  map.once('idle', reveal);
  setTimeout(reveal, 7000);
}

// ---- controls ---------------------------------------------------------------
document.getElementById('playBtn').onclick = () => flyover.replay();
let speed = 1;
document.getElementById('speedBtn').onclick = (e) => {
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
  flyover.setSpeed(speed);
  e.target.textContent = `Speed: ${speed}x`;
};

let relief = 1.5; // default: dunes read without touching the button
document.getElementById('reliefBtn').onclick = (e) => {
  relief = relief === 1.5 ? 2 : relief === 2 ? 1 : 1.5;
  try { map.setTerrain({ source: 'dem', exaggeration: relief }); } catch (err) { console.warn(err); }
  e.target.textContent = `Relief: ${relief}x`;
};

const holeBtn = document.getElementById('holeBtn');
if (HOLES.length < 2) holeBtn.style.display = 'none';
holeBtn.onclick = () => present(holeIdx + 1);

// ---- one-click flyover recording (canvas → .webm) --------------------------
let recorder = null;
const recBtn = document.getElementById('recBtn');
function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}
recBtn.onclick = () => {
  if (recorder && recorder.state === 'recording') { stopRecording(); return; }
  const canvas = map.getCanvas();
  const stream = typeof canvas.captureStream === 'function' ? canvas.captureStream(30) : null;
  if (!stream || typeof MediaRecorder === 'undefined') { alert('Recording is not supported in this browser.'); return; }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  recorder.onstop = () => {
    recBtn.textContent = '● Record';
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(current?.meta?.title || 'flyover').replace(/[^\w]+/g, '-').toLowerCase()}-hole${current?.hole?.ref || ''}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  recorder.start();
  recBtn.textContent = '■ Stop';
  flyover.replay(() => stopRecording()); // record a fresh flight, auto-stop at the end
};

// ---- go ---------------------------------------------------------------------
// Boot as soon as the style is parsed — NOT gated on `load`. MapLibre's `load`
// event only fires once the tile sources have loaded, so if a tile host is slow
// or blocked (the DEM source needs CORS), `load` never fires and the app would
// hang forever on the loading spinner. Adding GeoJSON sources/layers and running
// the flyover only needs the style parsed; imagery/terrain fill in as they load.
let booted = false;
function boot() {
  if (booted) return;
  booted = true;

  try { map.setTerrain({ source: 'dem', exaggeration: relief }); } catch (e) { console.warn('terrain:', e); }
  try {
    map.setSky({
      'sky-color': '#83aec6', 'horizon-color': '#ecd6ac', 'fog-color': '#d2d6c9',
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.5, 'atmosphere-blend': 0.85,
    });
  } catch (e) { console.warn('sky:', e); }
  // Warm, low afternoon sun (30° above the horizon) for long turf shadows.
  try { map.setLight({ anchor: 'map', color: '#ffe7bd', intensity: 0.6, position: [1.5, 300, 30] }); } catch (e) { console.warn('light:', e); }

  const shimmer = () => {
    if (map.getLayer('water-fill')) {
      map.setPaintProperty('water-fill', 'fill-opacity', 0.42 + Math.sin(performance.now() / 900) * 0.06);
    }
    requestAnimationFrame(shimmer);
  };
  requestAnimationFrame(shimmer);

  present(0).catch((err) => { console.error(err); showStatus('Failed to initialise', String(err && err.message)); });
}

// Trigger boot from whichever fires first: the normal `load`, the earlier
// `styledata` (style parsed — sources can be added even before tiles finish),
// or a hard timeout so nothing can leave the user staring at a spinner.
if (map.isStyleLoaded()) boot();
map.on('load', boot);
map.on('styledata', boot);
setTimeout(boot, 3500);
