// Equirectangular projection of lat/lon onto a local metres plane centred on
// an origin. Accurate to well under a metre across a single golf hole (~500 m),
// which is all we need. Axes:
//   x = east (+)         → THREE world X
//   z = south (+)        → THREE world Z   (so "north" is -Z, into the scene)
// Y (up) is supplied separately by the elevation sampler.

const WGS84_R = 6378137; // equatorial radius, metres
const DEG = Math.PI / 180;

/**
 * @param {{lat:number, lon:number}} origin
 * @returns projection with toLocal / toLatLon / metre-per-degree scales.
 */
export function makeProjection(origin) {
  const lat0 = origin.lat * DEG;
  const mPerDegLat = WGS84_R * DEG; // ~111320 m
  const mPerDegLon = WGS84_R * DEG * Math.cos(lat0);

  /** [lon,lat] → [x,z] metres. */
  function toLocal(lon, lat) {
    const x = (lon - origin.lon) * mPerDegLon;
    const north = (lat - origin.lat) * mPerDegLat;
    return [x, -north];
  }

  /** [x,z] metres → [lon,lat]. */
  function toLatLon(x, z) {
    const lon = origin.lon + x / mPerDegLon;
    const lat = origin.lat + -z / mPerDegLat;
    return [lon, lat];
  }

  return { origin, mPerDegLat, mPerDegLon, toLocal, toLatLon };
}

/** Great-circle-ish planar distance between two [lon,lat] points, in metres. */
export function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const la1 = a[1] * DEG;
  const la2 = b[1] * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const M_TO_YD = 1 / 0.9144;
export const M_TO_FT = 3.280839895;
