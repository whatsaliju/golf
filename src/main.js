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
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 200 } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#12261c' } },
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
  pitch: 65,
  maxPitch: 85,
  antialias: true,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

const hud = createHud();
const flyover = createFlyover(map, hud);

// ---- hole overlay layers ----------------------------------------------------
const OVERLAY_IDS = [
  'water-fill', 'water-line', 'fairway-fill', 'fairway-line', 'bunker-fill', 'bunker-line',
  'green-fill', 'green-line', 'tee-line', 'centerline', 'pin', 'teept',
];
const SOURCE_IDS = ['fairways', 'greens', 'bunkers', 'water', 'tees', 'centerline', 'pin', 'teePoint'];

function clearOverlays() {
  for (const id of OVERLAY_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCE_IDS) if (map.getSource(id)) map.removeSource(id);
}

function addOverlays(geo) {
  for (const id of SOURCE_IDS) map.addSource(id, { type: 'geojson', data: geo[id] });
  map.addLayer({ id: 'water-fill', type: 'fill', source: 'water', paint: { 'fill-color': '#2b6ca3', 'fill-opacity': 0.45 } });
  map.addLayer({ id: 'water-line', type: 'line', source: 'water', paint: { 'line-color': '#8ecbff', 'line-width': 1.2, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'fairway-fill', type: 'fill', source: 'fairways', paint: { 'fill-color': '#63b356', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'fairway-line', type: 'line', source: 'fairways', paint: { 'line-color': '#9be08a', 'line-width': 1, 'line-opacity': 0.5 } });
  map.addLayer({ id: 'bunker-fill', type: 'fill', source: 'bunkers', paint: { 'fill-color': '#e6d3a3', 'fill-opacity': 0.5 } });
  map.addLayer({ id: 'bunker-line', type: 'line', source: 'bunkers', paint: { 'line-color': '#f0e4c0', 'line-width': 1, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'green-fill', type: 'fill', source: 'greens', paint: { 'fill-color': '#6aab5f', 'fill-opacity': 0.35 } });
  map.addLayer({ id: 'green-line', type: 'line', source: 'greens', paint: { 'line-color': '#bfffb0', 'line-width': 1.5 } });
  map.addLayer({ id: 'tee-line', type: 'line', source: 'tees', paint: { 'line-color': '#eef2ee', 'line-width': 1.2, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'centerline', type: 'line', source: 'centerline', paint: { 'line-color': '#e8a355', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 6, 'circle-color': '#c0392b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'teept', type: 'circle', source: 'teePoint', paint: { 'circle-radius': 5, 'circle-color': '#eef2ee', 'circle-stroke-color': '#1a2a1e', 'circle-stroke-width': 1.5 } });
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
  addOverlays(data.geojson);
  hud.setHole(data.meta, data.hole);

  const b = bearing(data.hole.tee, data.hole.greenCenter);
  map.jumpTo({
    center: [(data.hole.bbox.west + data.hole.bbox.east) / 2, (data.hole.bbox.south + data.hole.bbox.north) / 2],
    zoom: 15.4, pitch: 68, bearing: b,
  });

  // wait for terrain tiles before sampling elevation / starting the flight
  map.once('idle', () => {
    fillElevation(data);
    flyover.load(data.hole);
    if (data.meta.source === 'placeholder') { showStatus('Live fetch failed — placeholder hole on real terrain', data.meta.reason || ''); setTimeout(hideStatus, 2800); }
    else hideStatus();
  });
}

// ---- controls ---------------------------------------------------------------
document.getElementById('playBtn').onclick = () => flyover.replay();
let speed = 1;
document.getElementById('speedBtn').onclick = (e) => {
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
  flyover.setSpeed(speed);
  e.target.textContent = `Speed: ${speed}x`;
};
const holeBtn = document.getElementById('holeBtn');
if (HOLES.length < 2) holeBtn.style.display = 'none';
holeBtn.onclick = () => present(holeIdx + 1);

// ---- go ---------------------------------------------------------------------
map.on('load', () => {
  try { map.setTerrain({ source: 'dem', exaggeration: 1.0 }); } catch (e) { console.warn('terrain:', e); }
  try {
    map.setSky({
      'sky-color': '#0d2430', 'horizon-color': '#3d6b5c', 'fog-color': '#2b3f3a',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0.7,
    });
  } catch (e) { console.warn('sky:', e); }
  present(0).catch((err) => { console.error(err); showStatus('Failed to initialise', String(err && err.message)); });
});
