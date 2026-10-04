import type { FieldValue } from '../registry/types';
import { readGivers, writeGivers } from './givers';
import type { Values } from './model';

/**
 * The parts an existing NPC or object can play in a quest: offering it, taking it back, or being one
 * of its four kill-or-use objectives. Read from and written to the quest's own fields, so a change made
 * from the 3D view is an ordinary edit of the quest.
 */

export type Role = 'giver' | 'ender' | 'objective';
export type RoleTarget = { kind: 'creature' | 'gameobject'; id: number };
export interface QuestRoles {
  givers: RoleTarget[];
  enders: RoleTarget[];
  /** Always four slots; an empty one is null */
  objectives: (RoleTarget | null)[];
}

const OBJECTIVES = 'quest_template.RequiredNpcOrGo';
const SLOTS = 4;

type ObjectiveRow = { target: { target: 'creature' | 'gameobject'; id: number } | null; count: number };

const same = (a: RoleTarget, b: RoleTarget): boolean => a.kind === b.kind && a.id === b.id;

/** The four objective rows, an empty slot as `{ target: null, count: 0 }` */
function objectiveRows(values: Values): ObjectiveRow[] {
  const rows = Array.isArray(values[OBJECTIVES]) ? (values[OBJECTIVES] as Record<string, unknown>[]) : [];
  return Array.from({ length: SLOTS }, (_, i) => {
    const row = rows[i];
    const target = row?.target as { target?: string; id?: number } | null | undefined;
    if (!target || typeof target.id !== 'number' || target.id === 0) return { target: null, count: 0 };
    return { target: { target: target.target === 'gameobject' ? 'gameobject' : 'creature', id: target.id }, count: Number(row?.count ?? 0) };
  });
}

const targetOf = (row: ObjectiveRow): RoleTarget | null => (row.target ? { kind: row.target.target, id: row.target.id } : null);

export function questRoles(values: Values): QuestRoles {
  const givers = (role: 'start' | 'end') => readGivers(values, role).filter((t) => t.id !== 0);
  return { givers: givers('start'), enders: givers('end'), objectives: objectiveRows(values).map(targetOf) };
}

export function hasRole(roles: QuestRoles, role: Role, target: RoleTarget): boolean {
  const list = role === 'giver' ? roles.givers : role === 'ender' ? roles.enders : roles.objectives;
  return list.some((t) => t !== null && same(t, target));
}

/** The field edits that add or remove a role; null when an objective cannot be added (all four in use) */
export function toggleRole(values: Values, role: Role, target: RoleTarget, on: boolean): Record<string, FieldValue> | null {
  if (role !== 'objective') {
    const now = readGivers(values, role === 'giver' ? 'start' : 'end').filter((t) => t.id !== 0);
    const next = on ? (now.some((t) => same(t, target)) ? now : [...now, target]) : now.filter((t) => !same(t, target));
    return writeGivers(role === 'giver' ? 'start' : 'end', next);
  }
  const rows = objectiveRows(values);
  const at = rows.findIndex((row) => {
    const t = targetOf(row);
    return t !== null && same(t, target);
  });
  if (on) {
    if (at < 0) {
      const free = rows.findIndex((row) => row.target === null);
      if (free < 0) return null;
      rows[free] = { target: { target: target.kind, id: target.id }, count: 1 };
    }
  } else if (at >= 0) {
    rows[at] = { target: null, count: 0 };
  }
  return { [OBJECTIVES]: rows as unknown as FieldValue };
}
