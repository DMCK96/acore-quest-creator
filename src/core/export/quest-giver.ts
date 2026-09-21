import type { WorldDb } from '../db/world-db';
import type { FieldValue, ScalarValue } from '../registry/types';

/**
 * The creature flag the server needs before it offers or accepts a quest from an NPC, and the
 * relation fields whose creatures need it. Objects cannot be fixed by a flag (their quest-giver
 * nature is their `type`), so they are not looked at here; validation warns about them instead.
 */
const QUEST_GIVER_BIT = 2n;
const CREATURE_TABLE = 'creature_template';
const FLAG_COLUMN = 'npcflag';
const RELATION_FIELDS = ['creature_queststarter', 'creature_questender'] as const;

/** Only a plain unsigned integer can be OR-ed: anything else is left alone rather than guessed at. */
const UNSIGNED_INT_TEXT = /^\d+$/;

export interface QuestGiverFix {
  entry: number;
  /** The flags the creature has now, so the UI can show what the patch adds to. */
  npcflag: number;
}

/** The creature entries named as this quest's starters or enders, deduplicated; `0` is "nobody". */
function creatureEntries(values: Record<string, FieldValue>): number[] {
  const ids = new Set<number>();
  for (const fieldId of RELATION_FIELDS) {
    const rows = values[fieldId];
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Array<Record<string, ScalarValue>>) {
      const id = row.id;
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * The quest's creature starters and enders whose `npcflag` lacks the quest-giver bit.
 *
 * A creature with no row, an unreadable flag, or a fork without `creature_template` is skipped:
 * the export never invents an UPDATE for a row it could not read.
 */
export async function findQuestGiverFixes(
  db: WorldDb,
  values: Record<string, FieldValue>,
): Promise<QuestGiverFix[]> {
  const entries = creatureEntries(values);
  if (entries.length === 0) return [];
  if ((await db.columns(CREATURE_TABLE)).length === 0) return [];

  const rows = await db.selectRows(CREATURE_TABLE, { entry: entries.map(String) });
  const fixes: QuestGiverFix[] = [];
  for (const row of rows) {
    const entry = row.entry;
    const flags = row[FLAG_COLUMN];
    if (entry === null || flags === null || !UNSIGNED_INT_TEXT.test(flags)) continue;
    if ((BigInt(flags) & QUEST_GIVER_BIT) !== 0n) continue;
    fixes.push({ entry: Number(entry), npcflag: Number(flags) });
  }
  return fixes.sort((a, b) => a.entry - b.entry);
}
