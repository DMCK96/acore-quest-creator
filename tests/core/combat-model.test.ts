import { describe, expect, it } from 'vitest';
import {
  autoCleanupEntries, emptyFight, fightIsEmpty, fightSchema, hasSurrender, newAbility, newReaction, nextId,
  phaseMask, phaseUses, removePhase, summonedEntries, withPhase, type Fight,
} from '../../src/core/combat/model';
import { ENTITIES_FIELD, newNpc, readEntities } from '../../src/core/entities/model';

const summon = (entry: number) => ({ kind: 'summonAdds' as const, entry, count: 1, at: 'aroundMe' as const, attack: true, waitMs: 0 });

describe('combat model', () => {
  it('loads NPCs saved before fights existed', () => {
    const e = readEntities({ [ENTITIES_FIELD]: { npcs: [{ ...newNpc(1), fight: undefined }], objects: [] } as never });
    expect(e.npcs[0]!.fight).toBeNull();
    expect(newNpc(2).fight).toBeNull();
  });

  it('keeps a valid fight and drops an NPC whose fight is damaged', () => {
    const fight: Fight = { ...emptyFight(), abilities: [newAbility(emptyFight())] };
    const e = readEntities({ [ENTITIES_FIELD]: { npcs: [{ ...newNpc(1), fight }, { ...newNpc(2), fight: { phases: 'x' } }], objects: [] } as never });
    expect(e.npcs.map((n) => n.entry)).toEqual([1]);
    expect(e.npcs[0]!.fight).toEqual(fight);
  });

  it('hands out ids past the highest in use', () => {
    expect(nextId('a', [])).toBe('a1');
    expect(nextId('a', [{ id: 'a1' }, { id: 'a7' }, { id: 'x9' }])).toBe('a8');
    expect(nextId('r', [{ id: 'r2' }])).toBe('r3');
  });

  it('starts a new ability and reaction with sensible defaults', () => {
    const f = { ...emptyFight(), abilities: [{ ...newAbility(emptyFight()), id: 'a4' }] };
    expect(newAbility(f)).toEqual({
      id: 'a5', spellId: 0, target: 'victim', firstMinS: 2, firstMaxS: 4, repeatMinS: 8, repeatMaxS: 12,
      keepDistance: false, skipIfAuraPresent: false, phases: [],
    });
    expect(newReaction(f, { kind: 'healthBelow', pct: 30 })).toEqual({ id: 'r1', when: { kind: 'healthBelow', pct: 30 }, phases: [], steps: [] });
  });

  it('adds missing phases with default names and never renames existing ones', () => {
    const f = withPhase({ ...emptyFight(), phases: ['Ground'] }, 3);
    expect(f.phases).toEqual(['Ground', 'Phase 2', 'Phase 3']);
    expect(withPhase(f, 2)).toBe(f);
  });

  it('builds phase masks', () => {
    expect(phaseMask([])).toBe(0);
    expect(phaseMask([1])).toBe(1);
    expect(phaseMask([2, 3])).toBe(6);
  });

  it('knows an empty fight', () => {
    expect(fightIsEmpty(null)).toBe(true);
    expect(fightIsEmpty(emptyFight())).toBe(true);
    expect(fightIsEmpty({ ...emptyFight(), phases: ['A'] })).toBe(true);
    expect(fightIsEmpty({ ...emptyFight(), abilities: [newAbility(emptyFight())] })).toBe(false);
  });

  it('lists summoned NPCs and whether the compiler must clean them up', () => {
    const f: Fight = { ...emptyFight(), reactions: [
      { id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [], steps: [summon(7), summon(0), summon(5), summon(7)] },
    ] };
    expect(summonedEntries(f)).toEqual([7, 5]);
    expect(autoCleanupEntries(f)).toEqual([7, 5]);
    const cleaned: Fight = { ...f, reactions: [...f.reactions, { id: 'r2', when: { kind: 'evade' }, phases: [], steps: [{ kind: 'despawnAdds', entry: 0, waitMs: 0 }] }] };
    expect(autoCleanupEntries(cleaned)).toEqual([]);
    expect(autoCleanupEntries(emptyFight())).toEqual([]);
  });

  it('knows a surrender', () => {
    expect(hasSurrender(emptyFight())).toBe(false);
    expect(hasSurrender({ ...emptyFight(), reactions: [{ id: 'r1', when: { kind: 'healthBelow', pct: 20 }, phases: [], steps: [{ kind: 'surrender', waitMs: 0 }] }] })).toBe(true);
  });

  it('refuses to remove a phase still in use and renumbers the rest', () => {
    const f: Fight = {
      phases: ['A', 'B', 'C'],
      abilities: [{ ...newAbility(emptyFight()), id: 'a1', phases: [3] }],
      reactions: [{ id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [1], steps: [{ kind: 'goToPhase', phase: 2, waitMs: 0 }] }],
    };
    expect(phaseUses(f, 2)).toEqual(['r1']);
    expect(removePhase(f, 2)).toBeNull();
    const g = removePhase({ ...f, reactions: [] }, 2)!;
    expect(g.phases).toEqual(['A', 'C']);
    expect(g.abilities[0]!.phases).toEqual([2]);
  });

  it('rejects out-of-range values in the schema', () => {
    expect(fightSchema.safeParse({ phases: [], abilities: [], reactions: [{ id: 'r1', when: { kind: 'kill' }, phases: [], steps: [{ kind: 'flee', waitMs: -1 }] }] }).success).toBe(false);
    expect(fightSchema.safeParse({ phases: [], abilities: [{ ...newAbility(emptyFight()), target: 'hurtFriend' }], reactions: [] }).success).toBe(false);
  });
});
