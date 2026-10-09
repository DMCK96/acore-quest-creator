import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';

type T = NonNullable<CustomNpc['trainer']>;
const spell = (id: number, over: Partial<T['spells'][number]> = {}) => ({ spell: id, cost: 10, reqLevel: 1, reqSkill: 0, reqSkillRank: 0, reqSpells: [] as number[], ...over });
const trainer = (over: Partial<T> = {}): T => ({ trainerId: 900033, type: 'class', requirement: 1, greeting: 'Hi', spells: [spell(78)], ...over });
const npc = (t: T | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(1), x: 1 }], trainer: t, ...base });
const check = (n: CustomNpc, over: Partial<Parameters<typeof entityIssues>[0]> = {}) => entityIssues({ entities: { npcs: [n], objects: [], items: [] }, dbNames: new Map(), ...over });
const codes = (list: ReturnType<typeof check>) => list.map((i) => `${i.severity}:${i.code}`);

describe('trainer checks', () => {
  it('accepts a clean trainer', () => {
    expect(check(npc(trainer()), { knownSpell: () => true, trainerIdTaken: () => false })).toEqual([]);
    expect(check(npc(null))).toEqual([]);
  });
  it('errors on no id, an unpicked spell, a repeated spell and a spell that needs itself', () => {
    expect(codes(check(npc(trainer({ trainerId: 0 }))))).toEqual(['error:TRAINER_NO_ID']);
    expect(codes(check(npc(trainer({ spells: [spell(0)] }))))).toEqual(['error:TRAINER_NO_SPELL']);
    expect(codes(check(npc(trainer({ spells: [spell(5), spell(6), spell(5), spell(5)] }))))).toEqual(['error:TRAINER_DUPLICATE']);
    expect(codes(check(npc(trainer({ spells: [spell(5, { reqSpells: [5] })] }))))).toEqual(['error:TRAINER_REQ_SPELL']);
  });
  it('errors on a class trainer with no class, since no player could use it, but not on other types', () => {
    expect(codes(check(npc(trainer({ requirement: 0 }))))).toEqual(['error:TRAINER_NO_CLASS']);
    expect(check(npc(trainer({ type: 'profession', requirement: 0 })))).toEqual([]);
  });
  it('warns about an empty trainer', () => {
    expect(codes(check(npc(trainer({ spells: [] }))))).toEqual(['warning:TRAINER_EMPTY']);
  });
  it('warns about a spell the server does not have, once, only when it can tell', () => {
    expect(codes(check(npc(trainer({ spells: [spell(9), spell(9)] })), { knownSpell: () => false }))).toEqual(['error:TRAINER_DUPLICATE', 'warning:TRAINER_UNKNOWN_SPELL']);
    expect(check(npc(trainer({ spells: [spell(9)] })), { knownSpell: null })).toEqual([]);
  });
  it('warns when a new trainer\'s id is already a trainer in the database', () => {
    expect(codes(check(npc(trainer()), { trainerIdTaken: (id) => id === 900033 }))).toEqual(['warning:TRAINER_ID_TAKEN']);
  });
  it('does not check the id of an existing NPC\'s own trainer, only a copy\'s new one', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '1', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    const taken = () => true;
    expect(check(npc(trainer({ trainerId: 17 }), { origin }), { trainerIdTaken: taken })).toEqual([]);
    expect(codes(check(npc(trainer({ trainerId: 900033 }), { origin }), { trainerIdTaken: taken }))).toEqual(['warning:TRAINER_ID_TAKEN']);
  });
  it('only says an unread trainer is not written', () => {
    const origin = { kind: 'existing' as const, original: { creature_template: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    expect(codes(check(npc(trainer({ spells: [spell(0)] }), { origin })))).toEqual(['warning:TRAINER_NOT_READ']);
    expect(check(npc(null, { origin }))).toEqual([]);
  });
  it('skips the checks of a locked shared trainer', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '1', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer' as const] };
    expect(check(npc(trainer({ trainerId: 17, spells: [spell(0)] }), { origin }))).toEqual([]);
  });
});
