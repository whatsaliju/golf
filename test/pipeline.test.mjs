import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, tileRangeForBbox, terrariumToMeters,
} from '../src/data/tiles.js';
import {
  haversineMeters, pathLengthMeters, centroid, pointInRing, bearing, catmullRom, bboxOf,
} from '../src/data/geo.js';
import { parseOverpass, filterToCourse, parseContext } from '../src/data/overpass.js';
import { assembleHole, fairwaySpine } from '../src/data/holeModel.js';
import { holeToGeoJSON, contextToGeoJSON } from '../src/data/holeGeoJSON.js';
import { buildFrames } from '../src/scene/flyover.js';

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

test('assembleHole synthesizes a fairway corridor when OSM has none', () => {
  const noFairway = { elements: fixture.elements.filter((e) => e.tags?.golf !== 'fairway') };
  const parsed = filterToCourse(parseOverpass(noFairway), 'Whistling Straits');
  const hole = assembleHole(parsed, '1', null);
  assert.equal(hole.syntheticFairway, true, 'flag set when no OSM fairway');
  assert.equal(hole.fairwayRings.length, 1, 'one synthesized corridor');
  const ring = hole.fairwayRings[0];
  assert.ok(ring.length > 8, 'corridor is a real ribbon');
  assert.deepEqual(ring[0], ring[ring.length - 1], 'corridor ring is closed');
  // A real OSM fairway (the full fixture) must NOT be overwritten.
  const withFairway = assembleHole(filterToCourse(parseOverpass(fixture), 'Whistling Straits'), '1', null);
  assert.equal(withFairway.syntheticFairway, false, 'real fairway kept as-is');
});

test('flyover follows the hole route at a readable drone height', () => {
  const green = [-87.72, greenLat];
  const hole = {
    yardage: 394,
    // Deliberately reversed to exercise the OSM direction correction.
    centerline: [green, [-87.7203, 43.8516], [-87.72, 43.85]],
    greenCenter: green,
  };
  const frames = buildFrames(hole, { flightSamples: 40, viewportHeight: 900 });
  const arrival = frames[40];

  assert.equal(frames.length, 41, 'there must be no stationary orbit appended to the flight');
  assert.ok(haversineMeters(frames[0].center, [-87.72, 43.85]) < 2);
  assert.ok(haversineMeters(arrival.center, green) < 2);
  assert.ok(frames.every((frame) => frame.zoom > 18 && frame.zoom < 22), 'camera must stay low over the hole');
  assert.ok(frames.every((frame) => frame.pitch >= 55 && frame.pitch <= 76), 'shallow forward-looking angle');
  assert.ok(frames.every((frame) => frame.agl >= 44 && frame.agl <= 172), 'low fairway-level descent');
  assert.ok(haversineMeters(frames[0].center, frames[4].center) < hole.yardage * 0.9144 * 0.03,
    'opening must accelerate gently away from the tee');
  assert.ok(frames.slice(1).every((frame, i) => frame.center[1] >= frames[i].center[1]),
    'camera must advance along the tee-to-green route');
  assert.equal(arrival.agl, 65, 'flight must finish low over the green');
});

test('fairwaySpine follows a dogleg: straight early, turns late', () => {
  const tee = [-87.72, 43.85];
  const green = [-87.72, 43.854]; // due north
  const centerline = [tee, green]; // straight OSM play line
  // A fairway that runs STRAIGHT on the line for the first ~60% (centred on
  // lon -87.72), then doglegs WEST for the final stretch.
  const ring = [
    // west edge, tee → up the straight section → out to the west on the turn
    [-87.7202, 43.850], [-87.7202, 43.8525], [-87.7208, 43.854],
    // east edge back down: turn → straight section → tee
    [-87.7204, 43.854], [-87.7198, 43.8525], [-87.7198, 43.850],
    [-87.7202, 43.850],
  ];
  const spine = fairwaySpine(centerline, [ring]);
  assert.ok(spine, 'a fairway with geometry yields a spine');
  assert.ok(haversineMeters(spine[0], tee) < 2 && haversineMeters(spine[spine.length - 1], green) < 2,
    'spine still starts at the tee and ends at the green');

  // Before the corner (lat < 43.853) the route must hug the straight line…
  const early = spine.filter((p) => p[1] < 43.853);
  assert.ok(early.length && early.every((p) => Math.abs(p[0] + 87.72) < 0.00015),
    `route holds the line before the corner (${early.map((p) => (p[0] + 87.72).toFixed(5))})`);
  // …and only past the corner does the route swing west toward the dogleg.
  const late = spine.filter((p) => p[1] >= 43.853 && p[1] < 43.8539);
  assert.ok(late.length && late.some((p) => p[0] < -87.7203),
    `route turns west only near the green (${late.map((p) => (p[0] + 87.72).toFixed(5))})`);

  assert.equal(fairwaySpine(centerline, []), null, 'no fairway → keep the straight play line');
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
  assert.equal(gj.treeModels.features[0].geometry.type, 'Polygon');
  const tm = gj.treeModels.features[0].properties;
  assert.ok(tm.crownTop >= 8 && tm.crownTop <= 16, `crown height varies (${tm.crownTop})`);
  assert.ok(tm.trunkTop > 0 && tm.trunkTop < tm.crownTop, 'trunk below the crown');
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
