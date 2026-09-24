import { describe, expect, it } from 'vitest';
import { fightIssues } from '../../src/core/combat/validate';
import { emptyFight, newAbility, type Fight, type FightStep } from '../../src/core/combat/model';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc } from '../../src/core/entities/model';

const a = { ...newAbility(emptyFight()), spellId: 116 };
const codes = (f: Fight, known: ((id: number) => boolean) | null = null, objectives: readonly number[] | null = null) =>
  fightIssues(f, 'NPC "Hela"', known, objectives).map((i) => `${i.severity}:${i.code}`);
const react = (steps: FightStep[], when: Fight['reactions'][number]['when'] = { kind: 'healthBelow', pct: 50 }, phases: number[] = []): Fight =>
  ({ ...emptyFight(), reactions: [{ id: 'r1', when, phases, steps }] });

describe('fightIssues', () => {
  it('passes a sound fight', () => {
    expect(codes({ ...emptyFight(), abilities: [a] })).toEqual([]);
  });
  it('flags missing spells, bad timings and bad health percentages', () => {
    expect(codes({ ...emptyFight(), abilities: [{ ...a, spellId: 0 }] })).toEqual(['error:FIGHT_NO_SPELL']);
    expect(codes(react([{ kind: 'cast', spellId: 0, target: 'self', waitMs: 0 }]))).toEqual(['error:FIGHT_NO_SPELL']);
    expect(codes({ ...emptyFight(), abilities: [{ ...a, firstMinS: 5, firstMaxS: 4 }] })).toEqual(['error:FIGHT_TIMING']);
    expect(codes({ ...emptyFight(), abilities: [{ ...a, repeatMinS: 0, repeatMaxS: 5 }] })).toEqual(['error:FIGHT_TIMING']);
    expect(codes({ ...emptyFight(), abilities: [{ ...a, firstMinS: -1 }] })).toEqual(['error:FIGHT_TIMING']);
    expect(codes(react([{ kind: 'flee', waitMs: 0 }], { kind: 'healthBelow', pct: 100 }))).toEqual(['error:FIGHT_HEALTH_PCT']);
    expect(codes(react([{ kind: 'holdAtHealth', pct: 0, waitMs: 0 }], { kind: 'aggro' }))).toEqual(['error:FIGHT_HEALTH_PCT']);
  });
  it('flags adds without an NPC and phases that do not exist or are never reached', () => {
    expect(codes(react([{ kind: 'summonAdds', entry: 0, count: 1, at: 'aroundMe', attack: true, waitMs: 0 }]))).toEqual(['error:FIGHT_NO_ADD']);
    expect(codes({ ...emptyFight(), abilities: [{ ...a, phases: [2] }] })).toEqual(['error:FIGHT_PHASE_MISSING']);
    expect(codes({ ...emptyFight(), phases: ['A', 'B'], abilities: [a] })).toEqual(['warning:FIGHT_PHASE_UNREACHED']);
  });
  it('flags two keep-distance abilities that can run in the same phase', () => {
    expect(codes({ ...emptyFight(), abilities: [{ ...a, keepDistance: true }, { ...a, id: 'a2', keepDistance: true }] })).toEqual(['error:FIGHT_TWO_MAIN_SPELLS']);
    const phased: Fight = { phases: ['A', 'B'], abilities: [{ ...a, keepDistance: true, phases: [1] }, { ...a, id: 'a2', keepDistance: true, phases: [2] }],
      reactions: [{ id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [], steps: [{ kind: 'goToPhase', phase: 2, waitMs: 0 }] }] };
    expect(codes(phased)).toEqual([]);
  });
  it('warns about unknown spells only when the spell list is loaded', () => {
    expect(codes({ ...emptyFight(), abilities: [a] }, (id) => id !== 116)).toEqual(['warning:FIGHT_UNKNOWN_SPELL']);
    expect(codes({ ...emptyFight(), abilities: [a] }, null)).toEqual([]);
  });
  it('warns about empty reactions, fast repeats, delayed death steps and despawning nothing', () => {
    expect(codes(react([]))).toEqual(['warning:FIGHT_EMPTY_REACTION']);
    expect(codes({ ...emptyFight(), abilities: [{ ...a, repeatMinS: 1, repeatMaxS: 3 }] })).toEqual(['warning:FIGHT_TOO_FAST']);
    expect(codes(react([{ kind: 'flee', waitMs: 0 }, { kind: 'surrender', waitMs: 1000 }], { kind: 'death' }))).toEqual(['warning:FIGHT_DEATH_WAIT']);
    expect(codes(react([{ kind: 'despawnAdds', entry: 0, waitMs: 0 }], { kind: 'evade' }))).toEqual(['warning:FIGHT_NOTHING_TO_DESPAWN']);
  });
  it('flags a cast on the hurt friend outside a friend-is-hurt reaction', () => {
    expect(codes(react([{ kind: 'cast', spellId: 2054, target: 'hurtFriend', waitMs: 0 }]))).toEqual(['error:FIGHT_HURT_FRIEND']);
    expect(codes(react([{ kind: 'cast', spellId: 2054, target: 'hurtFriend', waitMs: 0 }], { kind: 'friendHealthBelow', pct: 40, range: 30 }))).toEqual([]);
  });
  it('flags credit for an objective that is not an NPC objective, once the objectives are known', () => {
    const credit = react([{ kind: 'credit', objective: 2, group: false, waitMs: 0 }]);
    expect(codes(credit, null, [5, 0, 0, 0])).toEqual(['error:FIGHT_CREDIT_EMPTY']);
    expect(codes(credit, null, [5, 6, 0, 0])).toEqual([]);
    expect(codes(credit, null, null)).toEqual([]);
  });
  it('runs as part of the entity checks, named after the NPC', () => {
    const npc = { ...newNpc(1), name: 'Hela', displayId: 1, spawns: [{ guid: 1, map: 0, x: 1, y: 1, z: 1, o: 0, respawnSecs: 300, wander: 0, patrol: null }], fight: { ...emptyFight(), abilities: [{ ...a, spellId: 0 }] } };
    const issues = entityIssues({ entities: { npcs: [npc], objects: [] }, dbNames: new Map() });
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', code: 'FIGHT_NO_SPELL', fieldId: 'entities' })]);
    expect(issues[0]!.message).toMatch(/^NPC "Hela": /);
  });
});
