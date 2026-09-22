import type { FieldValue, ScalarValue } from '@core/registry/types';

/** Where a required item comes from: a creature or a gameobject, named by its template entry. */
export interface DropSource {
  kind: 'creature' | 'gameobject';
  entry: number;
}

/** One drop source for one item, as the drops UI edits it. */
export interface DropRow {
  source: DropSource;
  chance: number;
  minCount: number;
  maxCount: number;
}

export type Values = Record<string, FieldValue>;

interface Tables {
  loot: string;
  questItem: string;
  entryColumn: string;
}

const TABLES: Record<DropSource['kind'], Tables> = {
  creature: { loot: 'creature_loot_template', questItem: 'creature_questitem', entryColumn: 'CreatureEntry' },
  gameobject: { loot: 'gameobject_loot_template', questItem: 'gameobject_questitem', entryColumn: 'GameObjectEntry' },
};

type Row = Record<string, ScalarValue>;

const rows = (values: Values, table: string): Row[] => (values[table] as Row[] | undefined) ?? [];

/** Lists the sources that drop `itemId`, from both the creature and gameobject loot tables. */
export function listDropSources(values: Values, itemId: number): DropRow[] {
  const result: DropRow[] = [];
  for (const kind of ['creature', 'gameobject'] as const) {
    const { loot } = TABLES[kind];
    for (const row of rows(values, loot)) {
      if (row.Item !== itemId) continue;
      result.push({
        source: { kind, entry: row.Entry as number },
        chance: row.Chance as number,
        minCount: row.MinCount as number,
        maxCount: row.MaxCount as number,
      });
    }
  }
  return result;
}

/**
 * Adds (or, if the item already drops from that source, updates) a drop source for `itemId`.
 *
 * Returns a copy of `values` with only the touched loot and quest-item arrays replaced. The
 * quest-item row's `Idx` is the highest existing `Idx` for that entry, across whatever items it
 * already shows, plus one — 0 if the entry has none yet.
 *
 * That slot is only *provisional*: the aggregate holds the rows for this quest's items and nothing
 * else, so a slot another quest already uses looks free from here. The exporter reads the
 * creature's real rows (`fetchLinkedContext`) and moves the row to a genuinely free slot, with a
 * `LINKED_ROW_COLLISION` warning, rather than letting the patch delete the row that is there.
 */
export function addDropSource(values: Values, itemId: number, row: DropRow): Values {
  const { loot, questItem, entryColumn } = TABLES[row.source.kind];
  const lootRows = rows(values, loot);
  const existingIndex = lootRows.findIndex((r) => r.Entry === row.source.entry && r.Item === itemId);
  const lootRow = {
    Entry: row.source.entry,
    Item: itemId,
    Reference: 0,
    Chance: row.chance,
    QuestRequired: 1,
    LootMode: 1,
    GroupId: 0,
    MinCount: row.minCount,
    MaxCount: row.maxCount,
    Comment: null,
  };
  const nextLoot =
    existingIndex === -1
      ? [...lootRows, lootRow]
      : lootRows.map((r, i) => (i === existingIndex ? lootRow : r));

  const questItemRows = rows(values, questItem);
  const hasQuestItem = questItemRows.some((r) => r[entryColumn] === row.source.entry && r.ItemId === itemId);
  let nextQuestItem = questItemRows;
  if (!hasQuestItem) {
    const nextIdx =
      1 +
      questItemRows
        .filter((r) => r[entryColumn] === row.source.entry)
        .reduce((max, r) => Math.max(max, r.Idx as number), -1);
    nextQuestItem = [
      ...questItemRows,
      { [entryColumn]: row.source.entry, Idx: nextIdx, ItemId: itemId, VerifiedBuild: 0 },
    ];
  }

  return { ...values, [loot]: nextLoot, [questItem]: nextQuestItem };
}

/** Removes `source`'s loot row and quest-item row for `itemId` only, leaving other items alone. */
export function removeDropSource(values: Values, itemId: number, source: DropSource): Values {
  const { loot, questItem, entryColumn } = TABLES[source.kind];
  const nextLoot = rows(values, loot).filter((r) => !(r.Entry === source.entry && r.Item === itemId));
  const nextQuestItem = rows(values, questItem).filter(
    (r) => !(r[entryColumn] === source.entry && r.ItemId === itemId),
  );
  return { ...values, [loot]: nextLoot, [questItem]: nextQuestItem };
}
