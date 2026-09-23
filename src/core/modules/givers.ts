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
