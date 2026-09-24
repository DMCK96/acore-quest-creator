/**
 * A `.mmtile` (MMAP v20 + Detour v7) with the given convex polygons, in WoW coordinates. Each
 * polygon's detail mesh is a fan over its own vertices, so its height is the plane through them.
 * `offMesh` polygons get type 1 (off-mesh connection), which floors must ignore.
 */
export function buildNavTile(polys: { verts: [number, number, number][]; offMesh?: boolean }[]): Uint8Array {
  const verts: number[] = [];
  const polyRecs: { idx: number[]; type: number }[] = [];
  for (const p of polys) {
    const idx: number[] = [];
    for (const [x, y, z] of p.verts) {
      idx.push(verts.length / 3);
      verts.push(y, z, x); // Recast order: (wowY, wowZ, wowX)
    }
    polyRecs.push({ idx, type: p.offMesh ? 1 : 0 });
  }
  const tris: number[] = [];
  const detail: [number, number, number, number][] = [];
  for (const p of polyRecs) {
    const triBase = tris.length / 4;
    for (let k = 1; k + 1 < p.idx.length; k++) tris.push(0, k, k + 1, 0);
    detail.push([0, triBase, 0, p.idx.length - 2]);
  }
  const a4 = (n: number) => (n + 3) & ~3;
  const headerSize = 100;
  const size = a4(headerSize) + a4(12 * verts.length / 3) + a4(32 * polyRecs.length) + 0 + a4(12 * detail.length) + 0 + a4(tris.length);
  const bytes = new Uint8Array(56 + size);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x4d4d4150, true); v.setUint32(4, 7, true); v.setUint32(8, 20, true); v.setUint32(12, size, true);
  let o = 56;
  const ints = [('D'.charCodeAt(0) << 24) | ('N'.charCodeAt(0) << 16) | ('A'.charCodeAt(0) << 8) | 'V'.charCodeAt(0), 7, 0, 0, 0, 0,
    polyRecs.length, verts.length / 3, 0, detail.length, 0, tris.length / 4, 0, 0, 0];
  ints.forEach((n, i) => v.setInt32(o + i * 4, n, true));
  o += headerSize;
  verts.forEach((f, i) => v.setFloat32(o + i * 4, f, true));
  o += a4(verts.length * 4);
  polyRecs.forEach((p, i) => {
    const at = o + i * 32;
    p.idx.forEach((vi, k) => v.setUint16(at + 4 + k * 2, vi, true));
    v.setUint8(at + 30, p.idx.length);
    v.setUint8(at + 31, (p.type << 6) | 1);
  });
  o += a4(32 * polyRecs.length);
  detail.forEach(([vb, tb, vc, tc], i) => {
    v.setUint32(o + i * 12, vb, true); v.setUint32(o + i * 12 + 4, tb, true); v.setUint8(o + i * 12 + 8, vc); v.setUint8(o + i * 12 + 9, tc);
  });
  o += a4(12 * detail.length);
  tris.forEach((t, i) => v.setUint8(o + i, t));
  return bytes;
}
