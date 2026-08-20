import { defineConfig } from 'vite';

// Dev-server reverse proxies for the geodata hosts.
//
// Overpass, Esri World Imagery and the AWS Terrarium tiles all send permissive
// CORS headers, so a browser can hit them directly. The USGS 3DEP ImageServer
// is less consistent about CORS, so we route everything through the dev server
// during `npm run dev` to guarantee same-origin requests. The `/__geo/*` paths
// mirror the constants in src/data/endpoints.js.
//
// In a production `vite build`, there is no dev server: endpoints.js falls back
// to the direct https URLs (see PROXY_BASE there).
export default defineConfig({
  server: {
    proxy: {
      '/__geo/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__geo\/overpass/, '/api/interpreter'),
      },
      '/__geo/3dep': {
        target: 'https://elevation.nationalmap.gov',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(
            /^\/__geo\/3dep/,
            '/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
          ),
      },
      '/__geo/esri': {
        target: 'https://server.arcgisonline.com',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(
            /^\/__geo\/esri/,
            '/ArcGIS/rest/services/World_Imagery/MapServer/tile'
          ),
      },
      '/__geo/terrarium': {
        target: 'https://s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) =>
          p.replace(/^\/__geo\/terrarium/, '/elevation-tiles-prod/terrarium'),
      },
    },
  },
});
