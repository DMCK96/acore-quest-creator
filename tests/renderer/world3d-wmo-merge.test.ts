import { describe, expect, it } from 'vitest';
import { mergeGroups } from '../../src/renderer/world3d/scene/wmo/loader/merge-groups';
import type { WmoGroupSpec } from '../../src/renderer/world3d/scene/wmo/loader/types';

/** A group of `n` triangles near (x, y, z), triangle i being marked by its first vertex's x = x + i */
function group(x: number, y: number, z: number, materials: number[], extra: Partial<WmoGroupSpec> = {}): WmoGroupSpec {
  const n = materials.length;
  const positions = new Float32Array(n * 9);
  const indices = new Uint16Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions.set([x + i, y, z, x + i + 0.5, y, z, x + i, y + 0.5, z], i * 9);
    indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
  }
  return {
    positions,
    normals: new Float32Array(n * 9).fill(0.5),
    uvs: new Float32Array(n * 6).fill(0.25),
    colors: null,
    indices,
    batches: materials.map((material, i) => ({ start: i * 3, count: 3, material })),
    ...extra,
  };
}

/** Each drawn triangle, by where it is and the material it is drawn with, in a stable order */
function triangles(spec: WmoGroupSpec): string[] {
  const out: string[] = [];
  const batches = spec.batches.length > 0 ? spec.batches : [{ start: 0, count: spec.indices.length, material: 0 }];
  for (const b of batches) {
    for (let i = b.start; i < b.start + b.count; i += 3) {
      const corner = (k: number) => [0, 1, 2].map((a) => spec.positions[spec.indices[i + k]! * 3 + a]).join(',');
      out.push(`${corner(0)}|${corner(1)}|${corner(2)}|m${b.material}`);
    }
  }
  return out.sort();
}

describe('merging a building’s groups', () => {
  it('draws the same triangles with the same materials, from one batch for each material', () => {
    const a = group(0, 0, 0, [3, 1, 3, 2]);
    const b = group(20, 0, 0, [1, 2, 2]);
    const [merged, ...rest] = mergeGroups([a, b], 80);
    expect(rest).toHaveLength(0);
    expect(triangles(merged!)).toEqual([...triangles(a), ...triangles(b)].sort());
    expect(merged!.batches.map((x) => x.material).sort()).toEqual([1, 2, 3]);
    // Each batch is one run, and the runs tile the index buffer
    const runs = [...merged!.batches].sort((p, q) => p.start - q.start);
    expect(runs[0]!.start).toBe(0);
    for (let i = 1; i < runs.length; i++) expect(runs[i]!.start).toBe(runs[i - 1]!.start + runs[i - 1]!.count);
    expect(runs.at(-1)!.start + runs.at(-1)!.count).toBe(merged!.indices.length);
    expect(merged!.positions.length).toBe(a.positions.length + b.positions.length);
  });

  it('keeps groups far apart as they are in separate meshes', () => {
    const merged = mergeGroups([group(0, 0, 0, [1]), group(500, 0, 0, [1])], 80);
    expect(merged).toHaveLength(2);
  });

  it('never mixes baked and lit groups, or groups with and without normals or coordinates', () => {
    const baked = group(0, 0, 0, [1], { colors: new Uint8Array(12).fill(255) });
    const lit = group(1, 0, 0, [1]);
    const noNormals = group(2, 0, 0, [1], { normals: null });
    const noUvs = group(3, 0, 0, [1], { uvs: null });
    const merged = mergeGroups([baked, lit, noNormals, noUvs], 80);
    expect(merged).toHaveLength(4);
    expect(merged.filter((m) => m.colors !== null)).toHaveLength(1);
    expect(merged.filter((m) => m.normals === null)).toHaveLength(1);
    expect(merged.filter((m) => m.uvs === null)).toHaveLength(1);
  });

  it('carries colours, normals and coordinates along with their vertices', () => {
    const a = group(0, 0, 0, [1], { colors: new Uint8Array(12).fill(10) });
    const b = group(1, 0, 0, [2], { colors: new Uint8Array(12).fill(20) });
    a.normals!.fill(0.1);
    b.normals!.fill(0.9);
    const [m] = mergeGroups([a, b], 80);
    expect(Array.from(m!.colors!)).toEqual([...new Array(12).fill(10), ...new Array(12).fill(20)]);
    expect(m!.normals![0]).toBeCloseTo(0.1);
    expect(m!.normals![9]).toBeCloseTo(0.9);
    expect(m!.uvs!.length).toBe(12);
  });

  it('draws a group without batches as one batch of material 0', () => {
    const plain = group(0, 0, 0, [0, 0], { batches: [] });
    const other = group(1, 0, 0, [4]);
    const [m] = mergeGroups([plain, other], 80);
    expect(m!.batches.map((b) => b.material).sort()).toEqual([0, 4]);
    expect(triangles(m!)).toEqual([...triangles(plain), ...triangles(other)].sort());
  });

  it('uses 32-bit indices once the vertices outgrow 16 bits', () => {
    const big = (x: number) => {
      const n = 12000;
      return group(x, 0, 0, new Array(n).fill(1));
    };
    const [m] = mergeGroups([big(1), big(2), big(3)], 80);
    expect(m!.positions.length / 3).toBe(108000);
    expect(m!.indices).toBeInstanceOf(Uint32Array);
    expect(m!.indices[m!.indices.length - 1]).toBeLessThan(108000);
  });

  it('keeps 16-bit indices when they will do, and returns nothing for nothing', () => {
    const [m] = mergeGroups([group(0, 0, 0, [1]), group(1, 0, 0, [1])], 80);
    expect(m!.indices).toBeInstanceOf(Uint16Array);
    expect(mergeGroups([], 80)).toEqual([]);
  });

  it('leaves its input alone', () => {
    const a = group(0, 0, 0, [2, 1]);
    const before = Array.from(a.indices);
    mergeGroups([a, group(5, 0, 0, [1])], 80);
    expect(Array.from(a.indices)).toEqual(before);
    expect(a.batches.map((b) => b.material)).toEqual([2, 1]);
  });
});
