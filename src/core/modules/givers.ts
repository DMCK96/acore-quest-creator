import type { FieldValue } from '../registry/types';
import type { Values } from './model';

/** One NPC or object that offers or takes back the quest. */
export interface GiverTarget {
  kind: 'creature' | 'gameobject';
  id: number;
}

const TABLES = {
  start: { creature: 'creature_queststarter', gameobject: 'gameobject_queststarter' },
  end: { creature: 'creature_questender', gameobject: 'gameobject_questender' },
} as const;

const idsOf = (values: Values, table: string): number[] =>
  ((values[table] as Array<Record<string, unknown>> | undefined) ?? []).map((row) => Number(row.id));

/** The quest's starters (or enders): creatures first, then objects, each in table order. */
export function readGivers(values: Values, role: 'start' | 'end'): GiverTarget[] {
  const tables = TABLES[role];
  return [
    ...idsOf(values, tables.creature).map((id) => ({ kind: 'creature' as const, id })),
    ...idsOf(values, tables.gameobject).map((id) => ({ kind: 'gameobject' as const, id })),
  ];
}

/** Both relation tables of `role`, rebuilt from `targets`. */
export function writeGivers(role: 'start' | 'end', targets: readonly GiverTarget[]): Record<string, FieldValue> {
  const tables = TABLES[role];
  const rows = (kind: GiverTarget['kind']) => targets.filter((t) => t.kind === kind).map((t) => ({ id: t.id }));
  return { [tables.creature]: rows('creature'), [tables.gameobject]: rows('gameobject') };
}

/**
 * The giver field edits that take an NPC or object off a quest's cards: a card that named it goes
 * back to empty, as it was before New, and one empty card per role is enough. Only fields that change.
 */
export function emptyGiversOf(values: Values, kind: GiverTarget['kind'], entry: number): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const role of ['start', 'end'] as const) {
    const targets = readGivers(values, role);
    if (!targets.some((t) => t.kind === kind && t.id === entry)) continue;
    const emptied = targets.map((t) => (t.kind === kind && t.id === entry ? { ...t, id: 0 } : t));
    const kept = emptied.filter((t, i) => t.id !== 0 || emptied.findIndex((u) => u.id === 0) === i);
    for (const [fieldId, value] of Object.entries(writeGivers(role, kept))) {
      if (JSON.stringify(value) !== JSON.stringify(values[fieldId] ?? [])) out[fieldId] = value;
    }
  }
  return out;
}
