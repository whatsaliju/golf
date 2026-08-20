import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, tileRangeForBbox, terrariumToMeters,
} from '../src/data/tiles.js';
import {
  haversineMeters, pathLengthMeters, centroid, pointInRing, bearing, catmullRom, bboxOf,
} from '../src/data/geo.js';
import { parseOverpass, filterToCourse, parseContext } from '../src/data/overpass.js';
import { assembleHole } from '../src/data/holeModel.js';
import { holeToGeoJSON, contextToGeoJSON } from '../src/data/holeGeoJSON.js';

test('tile math round-trips', () => {
  const z = 14;
  for (const [lon, lat] of [[-87.72, 43.85], [0, 0], [12.3, -45.6]]) {
    assert.ok(Math.abs(tileXToLon(lonToTileX(lon, z), z) - lon) < 1e-6);
    assert.ok(Math.abs(tileYToLat(latToTileY(lat, z), z) - lat) < 1e-6);
  }
});

test('terrarium decode matches spec', () => {
  assert.equal(terrariumToMeters(128, 0, 0), 0);
  assert.equal(terrariumToMeters(129, 0, 0), 256);
  assert.ok(Math.abs(terrariumToMeters(128, 100, 0) - 100) < 1e-9);
});

test('tileRangeForBbox is ordered and non-empty', () => {
  const r = tileRangeForBbox({ west: -87.74, south: 43.835, east: -87.70, north: 43.875 }, 14);
  assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0 && r.count > 0);
});

test('geo distance/length/bearing sane', () => {
  assert.ok(Math.abs(haversineMeters([-87.72, 43.85], [-87.72, 43.853234]) - 360) < 3);
  assert.ok(Math.abs(pathLengthMeters([[0, 0], [0, 0.001], [0, 0.002]]) - haversineMeters([0, 0], [0, 0.002])) < 1);
  assert.ok(Math.abs(bearing([-87.72, 43.85], [-87.72, 43.86]) - 0) < 0.5); // due north
});

test('centroid, pointInRing, catmullRom, bbox', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const c = centroid(ring);
  assert.ok(Math.abs(c[0] - 5) < 1e-6 && Math.abs(c[1] - 5) < 1e-6);
  assert.ok(pointInRing([5, 5], ring) && !pointInRing([15, 5], ring));
  const pts = [[0, 0], [1, 1], [2, 0], [3, 1]];
  assert.deepEqual(catmullRom(pts, 0).map(Math.round), [0, 0]);
  assert.deepEqual(catmullRom(pts, 1).map(Math.round), [3, 1]);
  const bb = bboxOf([ring], 0);
  assert.deepEqual([bb.west, bb.south, bb.east, bb.north], [0, 0, 10, 10]);
});

// ---- synthetic Overpass fixture (lng/lat) ----------------------------------
const square = (lon, lat, d) => [
  { lon: lon - d, lat: lat - d }, { lon: lon + d, lat: lat - d },
  { lon: lon + d, lat: lat + d }, { lon: lon - d, lat: lat + d }, { lon: lon - d, lat: lat - d },
];
const greenLat = 43.853234; // ~360 m north of tee

const fixture = {
  elements: [
    { type: 'way', id: 1, tags: { leisure: 'golf_course', name: 'Whistling Straits' }, geometry: square(-87.72, 43.8516, 0.01) },
    { type: 'way', id: 2, tags: { golf: 'hole', ref: '1', par: '4' }, geometry: [{ lon: -87.72, lat: 43.85 }, { lon: -87.72, lat: greenLat }] },
    { type: 'way', id: 3, tags: { golf: 'tee', ref: '1' }, geometry: square(-87.72, 43.85, 0.0002) },
    { type: 'way', id: 4, tags: { golf: 'green', ref: '1' }, geometry: square(-87.72, greenLat, 0.0002) },
    { type: 'way', id: 5, tags: { golf: 'bunker' }, geometry: square(-87.7205, greenLat - 0.0004, 0.0001) },
    { type: 'way', id: 6, tags: { golf: 'fairway' }, geometry: square(-87.72, 43.8516, 0.0006) },
  ],
};

test('parseOverpass classifies + keeps lng/lat', () => {
  const parsed = parseOverpass(fixture);
  assert.equal(parsed.courses.length, 1);
  assert.equal(parsed.holes.length, 1);
  assert.equal(parsed.tees.length, 1);
  assert.equal(parsed.greens.length, 1);
  assert.equal(parsed.bunkers.length, 1);
  assert.equal(parsed.holes[0].ref, '1');
  assert.ok(Math.abs(parsed.tees[0].center[0] + 87.72) < 1e-4);
});

test('filterToCourse keeps features inside the named course', () => {
  const parsed = filterToCourse(parseOverpass(fixture), 'Whistling Straits');
  assert.equal(parsed.holes.length, 1);
  assert.equal(parsed.greens.length, 1);
});

test('assembleHole computes real yardage, orientation and elevation', () => {
  const parsed = filterToCourse(parseOverpass(fixture), 'Whistling Straits');
  const sample = (lng, lat) => (lat - 43.85) * 1113; // ~+3.6 m at the green
  const hole = assembleHole(parsed, '1', sample);

  assert.equal(hole.par, 4);
  assert.ok(Math.abs(hole.yardage - 394) <= 3, `yardage ${hole.yardage}`);
  assert.ok(haversineMeters(hole.centerline[0], [-87.72, 43.85]) < 5); // tee end first
  assert.ok(hole.greenCenter[1] > 43.852);
  assert.ok(Math.abs(hole.elevationChangeFt - 12) <= 1, `elev ${hole.elevationChangeFt}`);
  assert.equal(hole.bunkerRings.length, 1);
});

test('parseContext + contextToGeoJSON classify buildings/canopy/trees', () => {
  const ctxJson = {
    elements: [
      { type: 'way', id: 10, tags: { building: 'yes', 'building:levels': '2' }, geometry: [{ lon: 0, lat: 0 }, { lon: 0.001, lat: 0 }, { lon: 0.001, lat: 0.001 }, { lon: 0, lat: 0.001 }] },
      { type: 'way', id: 11, tags: { natural: 'wood' }, geometry: [{ lon: 1, lat: 1 }, { lon: 1.001, lat: 1 }, { lon: 1.001, lat: 1.001 }, { lon: 1, lat: 1.001 }] },
      { type: 'node', id: 12, tags: { natural: 'tree' }, lon: 2, lat: 2 },
    ],
  };
  const ctx = parseContext(ctxJson);
  assert.equal(ctx.buildings.length, 1);
  assert.ok(Math.abs(ctx.buildings[0].height - 6.4) < 0.01); // 2 levels * 3.2
  assert.equal(ctx.canopy.length, 1);
  assert.deepEqual(ctx.trees[0], [2, 2]);
  const gj = contextToGeoJSON(ctx);
  assert.equal(gj.buildings.features[0].properties.height, ctx.buildings[0].height);
  assert.equal(gj.trees.features[0].geometry.type, 'Point');
});

test('holeToGeoJSON produces valid closed polygons + linestring', () => {
  const parsed = filterToCourse(parseOverpass(fixture), 'Whistling Straits');
  const hole = assembleHole(parsed, '1', null);
  const geo = holeToGeoJSON(hole);
  assert.equal(geo.centerline.features[0].geometry.type, 'LineString');
  const g = geo.greens.features[0].geometry.coordinates[0];
  assert.deepEqual(g[0], g[g.length - 1]); // ring closed
  assert.equal(geo.pin.features[0].geometry.type, 'Point');
});
