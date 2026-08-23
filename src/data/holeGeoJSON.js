// Turn a hole model (lng/lat) into GeoJSON sources MapLibre can render as
// fill/line/circle layers draped on the terrain.

const closeRing = (ring) => {
  if (ring.length < 3) return ring;
  const [a] = ring, b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

const fc = (features) => ({ type: 'FeatureCollection', features });
const squareMeters = ([lng, lat], radiusM) => {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return closeRing([
    [lng - dLng, lat - dLat], [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat], [lng - dLng, lat + dLat],
  ]);
};
const poly = (rings, props = {}) =>
  rings.filter((r) => r.length >= 3).map((r) => ({
    type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [closeRing(r)] },
  }));

/** Context (buildings / tree canopy / trees) → GeoJSON for 3D extrusion layers. */
export function contextToGeoJSON(ctx) {
  if (!ctx) return { buildings: fc([]), canopy: fc([]), trees: fc([]), treeModels: fc([]) };
  const buildings = fc(
    (ctx.buildings || []).filter((b) => b.ring.length >= 3).map((b) => ({
      type: 'Feature', properties: { height: b.height, minHeight: b.minHeight },
      geometry: { type: 'Polygon', coordinates: [closeRing(b.ring)] },
    }))
  );
  const canopy = fc(
    (ctx.canopy || []).filter((c) => c.ring.length >= 3).map((c) => ({
      type: 'Feature', properties: { height: c.height },
      geometry: { type: 'Polygon', coordinates: [closeRing(c.ring)] },
    }))
  );
  const trees = fc(
    (ctx.trees || []).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
  );
  const treeModels = fc(
    (ctx.trees || []).map((p) => ({
      type: 'Feature', properties: { trunkTop: 6, crownTop: 11 },
      geometry: { type: 'Polygon', coordinates: [squareMeters(p, 1.25)] },
    }))
  );
  return { buildings, canopy, trees, treeModels };
}

export function holeToGeoJSON(hole) {
  return {
    fairways: fc(poly(hole.fairwayRings, { kind: 'fairway' })),
    greens: fc(poly([hole.greenRing], { kind: 'green' })),
    bunkers: fc(poly(hole.bunkerRings, { kind: 'bunker' })),
    water: fc(poly(hole.waterRings, { kind: 'water' })),
    tees: fc(poly(hole.teeRings, { kind: 'tee' })),
    centerline: fc([{
      type: 'Feature', properties: { kind: 'centerline' },
      geometry: { type: 'LineString', coordinates: hole.centerline },
    }]),
    pin: fc([{ type: 'Feature', properties: { kind: 'pin' }, geometry: { type: 'Point', coordinates: hole.greenCenter } }]),
    teePoint: fc([{ type: 'Feature', properties: { kind: 'tee' }, geometry: { type: 'Point', coordinates: hole.tee } }]),
  };
}
