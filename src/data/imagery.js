// Browser satellite imagery: stitch Esri World Imagery (default, tokenless) or
// Mapbox Satellite (if a token is set) tiles over the hole bbox into a canvas
// texture, and expose a UV mapper so the terrain mesh can drape it geo-exactly.

import * as THREE from 'three';
import { lonToTileX, latToTileY, tileRangeForBbox, pickZoomForBbox } from './tiles.js';
import { esriTileUrl, mapboxSatelliteUrl, mapboxToken } from './endpoints.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`imagery tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * @param {{bbox, projection, source?:'esri'|'mapbox', zoom?}} opts
 * @returns {{texture:THREE.Texture, uvFor:(x,z)=>[number,number], zoom:number, attribution:string}}
 */
export async function buildImagery({ bbox, projection, source, zoom }) {
  const token = mapboxToken();
  const useMapbox = source === 'mapbox' && token;
  const z = zoom ?? pickZoomForBbox(bbox, { minPx: 1024, maxZoom: useMapbox ? 18 : 19, minZoom: 14, maxTiles: 36 });
  const { x0, x1, y0, y1 } = tileRangeForBbox(bbox, z);
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const W = nx * 256, H = ny * 256;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const url = (tx, ty) =>
    useMapbox ? mapboxSatelliteUrl(z, tx, ty, token) : esriTileUrl(z, tx, ty);

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        loadImage(url(tx, ty))
          .then((img) => ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256, 256, 256))
          .catch(() => {
            // leave a neutral tile rather than aborting the whole mosaic
            ctx.fillStyle = '#2c3d2c';
            ctx.fillRect((tx - x0) * 256, (ty - y0) * 256, 256, 256);
          })
      );
    }
  }
  await Promise.all(jobs);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  function uvFor(x, zc) {
    const [lon, lat] = projection.toLatLon(x, zc);
    const px = (lonToTileX(lon, z) - x0) * 256;
    const py = (latToTileY(lat, z) - y0) * 256;
    return [px / W, 1 - py / H];
  }

  return {
    texture,
    uvFor,
    zoom: z,
    attribution: useMapbox ? '© Mapbox © Maxar' : 'Esri, Maxar, Earthstar Geographics',
  };
}
