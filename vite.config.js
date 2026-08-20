import { defineConfig } from 'vite';

// MapLibre fetches its raster / raster-dem tiles and the Overpass API directly
// from the browser; every host we use (Overpass, AWS Terrain Tiles, USGS/NAIP,
// Esri) sends permissive CORS headers, so no dev-server proxy is required.
// VITE_BASE lets the same build serve from a subpath (GitHub Pages project site,
// e.g. "/golf/") or from root (Netlify/Cloudflare, "/"). Defaults to root.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  build: { target: 'es2020' },
});
