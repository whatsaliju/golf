// Pure Web-Mercator (XYZ) tile math + Terrarium elevation decode.
// No DOM / Node APIs here so it can be unit-tested and shared between the
// browser runtime and the Node bake CLI.

/** Fractional tile X for a longitude at zoom z. */
export function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}

/** Fractional tile Y for a latitude at zoom z. */
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Longitude of the left edge of tile column x at zoom z. */
export function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude of the top edge of tile row y at zoom z. */
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Integer tile range covering a bbox at zoom z.
 * bbox: { west, south, east, north } in degrees.
 * Returns { z, x0, x1, y0, y1 } inclusive, plus tile count.
 */
export function tileRangeForBbox(bbox, z) {
  const x0 = Math.floor(lonToTileX(bbox.west, z));
  const x1 = Math.floor(lonToTileX(bbox.east, z));
  // north latitude → smaller tile Y
  const y0 = Math.floor(latToTileY(bbox.north, z));
  const y1 = Math.floor(latToTileY(bbox.south, z));
  return { z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/**
 * Pick the smallest zoom whose tile grid over `bbox` still yields at least
 * `minPx` pixels across the shorter span (tiles are 256px). Clamped to
 * [minZoom, maxZoom] and to a tile budget so we never fetch thousands.
 */
export function pickZoomForBbox(bbox, { minPx = 1024, maxZoom = 19, minZoom = 12, maxTiles = 64 } = {}) {
  for (let z = maxZoom; z >= minZoom; z--) {
    const spanX = (lonToTileX(bbox.east, z) - lonToTileX(bbox.west, z)) * 256;
    const spanY = (latToTileY(bbox.south, z) - latToTileY(bbox.north, z)) * 256;
    const px = Math.min(spanX, spanY);
    const { count } = tileRangeForBbox(bbox, z);
    if (px >= minPx && count <= maxTiles) return z;
    if (count > maxTiles) continue;
  }
  return minZoom;
}

/** Terrarium RGB → elevation in metres. https://github.com/tilezen/joerd */
export function terrariumToMeters(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}
