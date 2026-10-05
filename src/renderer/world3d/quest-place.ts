import type { QuestSpawn, QuestSpawnGroup } from '../../shared/ipc';

const ROLE_ORDER: QuestSpawn['role'][] = ['giver', 'ender', 'objective', 'own'];

/**
 * Where a quest is: its first non-empty role (giver, ender, objective, then its own spawns), or with `only`
 * the spawns of that NPC/object; of those, the spawn on the camera's map nearest the camera, else the first.
 */
export function questPlace(
  groups: readonly QuestSpawnGroup[],
  from: { map: number; x: number; y: number; z: number },
  only?: { kind: 'creature' | 'gameobject'; entry: number },
): QuestSpawn | null {
  const all = groups.flatMap((g) => g.spawns);
  let pool: QuestSpawn[];
  if (only) pool = all.filter((s) => s.kind === only.kind && s.entry === only.entry);
  else {
    pool = [];
    for (const role of ROLE_ORDER) {
      pool = all.filter((s) => s.role === role);
      if (pool.length) break;
    }
  }
  if (!pool.length) return null;
  let best: QuestSpawn | null = null;
  let bestD = Infinity;
  for (const s of pool) {
    if (s.map !== from.map) continue;
    const d = (s.x - from.x) ** 2 + (s.y - from.y) ** 2 + (s.z - from.z) ** 2;
    if (d < bestD) { best = s; bestD = d; }
  }
  return best ?? pool[0];
}
