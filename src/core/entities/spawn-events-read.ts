import { rowsOrNone } from '../db/rows-or-none';
import { UnknownColumnError, UnknownTableError, type WorldDb } from '../db/world-db';
import type { EventRow } from './spawn-events';

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
