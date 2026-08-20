import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, tileRangeForBbox, terrariumToMeters,
} from '../src/data/tiles.js';
import { makeProjection, haversineMeters } from '../src/data/projection.js';
import { parseOverpass, filterToCourse, pointInRing } from '../src/data/overpass.js';
import { assembleHole } from '../src/data/holeModel.js';

test('tile math round-trips', () => {
  const z = 14;
  for (const [lon, lat] of [[-87.72, 43.85], [0, 0], [12.3, -45.6]]) {
    assert.ok(Math.abs(tileXToLon(lonToTileX(lon, z), z) - lon) < 1e-6);
    assert.ok(Math.abs(tileYToLat(latToTileY(lat, z), z) - lat) < 1e-6);
  }
});

test('terrarium decode matches spec', () => {
  // sea level is encoded as (32768) → R=128,G=0,B=0
  assert.equal(terrariumToMeters(128, 0, 0), 0);
  assert.equal(terrariumToMeters(129, 0, 0), 256);
  assert.ok(Math.abs(terrariumToMeters(128, 100, 0) - 100) < 1e-9);
});

test('tileRangeForBbox is ordered and non-empty', () => {
  const r = tileRangeForBbox({ west: -87.74, south: 43.835, east: -87.70, north: 43.875 }, 14);
  assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0 && r.count > 0);
});

test('projection round-trips and scales sanely', () => {
  const proj = makeProjection({ lat: 43.85, lon: -87.72 });
  const [x, z] = proj.toLocal(-87.72, 43.85);
  assert.ok(Math.hypot(x, z) < 1e-6); // origin maps to ~0
  const [lon, lat] = proj.toLatLon(100, -100);
  const back = proj.toLocal(lon, lat);
  assert.ok(Math.abs(back[0] - 100) < 1e-3 && Math.abs(back[1] + 100) < 1e-3);
  // 0.003234° north ≈ 360 m
  const north = proj.toLocal(-87.72, 43.853234);
  assert.ok(Math.abs(-north[1] - 360) < 2); // z is negative going north
});

// ---- synthetic Overpass fixture --------------------------------------------
const O = { lat: 43.85, lon: -87.72 };
const square = (lon, lat, d) => [
  { lon: lon - d, lat: lat - d }, { lon: lon + d, lat: lat - d },
  { lon: lon + d, lat: lat + d }, { lon: lon - d, lat: lat + d },
  { lon: lon - d, lat: lat - d },
];
const greenLat = 43.853234; // ~360 m north of tee

const fixture = {
  elements: [
    { type: 'way', id: 1, tags: { leisure: 'golf_course', name: 'Whistling Straits' },
      geometry: square(-87.72, 43.8516, 0.01) },
    { type: 'way', id: 2, tags: { golf: 'hole', ref: '1', par: '4' },
      geometry: [{ lon: -87.72, lat: 43.85 }, { lon: -87.72, lat: greenLat }] },
    { type: 'way', id: 3, tags: { golf: 'tee', ref: '1' }, geometry: square(-87.72, 43.85, 0.0002) },
    { type: 'way', id: 4, tags: { golf: 'green', ref: '1' }, geometry: square(-87.72, greenLat, 0.0002) },
    { type: 'way', id: 5, tags: { golf: 'bunker' }, geometry: square(-87.7205, greenLat - 0.0004, 0.0001) },
    { type: 'way', id: 6, tags: { golf: 'fairway' }, geometry: square(-87.72, 43.8516, 0.0006) },
  ],
};

test('parseOverpass classifies and projects features', () => {
  const proj = makeProjection(O);
  const parsed = parseOverpass(fixture, proj);
  assert.equal(parsed.courses.length, 1);
  assert.equal(parsed.holes.length, 1);
  assert.equal(parsed.tees.length, 1);
  assert.equal(parsed.greens.length, 1);
  assert.equal(parsed.bunkers.length, 1);
  assert.equal(parsed.holes[0].ref, '1');
  // tee centroid ~ origin
  assert.ok(Math.hypot(...parsed.tees[0].center) < 5);
});

test('filterToCourse keeps features inside the named course', () => {
  const proj = makeProjection(O);
  const parsed = filterToCourse(parseOverpass(fixture, proj), 'Whistling Straits');
  assert.equal(parsed.holes.length, 1);
  assert.equal(parsed.greens.length, 1);
});

test('pointInRing basic', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.ok(pointInRing([5, 5], ring));
  assert.ok(!pointInRing([15, 5], ring));
});

test('assembleHole computes real yardage, orientation and elevation change', () => {
  const proj = makeProjection(O);
  const parsed = filterToCourse(parseOverpass(fixture, proj), 'Whistling Straits');
  // sampler: elevation rises going north (z more negative → higher)
  const sample = (x, z) => -z * 0.01;
  const hole = assembleHole(parsed, '1', sample);

  assert.equal(hole.par, 4);
  // 360 m ≈ 393.7 yd
  assert.ok(Math.abs(hole.yardage - 394) <= 3, `yardage ${hole.yardage}`);
  // tee end first (near origin), green end negative z
  assert.ok(Math.hypot(...hole.centerline[0]) < 5);
  assert.ok(hole.greenCenter[1] < -300);
  // green ~360 m north, +3.6 m → +12 ft
  assert.ok(Math.abs(hole.elevationChangeFt - 12) <= 1, `elev ${hole.elevationChangeFt}`);
  assert.ok(hole.bunkerRings.length === 1);
});

test('haversine sanity', () => {
  assert.ok(Math.abs(haversineMeters([-87.72, 43.85], [-87.72, 43.853234]) - 360) < 3);
});
