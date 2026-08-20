// Resolves data-source URLs. In the Vite browser dev server we route through
// the `/__geo/*` reverse proxies (see vite.config.js) so every request is
// same-origin and CORS can never bite. In a production build or in Node (the
// bake CLI), we hit the upstream hosts directly — they all send permissive
// CORS headers except 3DEP, which the bake CLI reaches from Node (no CORS).

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const USE_PROXY = !!(viteEnv && viteEnv.DEV);

const DIRECT = {
  overpass: 'https://overpass-api.de/api/interpreter',
  dep3: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage',
  esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile',
  terrarium: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium',
};

const PROXY = {
  overpass: '/__geo/overpass',
  dep3: '/__geo/3dep',
  esri: '/__geo/esri',
  terrarium: '/__geo/terrarium',
};

const base = USE_PROXY ? PROXY : DIRECT;

export const overpassUrl = () => base.overpass;
export const dep3ExportUrl = () => base.dep3;

/** Esri World Imagery uses z/y/x ordering. */
export const esriTileUrl = (z, x, y) => `${base.esri}/${z}/${y}/${x}`;

/** AWS Terrarium terrain-RGB, z/x/y ordering, .png. */
export const terrariumTileUrl = (z, x, y) => `${base.terrarium}/${z}/${x}/${y}.png`;

/** Mapbox is optional and always hit directly (it is CORS-friendly). */
export const mapboxSatelliteUrl = (z, x, y, token) =>
  `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg?access_token=${token}`;
export const mapboxTerrainRgbUrl = (z, x, y, token) =>
  `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${token}`;

export const mapboxToken = () =>
  (viteEnv && viteEnv.VITE_MAPBOX_TOKEN) || undefined;
