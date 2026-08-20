import * as THREE from 'three';
import { HOLES, resolveHole } from './config/holes.js';
import { loadHole } from './data/loadHole.js';
import { buildWorld } from './scene/world.js';
import { buildFlight } from './scene/flight.js';
import { createHud } from './scene/hud.js';

// ---- renderer / scene / camera ---------------------------------------------
const wrap = document.getElementById('canvas-wrap');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2b3f3a, 0.0016);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 8000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
wrap.appendChild(renderer.domElement);

// sky dome
(function sky() {
  const geo = new THREE.SphereGeometry(5000, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(0x0d2430) }, bottom: { value: new THREE.Color(0x3d6b5c) } },
    vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vPos; uniform vec3 top; uniform vec3 bottom;
      void main(){ float h=normalize(vPos).y; float t=smoothstep(-0.05,0.5,h);
      gl_FragColor=vec4(mix(bottom,top,t),1.0);} `,
  });
  scene.add(new THREE.Mesh(geo, mat));
})();
scene.add(new THREE.HemisphereLight(0xbfd8c8, 0x1a2a1e, 0.95));
const sun = new THREE.DirectionalLight(0xffe0b0, 1.1);
sun.position.set(-300, 260, 150);
scene.add(sun);

// ---- HUD + status ----------------------------------------------------------
const hud = createHud();
const statusEl = document.getElementById('status');
const statusMsg = document.getElementById('status-msg');
const statusDetail = document.getElementById('status-detail');
const showStatus = (msg, detail = '') => {
  statusEl.classList.remove('hidden');
  statusMsg.textContent = msg;
  statusDetail.textContent = detail;
};
const hideStatus = () => statusEl.classList.add('hidden');

// ---- flight state ----------------------------------------------------------
let worldGroup = null;
let flight = [];
let currentHole = null;
let flightIndex = 0;
let playing = false;
let speed = 1;
let holeIdx = 0;

function disposeWorld() {
  if (!worldGroup) return;
  scene.remove(worldGroup);
  worldGroup.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
  worldGroup = null;
}

async function loadIndex(i) {
  holeIdx = (i + HOLES.length) % HOLES.length;
  const resolved = resolveHole(HOLES[holeIdx]);
  showStatus('Fetching real course data…', resolved.title || '');
  playing = false;

  const data = await loadHole(resolved, (m) => showStatus(m, resolved.title || ''));

  disposeWorld();
  const world = buildWorld(data);
  worldGroup = world.group;
  scene.add(worldGroup);

  flight = buildFlight(data.hole, world.heightAt);
  currentHole = data.hole;
  hud.setHole(data.meta, data.hole);

  flightIndex = 0;
  playing = true;
  if (data.meta.source === 'placeholder') {
    showStatus('Live fetch failed — showing placeholder', data.meta.reason || '');
    setTimeout(hideStatus, 2600);
  } else {
    hideStatus();
  }
}

// ---- controls --------------------------------------------------------------
document.getElementById('playBtn').onclick = () => { flightIndex = 0; playing = true; };
document.getElementById('speedBtn').onclick = (e) => {
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
  e.target.textContent = `Speed: ${speed}x`;
};
document.getElementById('holeBtn').onclick = () => { if (HOLES.length > 1) loadIndex(holeIdx + 1); };
if (HOLES.length < 2) document.getElementById('holeBtn').style.display = 'none';

// ---- render loop -----------------------------------------------------------
function render() {
  requestAnimationFrame(render);
  if (!flight.length) { renderer.render(scene, camera); return; }

  if (playing) {
    flightIndex += speed;
    if (flightIndex >= flight.length - 1) { flightIndex = flight.length - 1; playing = false; }
  }
  const frame = flight[Math.floor(flightIndex)];
  camera.position.copy(frame.pos);
  camera.lookAt(frame.lookAt);

  const progress = Math.floor(flightIndex) / (flight.length - 1);
  hud.update(frame, progress, currentHole);
  renderer.render(scene, camera);
}
render();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- go --------------------------------------------------------------------
loadIndex(0).catch((e) => {
  console.error(e);
  showStatus('Failed to initialise', String(e && e.message));
});
