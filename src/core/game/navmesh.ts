import { gridOf } from '../map/coords';

/**
 * Walkable floors from the server's navigation mesh (`<DataDir>/mmaps/*.mmtile`, written by the
 * fork's mmaps generator): a 56-byte `MmapTileHeader`, then one Detour tile covering one grid. Every
 * ground polygon over a point is a floor an NPC could stand on there, so a point in a tower gets
 * the ground, each storey and the roof. Recast stores vertices as `(wowY, wowZ, wowX)`.
 */

export class NavmeshFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavmeshFormatError';
  }
}

export interface NavTile {
  /** Recast-order vertices: x (WoW Y), y (WoW Z), z (WoW X). */
  verts: Float32Array;
  polys: { verts: number[]; ground: boolean }[];
  detail: { vertBase: number; triBase: number; triCount: number }[];
  detailVerts: Float32Array;
  /** Four bytes per triangle: three vertex indices and a flags byte. */
  detailTris: Uint8Array;
}

const MMAP_MAGIC = 0x4d4d4150;
const MMAP_VERSION = 20;
const MMAP_HEADER_SIZE = 56;
const DT_MAGIC = ('D'.charCodeAt(0) << 24) | ('N'.charCodeAt(0) << 16) | ('A'.charCodeAt(0) << 8) | 'V'.charCodeAt(0);
const DT_VERSION = 7;
const DT_HEADER_SIZE = 100;
const DT_VERTS_PER_POLYGON = 6;
const POLY_SIZE = 32;
/** `dtLink` with 64-bit poly refs (`DT_POLYREF64`, as the fork builds Detour). */
const LINK_SIZE = 16;
const DETAIL_MESH_SIZE = 12;
/** Floors closer than this are one floor. */
const SAME_FLOOR = 0.5;

const align4 = (n: number): number => (n + 3) & ~3;

export function parseNavTile(bytes: Uint8Array): NavTile {
  if (bytes.length < MMAP_HEADER_SIZE + DT_HEADER_SIZE) throw new NavmeshFormatError('This is too short to be a navmesh tile.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MMAP_MAGIC) throw new NavmeshFormatError('This is not a navmesh tile.');
  const mmapVersion = view.getUint32(8, true);
  if (mmapVersion !== MMAP_VERSION) {
    throw new NavmeshFormatError(`This navmesh tile is version ${mmapVersion}; the server reads version ${MMAP_VERSION}.`);
  }
  const size = view.getUint32(12, true);
  if (MMAP_HEADER_SIZE + size > bytes.length) throw new NavmeshFormatError('The navmesh tile is shorter than its header says.');

  const h = MMAP_HEADER_SIZE;
  if (view.getInt32(h, true) !== DT_MAGIC || view.getInt32(h + 4, true) !== DT_VERSION) {
    throw new NavmeshFormatError('The navmesh tile does not hold a Detour tile this reader knows.');
  }
  const int = (field: number): number => view.getInt32(h + field * 4, true);
  const polyCount = int(6);
  const vertCount = int(7);
  const maxLinkCount = int(8);
  const detailMeshCount = int(9);
  const detailVertCount = int(10);
  const detailTriCount = int(11);

  let o = h + align4(DT_HEADER_SIZE);
  const need = (length: number): void => {
    if (o + length > bytes.length) throw new NavmeshFormatError('The navmesh tile ends inside its data.');
  };
  const floats = (count: number): Float32Array => {
    need(count * 4);
    const out = new Float32Array(count);
    for (let k = 0; k < count; k++) out[k] = view.getFloat32(o + k * 4, true);
    return out;
  };

  const verts = floats(vertCount * 3);
  o += align4(vertCount * 12);

  need(polyCount * POLY_SIZE);
  const polys: NavTile['polys'] = [];
  for (let p = 0; p < polyCount; p++) {
    const at = o + p * POLY_SIZE;
    const count = Math.min(view.getUint8(at + 30), DT_VERTS_PER_POLYGON);
    const list: number[] = [];
    for (let k = 0; k < count; k++) list.push(view.getUint16(at + 4 + k * 2, true));
    polys.push({ verts: list, ground: view.getUint8(at + 31) >> 6 === 0 });
  }
  o += align4(polyCount * POLY_SIZE);
  o += align4(maxLinkCount * LINK_SIZE);

  need(detailMeshCount * DETAIL_MESH_SIZE);
  const detail: NavTile['detail'] = [];
  for (let d = 0; d < detailMeshCount; d++) {
    const at = o + d * DETAIL_MESH_SIZE;
    detail.push({ vertBase: view.getUint32(at, true), triBase: view.getUint32(at + 4, true), triCount: view.getUint8(at + 9) });
  }
  o += align4(detailMeshCount * DETAIL_MESH_SIZE);

  const detailVerts = floats(detailVertCount * 3);
  o += align4(detailVertCount * 12);

  need(detailTriCount * 4);
  const detailTris = bytes.slice(o, o + detailTriCount * 4);
  // BV nodes and off-mesh connections follow; floors need neither.

  return { verts, polys, detail, detailVerts, detailTris };
}

/** Every walkable floor over a point, lowest first, to 2 decimals; floors within 0.5 yd are one. */
export function floorsAt(tile: NavTile, x: number, y: number): number[] {
  // Recast's horizontal plane is (x = WoW Y, z = WoW X).
  const rx = y;
  const rz = x;
  const heights: number[] = [];
  tile.polys.forEach((poly, p) => {
    if (!poly.ground) return;
    const mesh = tile.detail[p];
    if (!mesh) return;
    const vertex = (k: number): [number, number, number] => {
      const src = k < poly.verts.length ? tile.verts : tile.detailVerts;
      const i = k < poly.verts.length ? poly.verts[k]! : mesh.vertBase + k - poly.verts.length;
      return [src[i * 3]!, src[i * 3 + 1]!, src[i * 3 + 2]!];
    };
    for (let t = 0; t < mesh.triCount; t++) {
      const at = (mesh.triBase + t) * 4;
      if (at + 3 > tile.detailTris.length) break;
      const a = vertex(tile.detailTris[at]!);
      const b = vertex(tile.detailTris[at + 1]!);
      const c = vertex(tile.detailTris[at + 2]!);
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (det === 0) continue;
      const l1 = ((b[2] - c[2]) * (rx - c[0]) + (c[0] - b[0]) * (rz - c[2])) / det;
      const l2 = ((c[2] - a[2]) * (rx - c[0]) + (a[0] - c[0]) * (rz - c[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const height = l1 * a[1] + l2 * b[1] + l3 * c[1];
      // A damaged tile can hold impossible numbers; a floor that is not a number is no floor.
      if (Number.isFinite(height)) heights.push(height);
      break;
    }
  });
  const sorted = heights.map((z) => Math.round(z * 100) / 100).sort((m, n) => m - n);
  const floors: number[] = [];
  for (const z of sorted) if (floors.length === 0 || z - floors[floors.length - 1]! > SAME_FLOOR) floors.push(z);
  return floors;
}

/** The tile the server loads for a point: `<map:03><gx:02><gy:02>.mmtile`, numbered like `.map` files. */
export function navTileFileName(map: number, x: number, y: number): string {
  const { gx, gy } = gridOf(x, y);
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(map, 3)}${pad(gx, 2)}${pad(gy, 2)}.mmtile`;
}
