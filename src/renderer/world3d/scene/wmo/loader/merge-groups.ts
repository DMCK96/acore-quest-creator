import type { WmoBatchSpec, WmoGroupSpec } from './types.js';

type Entry = { group: WmoGroupSpec; offset: number; start: number; count: number };

/** A group's batches, a group without any being one batch of its first material */
const batchesOf = (group: WmoGroupSpec): WmoBatchSpec[] =>
  group.batches.length > 0 ? group.batches : [{ start: 0, count: group.indices.length, material: 0 }];

function centreOf(group: WmoGroupSpec): [number, number, number] {
  const p = group.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, p[i + a]!);
      hi[a] = Math.max(hi[a]!, p[i + a]!);
    }
  }
  return [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
}

/** One mesh from groups that share the kind of vertex they have, with one batch for each material */
function mergeCluster(groups: WmoGroupSpec[]): WmoGroupSpec {
  if (groups.length === 1) {
    const materials = batchesOf(groups[0]!).map((b) => b.material);
    // Nothing to join and no material drawn twice: as it is
    if (new Set(materials).size === materials.length && groups[0]!.batches.length > 0) return groups[0]!;
  }
  const vertices = groups.reduce((sum, g) => sum + g.positions.length / 3, 0);
  const first = groups[0]!;
  const positions = new Float32Array(vertices * 3);
  const normals = first.normals ? new Float32Array(vertices * 3) : null;
  const uvs = first.uvs ? new Float32Array(vertices * 2) : null;
  const colors = first.colors ? new Uint8Array(vertices * 4) : null;

  const byMaterial = new Map<number, Entry[]>();
  let offset = 0;
  for (const group of groups) {
    positions.set(group.positions, offset * 3);
    normals?.set(group.normals!, offset * 3);
    uvs?.set(group.uvs!, offset * 2);
    colors?.set(group.colors!, offset * 4);
    for (const batch of batchesOf(group)) {
      const list = byMaterial.get(batch.material) ?? [];
      list.push({ group, offset, start: batch.start, count: batch.count });
      byMaterial.set(batch.material, list);
    }
    offset += group.positions.length / 3;
  }

  const total = [...byMaterial.values()].reduce((sum, list) => sum + list.reduce((s, e) => s + e.count, 0), 0);
  const indices = vertices > 0xffff ? new Uint32Array(total) : new Uint16Array(total);
  const batches: WmoBatchSpec[] = [];
  let at = 0;
  for (const material of [...byMaterial.keys()].sort((a, b) => a - b)) {
    const start = at;
    for (const entry of byMaterial.get(material)!) {
      for (let i = 0; i < entry.count; i++) indices[at++] = entry.group.indices[entry.start + i]! + entry.offset;
    }
    batches.push({ start, count: at - start, material });
  }
  return { positions, normals, uvs, colors, indices, batches };
}

/**
 * A building's groups as fewer meshes: the groups that lie near one another, and are alike in having baked
 * lighting, normals and coordinates or not, become one mesh, drawn with one batch for each material instead of
 * one for each batch of each group. Meshes are about `cell` yards across, so most of a large building can still
 * be left out when it is off screen. The input is left alone.
 */
export function mergeGroups(groups: WmoGroupSpec[], cell: number): WmoGroupSpec[] {
  const clusters = new Map<string, WmoGroupSpec[]>();
  for (const group of groups) {
    const [x, y, z] = centreOf(group);
    const key = `${group.colors ? 1 : 0}${group.normals ? 1 : 0}${group.uvs ? 1 : 0}:${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), group]);
  }
  return [...clusters.values()].map(mergeCluster);
}
