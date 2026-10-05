// Spawn groups: the server's pools (pool_template, pool_creature, pool_gameobject, pool_pool).
// Only some of a set of spawns are up at a time, and groups can contain groups.

export type GroupMember =
  | { type: 'spawn'; kind: 'npc' | 'object'; guid: number; entry: number; chance: number }
  | { type: 'group'; id: number; chance: number };

export interface SpawnGroup {
  id: number;
  name: string;
  map: number;
  maxActive: number;
  members: GroupMember[];
  origin:
    | { kind: 'new' }
    | {
        kind: 'existing';
        original: {
          template: Record<string, string | null>;
          members: { table: 'pool_creature' | 'pool_gameobject' | 'pool_pool'; row: Record<string, string | null> }[];
          event: Record<string, string | null> | null;
        };
      };
  /** An existing group deleted here: its rows go on export and come back on revert */
  removed?: boolean;
}

export interface GroupContext {
  groups: ReadonlyMap<number, SpawnGroup>;
  spawnMap(kind: 'npc' | 'object', guid: number): number | null;
  /** The template type of an object spawn; null when not known */
  objectType(guid: number): number | null;
  groupOfSpawn(kind: 'npc' | 'object', guid: number): number | null;
  groupOfGroup(id: number): number | null;
}

/** Object types a pool can hold: 3 chest (herbs and veins are chests), 10 usable object, 25 fishing school. */
export const POOLABLE_OBJECT_TYPES: ReadonlySet<number> = new Set([3, 10, 25]);

/** A member's identity: 'npc:<guid>', 'object:<guid>' or 'group:<id>'. */
export const memberKey = (m: GroupMember): string => (m.type === 'group' ? `group:${m.id}` : `${m.kind}:${m.guid}`);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The percentage each 0-chance member gets: what the explicit chances leave, split evenly (0 when none). */
export function equalShare(members: readonly { chance: number }[]): number {
  const equal = members.filter((m) => m.chance === 0).length;
  if (equal === 0) return 0;
  const explicit = members.reduce((sum, m) => sum + m.chance, 0);
  return (100 - explicit) / equal;
}

/** True when walking down through member groups from `start` reaches `target`. */
function reaches(start: number, target: number, groups: ReadonlyMap<number, SpawnGroup>): boolean {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const m of groups.get(id)?.members ?? []) if (m.type === 'group') stack.push(m.id);
  }
  return false;
}

/** The problems that would make the server refuse or misread this group, in a fixed order. */
export function validateGroup(group: SpawnGroup, context: GroupContext): string[] {
  const problems: string[] = [];
  const members = group.members;
  if (members.length === 0) problems.push('Add at least one member.');
  if (!(group.maxActive >= 1 && group.maxActive <= members.length)) {
    problems.push('Up at once must be between 1 and the number of members.');
  }
  const total = round2(members.reduce((sum, m) => sum + round2(m.chance), 0));
  if (total > 100) problems.push('The chances add up to more than 100%.');
  else if (members.length > 0 && !members.some((m) => round2(m.chance) === 0) && total !== 100) {
    problems.push('With no equal-share member, the chances must add up to 100%.');
  }
  let cycle = false;
  for (const m of members) {
    if (m.type === 'spawn') {
      const map = context.spawnMap(m.kind, m.guid);
      if (map === null) problems.push(`Spawn ${m.guid} is not in the database any more.`);
      else if (map !== group.map) problems.push(`Spawn ${m.guid} is on another map.`);
      if (m.kind === 'object') {
        const type = context.objectType(m.guid);
        if (type !== null && !POOLABLE_OBJECT_TYPES.has(type)) {
          problems.push(`Spawn ${m.guid} cannot be pooled: only chests (herbs and veins are chests), usable objects and fishing schools can be.`);
        }
      }
      const other = context.groupOfSpawn(m.kind, m.guid);
      if (other !== null && other !== group.id) problems.push(`Spawn ${m.guid} is already in group ${other}.`);
    } else {
      const child = context.groups.get(m.id);
      if (child && child.map !== group.map) problems.push(`Group ${m.id} is on another map.`);
      const other = context.groupOfGroup(m.id);
      if (other !== null && other !== group.id) problems.push(`Group ${m.id} is already inside group ${other}.`);
      if (reaches(m.id, group.id, context.groups)) cycle = true;
    }
  }
  if (cycle) problems.push('A group cannot contain itself.');
  return problems;
}
