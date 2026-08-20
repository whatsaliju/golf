// Browser DEM: fetch Terrarium terrain-RGB tiles over the hole bbox, decode to
// a metres grid, and expose a bilinear sampler in local-metre coordinates.
//
// Terrarium's US data is resampled from USGS 3DEP, so over Whistling Straits
// this is 3DEP-sourced elevation — but tokenless and decodable in-browser with
// a plain canvas (no GeoTIFF parser). The bake CLI can additionally pull raw
// 3DEP GeoTIFF for survey-grade precision (see scripts/bake-hole.mjs).

import {
  lonToTileX, latToTileY, tileRangeForBbox, pickZoomForBbox, terrariumToMeters,
} from './tiles.js';
import { terrariumTileUrl } from './endpoints.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile load failed: ${url}`));
    img.src = url;
  });
}

function bilinear(grid, w, h, px, py) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(px)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(py)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, px - x0));
  const fy = Math.max(0, Math.min(1, py - y0));
  const a = grid[y0 * w + x0], b = grid[y0 * w + x1];
  const c = grid[y1 * w + x0], d = grid[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * @param {{bbox, projection, zoom?}} opts
 * @returns {{sample:(x:number,z:number)=>number, min:number, max:number, zoom:number}}
 */
export async function buildHeightField({ bbox, projection, zoom }) {
  const z = zoom ?? pickZoomForBbox(bbox, { minPx: 512, maxZoom: 14, minZoom: 11, maxTiles: 25 });
  const { x0, x1, y0, y1 } = tileRangeForBbox(bbox, z);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const W = nx * 256, H = ny * 256;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        loadImage(terrariumTileUrl(z, tx, ty)).then((img) =>
          ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256)
        )
      );
    }
  }
  await Promise.all(jobs);

  const { data } = ctx.getImageData(0, 0, W, H);
  const grid = new Float32Array(W * H);
  let min = Infinity, max = -Infinity;
  for (let i = 0, p = 0; i < grid.length; i++, p += 4) {
    const e = terrariumToMeters(data[p], data[p + 1], data[p + 2]);
    grid[i] = e;
    if (e < min) min = e;
    if (e > max) max = e;
  }

  function sample(x, zc) {
    const [lon, lat] = projection.toLatLon(x, zc);
    const px = (lonToTileX(lon, z) - x0) * 256;
    const py = (latToTileY(lat, z) - y0) * 256;
    return bilinear(grid, W, H, px, py);
  }

  return { sample, min, max, zoom: z };
}
