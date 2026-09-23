import type { RawRow } from './types';

/** The world entities the editor can find by name. */
export type SearchKind = 'item' | 'creature' | 'gameobject' | 'quest';

/** One search result: the entity, its name, and a short fact that tells similar names apart. */
export interface EntityHit {
  id: number;
  name: string;
  detail?: string;
}

/** Where each kind lives, and the extra columns its `detail` is read from. */
export const ENTITY_TABLES: Record<SearchKind, { table: string; id: string; name: string; detail: readonly string[] }> = {
  item: { table: 'item_template', id: 'entry', name: 'name', detail: ['Quality'] },
  creature: { table: 'creature_template', id: 'entry', name: 'name', detail: ['minlevel', 'maxlevel'] },
  gameobject: { table: 'gameobject_template', id: 'entry', name: 'name', detail: [] },
  quest: { table: 'quest_template', id: 'ID', name: 'LogTitle', detail: ['QuestLevel'] },
};

const QUALITIES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];

/** A whole number searches by ID; anything else by name. */
export const ID_TEXT = /^\d+$/;

/** The detail line for one row; `undefined` when its columns are missing or say nothing. */
export function hitDetail(kind: SearchKind, row: RawRow): string | undefined {
  switch (kind) {
    case 'item': {
      const q = row.Quality;
      return q === undefined || q === null ? undefined : QUALITIES[Number(q)];
    }
    case 'creature': {
      if (row.minlevel == null || row.maxlevel == null) return undefined;
      return row.minlevel === row.maxlevel ? `Level ${row.minlevel}` : `Level ${row.minlevel}–${row.maxlevel}`;
    }
    case 'quest':
      return row.QuestLevel == null ? undefined : `Level ${row.QuestLevel}`;
    default:
      return undefined;
  }
}

/** Builds a hit from a row of `ENTITY_TABLES[kind]`. */
export function toHit(kind: SearchKind, row: RawRow): EntityHit {
  const spec = ENTITY_TABLES[kind];
  const detail = hitDetail(kind, row);
  const hit: EntityHit = { id: Number(row[spec.id]), name: row[spec.name] ?? '' };
  if (detail !== undefined) hit.detail = detail;
  return hit;
}

/** Exact name matches first, then names starting with the text, then the rest; ties by ID. */
export function rankHits(hits: readonly EntityHit[], text: string): EntityHit[] {
  const needle = text.toLowerCase();
  const rank = (h: EntityHit): number => {
    const name = h.name.toLowerCase();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
  };
  return [...hits].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}
