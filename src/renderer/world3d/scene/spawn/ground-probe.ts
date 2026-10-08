import * as THREE from 'three';
import { FloorGrid } from './floor-index.js';

/** How a mesh is asked for its floor: through its grid, or, when the grid cannot answer as three.js would, three.js itself */
type FloorInfo = {
  box: THREE.Box3;
  /** Null: ask three.js */
  grid: { grid: FloorGrid; inverse: THREE.Matrix4; zScale: number; zShift: number; doubleSided: boolean } | null;
};

const infos = new WeakMap<THREE.Mesh, FloorInfo>();
/** A geometry's grid is the same for every placement of it */
const grids = new WeakMap<THREE.BufferGeometry, FloorGrid | null>();
const down = new THREE.Vector3(0, 0, -1);
const raycaster = new THREE.Raycaster();
const local = new THREE.Vector3();

/** One side for all of a mesh's materials, or null when they differ (or face the other way) */
function sideOf(material: THREE.Material | THREE.Material[]): boolean | null {
  const sides = new Set((Array.isArray(material) ? material : [material]).map((m) => m.side));
  if (sides.size !== 1) return null;
  const side = [...sides][0];
  return side === THREE.DoubleSide ? true : side === THREE.FrontSide ? false : null;
}

function gridOf(geometry: THREE.BufferGeometry): FloorGrid | null {
  if (grids.has(geometry)) return grids.get(geometry)!;
  const position = geometry.getAttribute('position');
  const plain = position && !(position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && geometry.drawRange.start === 0 && geometry.drawRange.count === Infinity;
  const grid = plain ? new FloorGrid(position.array, geometry.index ? geometry.index.array : null) : null;
  grids.set(geometry, grid);
  return grid;
}

function infoOf(mesh: THREE.Mesh): FloorInfo {
  const known = infos.get(mesh);
  if (known) return known;
  const { geometry } = mesh;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = new THREE.Box3().copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
  const m = mesh.matrixWorld.elements;
  // The mesh stands upright (turned only about the vertical, scaled, not mirrored): a vertical ray is vertical in its space too
  const upright = Math.abs(m[2]!) < 1e-9 && Math.abs(m[6]!) < 1e-9 && Math.abs(m[8]!) < 1e-9 && Math.abs(m[9]!) < 1e-9 && m[10]! > 0 && m[0]! * m[5]! - m[4]! * m[1]! > 0;
  const doubleSided = sideOf(mesh.material);
  const grid = upright && doubleSided !== null && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh ? gridOf(geometry) : null;
  const info: FloorInfo = {
    box,
    grid: grid && doubleSided !== null ? { grid, inverse: mesh.matrixWorld.clone().invert(), zScale: m[10]!, zShift: m[14]!, doubleSided } : null,
  };
  infos.set(mesh, info);
  return info;
}

/** The floor meshes under a root, listed once; a root that gained children since is listed again */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const cached = root.userData.floorMeshes as { count: number; meshes: THREE.Mesh[] } | undefined;
  if (cached && cached.count === root.children.length) return cached.meshes;
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  root.userData.floorMeshes = { count: root.children.length, meshes };
  return meshes;
}

/**
 * The height of the highest floor under (x, y): a downward ray from `fromZ`, no longer than `distance`, over every
 * mesh under `floors` (shown or not, as the ground an NPC stands on does not change with what is drawn). The
 * answer is what three.js's raycaster finds, from a grid per mesh rather than every triangle. Floors never move.
 */
export function floorHeightBelow(floors: readonly THREE.Object3D[], x: number, y: number, fromZ: number, distance: number): number | null {
  let best: number | null = null;
  for (const root of floors) {
    for (const mesh of meshesOf(root)) {
      const info = infoOf(mesh);
      const { box } = info;
      if (x < box.min.x || x > box.max.x || y < box.min.y || y > box.max.y || box.max.z < fromZ - distance || box.min.z > fromZ) continue;
      let height: number | null;
      if (info.grid) {
        const { grid, inverse, zScale, doubleSided, zShift } = info.grid;
        local.set(x, y, fromZ).applyMatrix4(inverse);
        const found = grid.highestBelow(local.x, local.y, local.z, distance / zScale, doubleSided);
        height = found === null ? null : found * zScale + zShift;
      } else {
        raycaster.set(local.set(x, y, fromZ), down);
        raycaster.far = distance;
        height = raycaster.intersectObject(mesh, false)[0]?.point.z ?? null;
      }
      if (height !== null && (best === null || height > best)) best = height;
    }
  }
  return best;
}
