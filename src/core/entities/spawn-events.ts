import type { PatchStatement } from '../export/build-patch';
import { deletesOf, isDeleted, spawnEventsOf, type WorldLayer } from '../world/layer';
import type { CustomNpc, EventRule, NpcEvents, SpawnEvents } from './model';

/**
 * Which game events NPC spawns follow, as `game_event_creature` rows: one row per event, a positive
 * `eventEntry` while the spawn is there only during the event, a negative one while the event takes
 * it away. An NPC holds a rule its spawns follow; a spawn can hold its own (a project spawn, a spawn
 * placed in the 3D view, or a world layer edit of a database spawn). This module is the one writer of
 * those rows, so the NPC's rule and the spawns' own never write over each other.
 */

export type EventRow = Record<string, string | null>;

/** A spawn the patch decides the events of, and the rule it gets */
export interface PlannedSpawn {
  guid: number;
  entry: number;
  rule: EventRule;
}

const TABLE = 'game_event_creature';

const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A rule over these events, sorted and each once; none when there are no events */
export function makeRule(mode: 'during' | 'except', events: readonly number[]): EventRule {
  const ids = [...new Set(events)].sort((a, b) => a - b);
  return ids.length === 0 ? null : { mode, events: ids };
}

/** One spawn's rows as a rule; 'custom' when they mix both directions, which no rule can say */
export function ruleOfRows(rows: readonly EventRow[]): EventRule | 'custom' {
  const entries = rows.map((r) => num(r.eventEntry)).filter((e) => e !== 0);
  if (entries.length === 0) return null;
  const during = entries.every((e) => e > 0);
  if (!during && !entries.every((e) => e < 0)) return 'custom';
  return makeRule(during ? 'during' : 'except', entries.map(Math.abs));
}

/** The rows a rule writes for one spawn */
export function rowsOfRule(guid: number, rule: EventRule): EventRow[] {
  if (!rule) return [];
  const sign = rule.mode === 'during' ? 1 : -1;
  return rule.events.map((id) => ({ eventEntry: String(sign * id), guid: String(guid) }));
}

/** Whether two rules say the same; a custom set of rows matches no rule */
export function sameRule(a: EventRule, b: EventRule | 'custom'): boolean {
  if (b === 'custom') return false;
  if (a === null || b === null) return a === b;
  return a.mode === b.mode && a.events.length === b.events.length && a.events.every((id, i) => id === b.events[i]);
}

/** An NPC's rule as its spawns' rows give it: the one they all share, else as each spawn has it */
export function npcEventsOf(guids: readonly number[], rows: readonly EventRow[]): NpcEvents {
  const byGuid = new Map<number, EventRow[]>(guids.map((g) => [g, []]));
  for (const row of rows) byGuid.get(num(row.guid))?.push(row);
  const rules = [...byGuid.values()].map(ruleOfRows);
  const first = rules[0];
  if (first === undefined) return null;
  if (first === 'custom') return 'asIs';
  return rules.every((r) => sameRule(first, r)) ? first : 'asIs';
}

/** A spawn's own rule, or undefined when it follows its NPC */
const own = (events: SpawnEvents | undefined): EventRule | undefined => (events === undefined || events === 'npc' ? undefined : events);

/**
 * Every NPC spawn whose events the patch decides, in order: each project NPC's spawns (a new one's own,
 * an existing one's database spawns, and either's spawns placed in the 3D view), then the world layer's edits and placed spawns of
 * NPCs the project does not hold. A spawn with no rule of its own takes its NPC's; one whose NPC
 * leaves its spawns as they are is left out.
 */
export function spawnEventPlan(input: {
  npcs: readonly CustomNpc[];
  layer: WorldLayer;
  dbGuids: ReadonlyMap<number, readonly number[]>;
}): PlannedSpawn[] {
  const { npcs, layer, dbGuids } = input;
  const edits = new Map(spawnEventsOf(layer).map((e) => [e.guid, e.current]));
  const placed = layer.added.filter((a) => a.kind === 'creature');
  const plan: PlannedSpawn[] = [];
  const planned = new Set<number>();
  const put = (guid: number, entry: number, rule: EventRule | undefined): void => {
    // A spawn the layer deletes is left out: the patch removes it, so it must not write rows for it
    if (rule === undefined || planned.has(guid) || isDeleted(layer, 'creature', guid)) return;
    planned.add(guid);
    plan.push({ guid, entry, rule });
  };
  const fallback = (npc: CustomNpc): EventRule | undefined => (npc.events === 'asIs' ? undefined : npc.events);

  // Its own rule may be null (always there), which is still its own: only undefined follows the NPC
  const either = (mine: EventRule | undefined, npc: CustomNpc): EventRule | undefined => (mine !== undefined ? mine : fallback(npc));
  for (const npc of npcs) {
    if (npc.origin.kind === 'new') {
      for (const spawn of npc.spawns) put(spawn.guid, npc.entry, either(own(spawn.events), npc));
    } else {
      for (const guid of dbGuids.get(npc.entry) ?? []) put(guid, npc.entry, either(edits.get(guid), npc));
    }
    for (const a of placed) if (a.entry === npc.entry) put(a.guid, npc.entry, either(own(a.events), npc));
  }
  for (const edit of spawnEventsOf(layer)) put(edit.guid, edit.entry, edit.current);
  for (const a of placed) put(a.guid, a.entry, own(a.events));
  return plan;
}

/**
 * The patch for a plan: each spawn whose rule is not what its rows (`current`, read at export) already
 * say loses its rows and gets the rule's; the revert puts the rows it had back.
 */
export function spawnEventStatements(
  plan: readonly PlannedSpawn[],
  current: ReadonlyMap<number, readonly EventRow[]>,
): { apply: PatchStatement[]; revert: PatchStatement[] } {
  const apply: PatchStatement[] = [];
  const revert: PatchStatement[] = [];
  for (const { guid, rule } of plan) {
    const rows = current.get(guid) ?? [];
    if (sameRule(rule, ruleOfRows(rows))) continue;
    const key = { guid: String(guid) };
    apply.push({ kind: 'delete', table: TABLE, key }, ...rowsOfRule(guid, rule).map((row): PatchStatement => ({ kind: 'insert', table: TABLE, row })));
    revert.push({ kind: 'delete', table: TABLE, key }, ...rows.map((row): PatchStatement => ({ kind: 'insert', table: TABLE, row: { ...row } })));
  }
  return { apply, revert };
}

/** How many spawns an NPC has (the database's and placed ones, for an existing NPC) and how many follow events of their own */
export function npcSpawnFacts(npc: CustomNpc, layer: WorldLayer, existingSpawns: number): { spawns: number; overrides: number } {
  const placed = layer.added.filter((a) => a.kind === 'creature' && a.entry === npc.entry);
  const placedOwn = placed.filter((a) => own(a.events) !== undefined).length;
  if (npc.origin.kind === 'new') {
    return { spawns: npc.spawns.length + placed.length, overrides: npc.spawns.filter((s) => s.events !== 'npc').length + placedOwn };
  }
  const edits = spawnEventsOf(layer).filter((e) => e.entry === npc.entry);
  const deleted = deletesOf(layer).filter((d) => d.kind === 'creature' && d.entry === npc.entry).length;
  return { spawns: Math.max(0, existingSpawns - deleted) + placed.length, overrides: edits.length + placedOwn };
}
