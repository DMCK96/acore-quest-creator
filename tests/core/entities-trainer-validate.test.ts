import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';

type T = NonNullable<CustomNpc['trainer']>;
const spell = (id: number, over: Partial<T['spells'][number]> = {}) => ({ spell: id, cost: 10, reqLevel: 1, reqSkill: 0, reqSkillRank: 0, reqSpells: [] as number[], ...over });
const trainer = (over: Partial<T> = {}): T => ({ trainerId: 900033, type: 'class', requirement: 1, greeting: 'Hi', spells: [spell(78)], ...over });
const npc = (t: T | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(1), x: 1 }], trainer: t, ...base });
const check = (n: CustomNpc | CustomNpc[], over: Partial<Parameters<typeof entityIssues>[0]> = {}) =>
  entityIssues({ entities: { npcs: Array.isArray(n) ? n : [n], objects: [], items: [] }, dbNames: new Map(), ...over });
const codes = (list: ReturnType<typeof check>) => list.map((i) => `${i.severity}:${i.code}`);
const users = (entries: Record<number, number[]>): ReadonlyMap<number, readonly number[]> => new Map(Object.entries(entries).map(([id, list]) => [Number(id), list]));

describe('trainer checks', () => {
  it('accepts a clean trainer', () => {
    expect(check(npc(trainer()), { knownSpell: () => true, trainerUsers: users({}) })).toEqual([]);
    expect(check(npc(null))).toEqual([]);
  });
  it('errors on no id, an unpicked spell, a repeated spell and a spell that needs itself', () => {
    expect(codes(check(npc(trainer({ trainerId: 0 }))))).toEqual(['error:TRAINER_NO_ID']);
    expect(codes(check(npc(trainer({ spells: [spell(0)] }))))).toEqual(['error:TRAINER_NO_SPELL']);
    expect(codes(check(npc(trainer({ spells: [spell(5), spell(6), spell(5), spell(5)] }))))).toEqual(['error:TRAINER_DUPLICATE']);
    expect(codes(check(npc(trainer({ spells: [spell(5, { reqSpells: [5] })] }))))).toEqual(['error:TRAINER_REQ_SPELL']);
  });
  it('warns, rather than errors, about a class trainer with no class: the server lets every class train there', () => {
    const issues = check(npc(trainer({ requirement: 0 })));
    expect(codes(issues)).toEqual(['warning:TRAINER_NO_CLASS']);
    expect(issues[0]!.message).toMatch(/every class/);
    expect(check(npc(trainer({ type: 'profession', requirement: 0 })))).toEqual([]);
    expect(check(npc(trainer({ type: 'pet', requirement: 0 })))).toEqual([]);
  });
  it('warns about an empty trainer', () => {
    expect(codes(check(npc(trainer({ spells: [] }))))).toEqual(['warning:TRAINER_EMPTY']);
  });
  it('warns about a spell the server does not have, once, only when it can tell', () => {
    expect(codes(check(npc(trainer({ spells: [spell(9), spell(9)] })), { knownSpell: () => false }))).toEqual(['error:TRAINER_DUPLICATE', 'warning:TRAINER_UNKNOWN_SPELL']);
    expect(check(npc(trainer({ spells: [spell(9)] })), { knownSpell: null })).toEqual([]);
  });
});

describe('a trainer id must be the NPC\'s own', () => {
  it('errors when another NPC in the database already uses the id', () => {
    expect(codes(check(npc(trainer()), { trainerUsers: users({ 900033: [555] }) }))).toEqual(['error:TRAINER_ID_TAKEN']);
  });
  it('lets a new NPC re-export the trainer it exported before, since only it uses the id', () => {
    expect(check(npc(trainer()), { trainerUsers: users({ 900033: [12000001] }) })).toEqual([]);
    expect(check(npc(trainer()), { trainerUsers: users({ 900033: [] }) })).toEqual([]);
  });
  it('errors when the project\'s own NPCs hold the same new id', () => {
    const a = npc(trainer());
    const b = npc(trainer(), { entry: 12000002, name: 'Orrin' });
    const issues = check([a, b]);
    expect(codes(issues)).toEqual(['error:TRAINER_ID_DUPLICATE', 'error:TRAINER_ID_DUPLICATE']);
    expect(issues.map((i) => i.about?.entry)).toEqual([12000001, 12000002]);
  });
  it('does not check the id of an existing NPC\'s own trainer, only a copy\'s new one', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    const own = npc(trainer({ trainerId: 17, greeting: 'Changed' }), { origin });
    expect(check(own, { trainerUsers: users({ 17: [12000001] }) })).toEqual([]);
    expect(codes(check(npc(trainer({ trainerId: 900033 }), { origin }), { trainerUsers: users({ 900033: [555] }) }))).toEqual(['error:TRAINER_ID_TAKEN']);
  });
});

describe('a trainer other NPCs use', () => {
  const rows = { creature_template: [], creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [{ Id: '17', Type: '0', Requirement: '1', Greeting: 'Hi' }], trainer_spell: [{ TrainerId: '17', SpellId: '78', MoneyCost: '10', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '1' }] };
  const read = (shared: number): CustomNpc => ({ ...npcFromRows(12000001, rows, { sharedLoot: 0, spawnCount: 1, sharedTrainer: shared }), name: 'Hela', displayId: 1 });

  it('errors when an edit would be written over a trainer others use now, whatever the lock says', () => {
    const edited = { ...read(0), trainer: { ...read(0).trainer!, greeting: 'Changed' } };
    expect(codes(check(edited, { trainerUsers: users({ 17: [12000001, 555] }) }))).toEqual(['error:TRAINER_SHARED']);
    expect(check(edited, { trainerUsers: users({ 17: [12000001] }) })).toEqual([]);
  });
  it('warns that an edit to a locked trainer is not written', () => {
    const locked = read(30);
    expect(codes(check({ ...locked, trainer: { ...locked.trainer!, greeting: 'Changed' } }))).toEqual(['warning:TRAINER_LOCKED']);
    expect(check(locked)).toEqual([]);
  });
  it('does not check a trainer left as it was read, whatever the database holds', () => {
    const odd = read(0);
    const quirky = { ...odd, trainer: { ...odd.trainer!, requirement: 0, spells: [spell(0)] } };
    const untouchedRows = { ...rows, trainer: [{ Id: '17', Type: '0', Requirement: '0', Greeting: 'Hi' }], trainer_spell: [{ ...rows.trainer_spell[0]!, SpellId: '0' }] };
    const read2 = { ...npcFromRows(12000001, untouchedRows, { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 }), name: 'Hela', displayId: 1 };
    expect(check(read2)).toEqual([]);
    expect(check(quirky).length).toBeGreaterThan(0);
  });
});

describe('a trainer that was never read', () => {
  it('only says it is not written', () => {
    const origin = { kind: 'existing' as const, original: { creature_template: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    expect(codes(check(npc(trainer({ spells: [spell(0)] }), { origin })))).toEqual(['warning:TRAINER_NOT_READ']);
    expect(check(npc(null, { origin }))).toEqual([]);
  });
});
