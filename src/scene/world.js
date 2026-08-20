// Builds the world from a loaded hole: a terrain mesh sampled from the real
// DEM and draped with the real satellite texture, plus overlays for the OSM
// green / bunkers / water / tees, a pin flag and a tee marker.

import * as THREE from 'three';

function buildTerrainMesh(hole, heightAt, imagery, seg) {
  const b = hole.localBounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;
  const nx = seg, nz = seg;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= nz; i++) {
    for (let j = 0; j <= nx; j++) {
      const x = b.minX + (spanX * j) / nx;
      const z = b.minZ + (spanZ * i) / nz;
      positions.push(x, heightAt(x, z), z);
      if (imagery) {
        const [u, v] = imagery.uvFor(x, z);
        uvs.push(u, v);
      } else {
        uvs.push(j / nx, 1 - i / nz);
      }
    }
  }
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nx; j++) {
      const a = i * (nx + 1) + j;
      const c = a + 1;
      const d = a + (nx + 1);
      const e = d + 1;
      indices.push(a, d, c, c, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = imagery
    ? new THREE.MeshStandardMaterial({ map: imagery.texture, roughness: 0.95, metalness: 0 })
    : new THREE.MeshStandardMaterial({ color: 0x33562f, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function ringFill(ring, heightAt, color, opacity, yOffset) {
  if (!ring || ring.length < 3) return null;
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // shape XY → world XZ
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z) + yOffset);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 1,
    depthWrite: opacity >= 1, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function ringOutline(ring, heightAt, color, yOffset) {
  if (!ring || ring.length < 2) return null;
  const pts = ring.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + yOffset, z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
}

function pinFlag(greenCenter, heightAt) {
  const g = new THREE.Group();
  const y = heightAt(greenCenter[0], greenCenter[1]);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  pole.position.y = 1.5;
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, side: THREE.DoubleSide })
  );
  flag.position.set(0.55, 2.7, 0);
  g.add(pole, flag);
  g.position.set(greenCenter[0], y, greenCenter[1]);
  return g;
}

function teeMarker(tee, heightAt) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.3, 2),
    new THREE.MeshStandardMaterial({ color: 0xeef2ee })
  );
  m.position.set(tee[0], heightAt(tee[0], tee[1]) + 0.2, tee[1]);
  return m;
}

/**
 * @param {{hole, sampleElevation, imagery}} data  from loadHole()
 * @param {{segments?:number, verticalExaggeration?:number, showOverlays?:boolean}} opts
 * @returns {{group:THREE.Group, heightAt:(x,z)=>number, base:number}}
 */
export function buildWorld(data, opts = {}) {
  const { hole, sampleElevation, imagery } = data;
  const seg = opts.segments ?? 200;
  const vex = opts.verticalExaggeration ?? 1;
  const showOverlays = opts.showOverlays ?? true;

  // Anchor the scene so the tee sits near y = 0.
  const base = sampleElevation(hole.tee[0], hole.tee[1]);
  const heightAt = (x, z) => (sampleElevation(x, z) - base) * vex;

  const group = new THREE.Group();
  group.add(buildTerrainMesh(hole, heightAt, imagery, seg));

  if (showOverlays) {
    // Slightly stronger tint when there is no satellite imagery to read from.
    const alpha = imagery ? 0.18 : 0.55;
    const add = (m) => m && group.add(m);
    for (const r of hole.waterRings) {
      add(ringFill(r, heightAt, 0x2b6ca3, imagery ? 0.32 : 0.7, 0.05));
      add(ringOutline(r, heightAt, 0x8ecbff, 0.06));
    }
    for (const r of hole.bunkerRings) {
      add(ringFill(r, heightAt, 0xd8c69c, imagery ? 0.22 : 0.85, 0.05));
      add(ringOutline(r, heightAt, 0xf0e4c0, 0.06));
    }
    for (const r of hole.fairwayRings) add(ringOutline(r, heightAt, 0x9be08a, 0.05));
    add(ringFill(hole.greenRing, heightAt, 0x6aab5f, alpha, 0.06));
    add(ringOutline(hole.greenRing, heightAt, 0xbfffb0, 0.08));
    for (const r of hole.teeRings) add(ringOutline(r, heightAt, 0xeef2ee, 0.06));
  }

  group.add(pinFlag(hole.greenCenter, heightAt));
  group.add(teeMarker(hole.tee, heightAt));

  return { group, heightAt, base };
}
