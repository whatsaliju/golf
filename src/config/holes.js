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
    // 'esri' = Esri World Imagery (free-to-use, proprietary) — sharper close-ups
    //          (zoom ~19 vs USGS ~16), better for the flyover's low passes
    // 'usgs' = USGS/NAIP public-domain imagery (no token)
    // 'mapbox' = Mapbox Satellite (needs VITE_MAPBOX_TOKEN)
    imagerySource: 'esri',
  },
};

/**
 * The flyover sequence. Order here is the order the "Hole ▸" button cycles,
 * and the order a full 18-hole reel would play.
 */
// The Straits course, all 18. `ref` is the OSM golf=hole reference; par and
// yardage come from the data at load time. Names are the course's own hole
// names. If a hole's OSM tagging is missing, that hole falls back to a labelled
// placeholder on the real terrain rather than breaking the reel.
const STRAITS_NAMES = [
  'Outward Bound', 'Cross Country', "O'Man", 'Glory', 'Snake', "Gremlin's Ear",
  'Shipwreck', 'On the Rocks', 'Down and Dirty', 'Voyageur', 'Sand Box', 'Pop Up',
  'Cliff Hanger', "Widow's Watch", 'Grand Strand', 'Endless Bite', 'Pinched Nerve',
  'Dyeabolical',
];

export const HOLES = STRAITS_NAMES.map((name, i) => ({
  id: `ws-${i + 1}`,
  courseId: 'whistling-straits',
  ref: String(i + 1), // OSM golf=hole ref
  title: 'Whistling Straits — The Straits',
  subtitle: `Hole ${i + 1} · ${name}`,
}));

export function resolveHole(holeCfg) {
  const course = COURSES[holeCfg.courseId];
  if (!course) throw new Error(`Unknown course: ${holeCfg.courseId}`);
  return { ...holeCfg, course };
}
