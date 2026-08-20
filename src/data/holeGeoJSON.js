// Turn a hole model (lng/lat) into GeoJSON sources MapLibre can render as
// fill/line/circle layers draped on the terrain.

const closeRing = (ring) => {
  if (ring.length < 3) return ring;
  const [a] = ring, b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

const fc = (features) => ({ type: 'FeatureCollection', features });
const poly = (rings, props = {}) =>
  rings.filter((r) => r.length >= 3).map((r) => ({
    type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [closeRing(r)] },
  }));

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
