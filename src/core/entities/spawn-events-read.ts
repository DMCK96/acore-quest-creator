import { rowsOrNone } from '../db/rows-or-none';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import type { RawRow } from '../db/types';
import { groupsOf, type WorldLayer } from '../world/layer';
import type { EventRow, PlannedSpawn } from './spawn-events';

/**
 * Reading NPC spawns and their game event rows from the world database: what an existing NPC's event
 * rule is read from, and what the patch compares a spawn's rule with and puts back on revert.
 */

type RowReader = Pick<WorldDb, 'selectRows'>;

/** An entry's spawn guids, ascending; stock AzerothCore names the spawn's NPC `id1`, older forks `id` */
export async function npcSpawnGuids(db: RowReader, entry: number): Promise<number[]> {
  const read = async (column: string) => db.selectRows('creature', { [column]: String(entry) });
  let rows;
  try {
    rows = await read('id1');
  } catch (error) {
    if (error instanceof UnknownTableError) return [];
    if (!(error instanceof UnknownColumnError)) throw error;
    rows = await rowsOrNone(db, 'creature', { id: String(entry) });
  }
  return rows.map((r) => Number(r.guid)).filter(Number.isFinite).sort((a, b) => a - b);
}

/** Each guid's `game_event_creature` rows (none for a guid without any); empty when the table is not there */
export async function spawnEventRows(db: RowReader, guids: readonly number[]): Promise<Map<number, EventRow[]>> {
  if (guids.length === 0) return new Map();
  let rows;
  try {
    rows = await db.selectRows('game_event_creature', { guid: guids.map(String) });
  } catch (error) {
    if (error instanceof UnknownTableError || error instanceof UnknownColumnError) return new Map();
    throw error;
  }
  const out = new Map<number, EventRow[]>(guids.map((g) => [g, []]));
  for (const row of rows) out.get(Number(row.guid))?.push({ eventEntry: row.eventEntry ?? null, guid: row.guid ?? null });
  return out;
}

const describeOf = (row: RawRow | undefined, fallback: string): string => (row?.description ? String(row.description) : fallback);

/**
 * The event each spawn's database pool follows (its top-level group's), with the name of the pool the
 * spawn is in; spawns in no pool, or in one that follows no event, are left out. Read a level at a time
 * for every spawn at once, so many spawns cost a few queries.
 */
async function poolEventsOf(db: RowReader, guids: readonly number[]): Promise<Map<number, { group: string; event: number }>> {
  const out = new Map<number, { group: string; event: number }>();
  if (guids.length === 0) return out;
  const members = await rowsOrNone(db, 'pool_creature', { guid: guids.map(String) });
  const ownOf = new Map(members.filter((m) => m.pool_entry).map((m) => [Number(m.guid), String(m.pool_entry)]));
  const owns = [...new Set(ownOf.values())];
  if (owns.length === 0) return out;
  const names = new Map((await rowsOrNone(db, 'pool_template', { entry: owns })).map((t) => [String(t.entry), t]));
  // Each pool's top-level group: a nested group follows its top-level group's event, and the server nests a few levels at most
  const topOf = new Map(owns.map((o) => [o, o]));
  for (let level = 0; level < 8; level += 1) {
    const tops = [...new Set(topOf.values())];
    const mothers = new Map((await rowsOrNone(db, 'pool_pool', { pool_id: tops })).filter((m) => m.mother_pool).map((m) => [String(m.pool_id), String(m.mother_pool)]));
    if (mothers.size === 0) break;
    for (const [own, top] of topOf) if (mothers.has(top)) topOf.set(own, mothers.get(top)!);
  }
  const eventOf = new Map((await rowsOrNone(db, 'game_event_pool', { pool_entry: [...new Set(topOf.values())] })).map((e) => [String(e.pool_entry), Math.abs(Number(e.eventEntry))]));
  for (const [guid, own] of ownOf) {
    const event = eventOf.get(topOf.get(own)!);
    if (event) out.set(guid, { group: describeOf(names.get(own), `Pool ${own}`), event });
  }
  return out;
}

/**
 * What the patch should say about the spawn events it writes: an event the database does not have, and
 * a spawn that follows events of its own while in a group that follows one (the server applies both).
 * A group the world layer holds is read from the layer, the rest from the database. `names` gives the
 * project NPCs' names by entry.
 */
export async function spawnEventWarnings(
  db: RowReader,
  plan: readonly PlannedSpawn[],
  layer: WorldLayer,
  names: ReadonlyMap<number, string>,
): Promise<string[]> {
  const ruled = plan.filter((p): p is PlannedSpawn & { rule: NonNullable<PlannedSpawn['rule']> } => p.rule !== null);
  if (ruled.length === 0) return [];
  const layerGroupOf = (guid: number) => groupsOf(layer).find((g) => g.members.some((m) => m.type === 'spawn' && m.kind === 'npc' && m.guid === guid));
  const fromLayer = new Map(ruled.map((p) => [p.guid, layerGroupOf(p.guid)] as const).filter(([, g]) => g !== undefined));
  const pools = await poolEventsOf(db, ruled.map((p) => p.guid).filter((g) => !fromLayer.has(g)));
  const groupOf = (guid: number): { group: string; event: number } | undefined => {
    const g = fromLayer.get(guid);
    if (!g) return pools.get(guid);
    return !g.removed && g.event ? { group: g.name || `Group ${g.id}`, event: g.event.id } : undefined;
  };
  const ids = [...new Set([...ruled.flatMap((p) => p.rule.events), ...ruled.flatMap((p) => groupOf(p.guid)?.event ?? [])])].sort((a, b) => a - b);
  const known = new Map((await rowsOrNone(db, 'game_event', { eventEntry: ids.map(String) })).map((r) => [Number(r.eventEntry), r]));
  const ruledIds = new Set(ruled.flatMap((p) => p.rule.events));
  const warnings = ids.filter((id) => ruledIds.has(id) && !known.has(id)).map((id) => `Event ${id} is not in game_event.`);
  for (const { guid, entry } of ruled) {
    const found = groupOf(guid);
    if (!found) continue;
    const name = names.get(entry) ?? `NPC ${entry}`;
    warnings.push(`${name} (spawn ${guid}) follows events of its own and is in group ${found.group}, which follows ${describeOf(known.get(found.event), `Event ${found.event}`)}. The server applies both.`);
  }
  return warnings;
}
