// Data-source endpoints. MapLibre fetches raster/raster-dem tiles directly in
// the browser; all hosts below send permissive CORS, so no dev proxy is needed.
// Everything here is free and (except the optional Esri/Mapbox fallbacks)
// public-domain / open data.

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;

// Multiple Overpass endpoints; fetchOverpass tries them in order so one slow or
// down mirror doesn't block a load.
export const overpassEndpoints = () => [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
export const overpassUrl = () => overpassEndpoints()[0];

export const mapboxToken = () => (viteEnv && viteEnv.VITE_MAPBOX_TOKEN) || undefined;

// Terrarium terrain-RGB (AWS Open Data). US data is USGS 3DEP-derived.
export const TERRARIUM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution: 'Elevation: AWS Terrain Tiles / USGS 3DEP',
};

/**
 * Imagery raster sources by name.
 *  - 'usgs'  : USGS Imagery (NAIP-sourced), PUBLIC DOMAIN, no token  ← FOSS default
 *  - 'esri'  : Esri World Imagery, free-to-use w/ attribution (proprietary)
 *  - 'mapbox': Mapbox Satellite, needs VITE_MAPBOX_TOKEN (proprietary)
 */
export function imagerySource(name) {
  if (name === 'mapbox' && mapboxToken()) {
    return {
      tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg?access_token=${mapboxToken()}`],
      tileSize: 512, maxzoom: 22, attribution: '© Mapbox © Maxar',
    };
  }
  if (name === 'esri') {
    return {
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
    };
  }
  // default: USGS / NAIP — public domain
  return {
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256, maxzoom: 16, attribution: 'Imagery: USGS / NAIP (public domain)',
  };
}
