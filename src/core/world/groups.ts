// Spawn groups: the server's pools (pool_template, pool_creature, pool_gameobject, pool_pool, pool_quest).
// Only some of a set of spawns are up at a time, and groups can contain groups. A group of quests is a
// rotation: only some of its daily or weekly quests are offered each reset. A top-level spawn group can
// follow a game event (game_event_pool).

export type GroupMember =
  | { type: 'spawn'; kind: 'npc' | 'object'; guid: number; entry: number; chance: number }
  | { type: 'group'; id: number; chance: number }
  | { type: 'quest'; questId: number };

export interface SpawnGroup {
  id: number;
  name: string;
  map: number;
  maxActive: number;
  members: GroupMember[];
  /** The game event it runs with: during (positive) or except during (negative); null for always */
  event: { id: number; during: boolean } | null;
  origin:
    | { kind: 'new' }
    | {
        kind: 'existing';
        original: {
          template: Record<string, string | null>;
          members: { table: 'pool_creature' | 'pool_gameobject' | 'pool_pool' | 'pool_quest'; row: Record<string, string | null> }[];
          event: Record<string, string | null> | null;
        };
      };
  /** An existing group deleted here: its rows go on export and come back on revert */
  removed?: boolean;
}

export interface GroupContext {
  /** Every group reachable from the checked group's members: the layer's copy, else the database's */
  groups: ReadonlyMap<number, SpawnGroup>;
  spawnMap(kind: 'npc' | 'object', guid: number): number | null;
  /** The template type of an object spawn; null when not known */
  objectType(guid: number): number | null;
  groupOfSpawn(kind: 'npc' | 'object', guid: number): number | null;
  groupOfGroup(id: number): number | null;
  /** A quest in the project or the database; null when it is in neither */
  quest(questId: number): { title: string; daily: boolean; weekly: boolean; hasGiver: boolean } | null;
  /** The group holding this quest, if any */
  groupOfQuest(questId: number): number | null;
  /** Whether game_event has this event; null when not known */
  eventExists(id: number): boolean | null;
}

/** Object types a pool can hold: 3 chest (herbs and veins are chests), 10 usable object, 25 fishing school. */
export const POOLABLE_OBJECT_TYPES: ReadonlySet<number> = new Set([3, 10, 25]);

/** A member's identity: 'npc:<guid>', 'object:<guid>', 'group:<id>' or 'quest:<id>'. */
export const memberKey = (m: GroupMember): string =>
  m.type === 'group' ? `group:${m.id}` : m.type === 'quest' ? `quest:${m.questId}` : `${m.kind}:${m.guid}`;

/** A group with quest members is a quest pool (a rotation); its map means nothing. */
export const isQuestPool = (group: SpawnGroup): boolean => group.members.some((m) => m.type === 'quest');

type Chanced = Exclude<GroupMember, { type: 'quest' }>;
const chanced = <T extends object>(members: readonly T[]): (T & { chance: number })[] =>
  members.filter((m): m is T & { chance: number } => 'chance' in m && typeof m.chance === 'number');

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The percentage each 0-chance member gets: what the explicit chances leave, split evenly (0 when none). Quest members have no chance and are ignored. */
export function equalShare(all: readonly ({ chance: number } | { type: 'quest' })[]): number {
  const members = chanced(all);
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
  const spawnSide: Chanced[] = members.filter((m): m is Chanced => m.type !== 'quest');
  const total = round2(spawnSide.reduce((sum, m) => sum + round2(m.chance), 0));
  if (total > 100) problems.push('The chances add up to more than 100%.');
  else if (spawnSide.length > 0 && !spawnSide.some((m) => round2(m.chance) === 0) && total !== 100) {
    problems.push('With no equal-share member, the chances must add up to 100%.');
  }
  const questPool = isQuestPool(group);
  if (questPool && spawnSide.length > 0) problems.push('A spawn group holds quests or spawns, not both.');
  let cycle = false;
  let anyDaily = false;
  let anyWeekly = false;
  for (const m of members) {
    if (m.type === 'quest') {
      const quest = context.quest(m.questId);
      if (quest === null) {
        problems.push(`Quest ${m.questId} is not in the project or the database.`);
        continue;
      }
      if (quest.daily) anyDaily = true;
      if (quest.weekly) anyWeekly = true;
      if (!quest.daily && !quest.weekly) problems.push(`${quest.title} is not a daily or weekly quest.`);
      if (!quest.hasGiver) problems.push(`${quest.title} has no giver, so it is never offered.`);
      const other = context.groupOfQuest(m.questId);
      if (other !== null && other !== group.id) {
        const name = context.groups.get(other)?.name;
        problems.push(`${quest.title} is already in rotation ${name ? name : other}.`);
      }
    } else if (m.type === 'spawn') {
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
      // Every member group is in the context (the layer's copy, else the database's); a missing one, or one deleted here, is gone
      const child = context.groups.get(m.id);
      if (!child || child.removed) problems.push(`Group ${m.id} is not there any more.`);
      else if (child.map !== group.map) problems.push(`Group ${m.id} is on another map.`);
      const other = context.groupOfGroup(m.id);
      if (other !== null && other !== group.id) problems.push(`Group ${m.id} is already inside group ${other}.`);
      if (reaches(m.id, group.id, context.groups)) cycle = true;
    }
  }
  if (cycle) problems.push('A group cannot contain itself.');
  const parent = context.groupOfGroup(group.id);
  if (questPool) {
    if (members.filter((m) => m.type === 'quest').length < 2) problems.push('A rotation needs at least two quests.');
    if (anyDaily && anyWeekly) problems.push('Daily and weekly quests cannot share a rotation.');
    if (parent !== null) problems.push('A quest rotation cannot be inside another group.');
    if (group.event) problems.push('A quest rotation cannot follow an event.');
  } else if (group.event) {
    if (parent !== null) problems.push('Only a group that is not inside another can follow an event.');
    if (context.eventExists(group.event.id) === false) problems.push(`Event ${group.event.id} is not in the database.`);
  }
  return problems;
}
