import { defineConfig } from 'vite';

// MapLibre fetches its raster / raster-dem tiles and the Overpass API directly
// from the browser; every host we use (Overpass, AWS Terrain Tiles, USGS/NAIP,
// Esri) sends permissive CORS headers, so no dev-server proxy is required.
export default defineConfig({
  build: { target: 'es2020' },
});
