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

/** The event a database pool's top-level group follows, with the name of the pool the spawn is in; null when none */
async function poolEventOf(db: RowReader, guid: number): Promise<{ group: string; event: number } | null> {
  const [member] = await rowsOrNone(db, 'pool_creature', { guid: String(guid) });
  if (!member?.pool_entry) return null;
  const own = String(member.pool_entry);
  const [template] = await rowsOrNone(db, 'pool_template', { entry: own });
  let top = own;
  // A nested group follows its top-level group's event; a few levels is all the server nests
  for (let i = 0; i < 8; i += 1) {
    const [mother] = await rowsOrNone(db, 'pool_pool', { pool_id: top });
    if (!mother?.mother_pool) break;
    top = String(mother.mother_pool);
  }
  const [event] = await rowsOrNone(db, 'game_event_pool', { pool_entry: top });
  if (!event?.eventEntry) return null;
  return { group: describeOf(template, `Pool ${own}`), event: Math.abs(Number(event.eventEntry)) };
}

/**
 * What the patch should say about its spawn events: an event the database does not have, and a spawn
 * that follows events of its own while in a group that follows one (the server applies both). `names`
 * gives the project NPCs' names by entry.
 */
export async function spawnEventWarnings(
  db: RowReader,
  plan: readonly PlannedSpawn[],
  layer: WorldLayer,
  names: ReadonlyMap<number, string>,
): Promise<string[]> {
  const ruled = plan.filter((p): p is PlannedSpawn & { rule: NonNullable<PlannedSpawn['rule']> } => p.rule !== null);
  if (ruled.length === 0) return [];
  const ids = [...new Set(ruled.flatMap((p) => p.rule.events))].sort((a, b) => a - b);
  const known = new Map((await rowsOrNone(db, 'game_event', { eventEntry: ids.map(String) })).map((r) => [Number(r.eventEntry), r]));
  const warnings = ids.filter((id) => !known.has(id)).map((id) => `Event ${id} is not in game_event.`);
  const eventName = async (id: number): Promise<string> => {
    const row = known.get(id) ?? (await rowsOrNone(db, 'game_event', { eventEntry: String(id) }))[0];
    return describeOf(row, `Event ${id}`);
  };
  const groups = groupsOf(layer).filter((g) => !g.removed && g.event);
  for (const { guid, entry } of ruled) {
    const inLayer = groups.find((g) => g.members.some((m) => m.type === 'spawn' && m.kind === 'npc' && m.guid === guid));
    const found = inLayer ? { group: inLayer.name || `Group ${inLayer.id}`, event: inLayer.event!.id } : await poolEventOf(db, guid);
    if (!found) continue;
    const name = names.get(entry) ?? `NPC ${entry}`;
    warnings.push(`${name} (spawn ${guid}) follows events of its own and is in group ${found.group}, which follows ${await eventName(found.event)}. The server applies both.`);
  }
  return warnings;
}
