// Course + hole registry. Add a hole by dropping another entry into HOLES[]
// (and a course into COURSES if it is new). Geometry, yardage, par and
// elevation change are all pulled from real data at load time — the registry
// only says *which* hole to fetch and where to look for it.

export const COURSES = {
  'whistling-straits': {
    displayName: 'Whistling Straits — The Straits',
    location: 'Haven, Wisconsin, USA',
    region: 'US',
    // Overpass filters golf features to the course whose name contains this.
    // Whistling Straits has two courses (The Straits + The Irish); this keeps
    // us on the championship Straits course.
    courseNameFilter: 'Whistling Straits',
    // Bounding box around the Straits course (Lake Michigan shoreline).
    // Widen/tighten if OSM features fall outside it.
    bbox: { west: -87.74, south: 43.835, east: -87.70, north: 43.875 },
    imagerySource: 'esri', // 'esri' (tokenless) | 'mapbox' (needs VITE_MAPBOX_TOKEN)
    demSource: '3dep', // US → USGS 3DEP (via Terrarium in-browser; raw 3DEP in bake CLI)
  },
};

/**
 * The flyover sequence. Order here is the order the "Hole ▸" button cycles,
 * and the order a full 18-hole reel would play.
 */
export const HOLES = [
  {
    id: 'ws-1',
    courseId: 'whistling-straits',
    ref: '1', // OSM golf=hole ref
    title: 'Whistling Straits — The Straits',
    subtitle: 'Hole 1 · Outward Bound',
  },
  // Add holes 2–18 here as you verify each in OSM, e.g.:
  // { id: 'ws-2', courseId: 'whistling-straits', ref: '2', title: '…', subtitle: 'Hole 2' },
];

export function resolveHole(holeCfg) {
  const course = COURSES[holeCfg.courseId];
  if (!course) throw new Error(`Unknown course: ${holeCfg.courseId}`);
  return { ...holeCfg, course };
}
