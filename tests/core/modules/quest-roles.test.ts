import { describe, expect, it } from 'vitest';
import { hasRole, questRoles, toggleRole } from '../../../src/core/modules/quest-roles';
import type { FieldValue } from '../../../src/core/registry/types';

const guard = { kind: 'creature' as const, id: 1423 };
const crate = { kind: 'gameobject' as const, id: 143981 };
const objectives = (ids: (number | null)[]): FieldValue => ids.map((id) => (id === null ? { target: null, count: 0 } : { target: { target: id > 0 ? 'creature' : 'gameobject', id: Math.abs(id) }, count: 1 })) as unknown as FieldValue;

describe('a quest’s givers, enders and objectives', () => {
  it('reads each role, with four objective slots', () => {
    const roles = questRoles({ creature_queststarter: [{ id: 1423 }], gameobject_questender: [{ id: 143981 }], 'quest_template.RequiredNpcOrGo': objectives([-143981]) });
    expect(roles.givers).toEqual([guard]);
    expect(roles.enders).toEqual([crate]);
    expect(roles.objectives).toEqual([crate, null, null, null]);
    expect(hasRole(roles, 'objective', crate)).toBe(true);
    expect(hasRole(roles, 'giver', crate)).toBe(false);
  });

  it('adds and removes a giver through both relation tables', () => {
    const edits = toggleRole({ creature_queststarter: [{ id: 1 }] }, 'giver', guard, true)!;
    expect(edits).toEqual({ creature_queststarter: [{ id: 1 }, { id: 1423 }], gameobject_queststarter: [] });
    expect(toggleRole({ creature_queststarter: [{ id: 1 }, { id: 1423 }] }, 'giver', guard, false)).toEqual({ creature_queststarter: [{ id: 1 }], gameobject_queststarter: [] });
  });

  it('adds an objective in the first free slot with count 1, and removing empties its slot', () => {
    const values = { 'quest_template.RequiredNpcOrGo': objectives([1, null, 2]) };
    expect(toggleRole(values, 'objective', crate, true)).toEqual({ 'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 1 }, count: 1 }, { target: { target: 'gameobject', id: 143981 }, count: 1 }, { target: { target: 'creature', id: 2 }, count: 1 }, { target: null, count: 0 }] });
    expect(toggleRole({ 'quest_template.RequiredNpcOrGo': objectives([1423, 2]) }, 'objective', guard, false)).toEqual({ 'quest_template.RequiredNpcOrGo': objectives([null, 2, null, null]) });
  });

  it('cannot add a fifth objective, and adding one already there changes nothing', () => {
    expect(toggleRole({ 'quest_template.RequiredNpcOrGo': objectives([1, 2, 3, 4]) }, 'objective', guard, true)).toBeNull();
    expect(toggleRole({ 'quest_template.RequiredNpcOrGo': objectives([1423]) }, 'objective', guard, true)).toEqual({ 'quest_template.RequiredNpcOrGo': objectives([1423, null, null, null]) });
  });
});
