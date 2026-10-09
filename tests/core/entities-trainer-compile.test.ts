import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { ENTITY_KEYS, ENTITY_TABLES, EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

const trainer = (over: Partial<NonNullable<CustomNpc['trainer']>> = {}) => ({
  trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hello!',
  spells: [
    { spell: 100, cost: 3500, reqLevel: 4, reqSkill: 26, reqSkillRank: 50, reqSpells: [78, 5] },
    { spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] },
  ],
  ...over,
});
const teacher: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(6000001) }], trainer: trainer() };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1 };
const compile = (npcs: CustomNpc[], context = EMPTY_ENTITY_CONTEXT) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context });

describe('compiling a new NPC\'s trainer', () => {
  it('writes the default-trainer row, the trainer and its spells in spell order', () => {
    const out = compile([teacher]);
    expect(out.inserts.creature_default_trainer).toEqual([{ CreatureId: '12000001', TrainerId: '900033' }]);
    expect(out.inserts.trainer).toEqual([{ Id: '900033', Type: '0', Requirement: '1', Greeting: 'Hello!' }]);
    expect(out.inserts.trainer_spell).toEqual([
      { TrainerId: '900033', SpellId: '78', MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10' },
      { TrainerId: '900033', SpellId: '100', MoneyCost: '3500', ReqSkillLine: '26', ReqSkillRank: '50', ReqAbility1: '78', ReqAbility2: '5', ReqAbility3: '0', ReqLevel: '4' },
    ]);
  });

  it('writes 0 as the requirement of the other types', () => {
    expect(compile([{ ...teacher, trainer: trainer({ type: 'profession', requirement: 7 }) }]).inserts.trainer![0]).toMatchObject({ Type: '2', Requirement: '0' });
    expect(compile([{ ...teacher, trainer: trainer({ type: 'mount' }) }]).inserts.trainer![0]).toMatchObject({ Type: '1', Requirement: '0' });
    expect(compile([{ ...teacher, trainer: trainer({ type: 'pet' }) }]).inserts.trainer![0]).toMatchObject({ Type: '3', Requirement: '0' });
  });

  it('sets the trainer bit and the type\'s sub-type bit with the gossip bit, and nothing for a non-trainer', () => {
    const flag = (t: ReturnType<typeof trainer> | null) => compile([{ ...teacher, trainer: t }]).inserts.creature_template![0]!.npcflag;
    expect(flag(trainer())).toBe(String(1 | 16 | 32));
    expect(flag(trainer({ type: 'profession' }))).toBe(String(1 | 16 | 64));
    expect(flag(trainer({ type: 'mount' }))).toBe(String(1 | 16 | 64));
    expect(flag(trainer({ type: 'pet' }))).toBe(String(1 | 16));
    expect(flag(null)).toBe('1');
  });

  it('deletes every new NPC\'s default-trainer row and each trainer it holds, so a removed spell or trainer is cleaned on re-export', () => {
    const out = compile([teacher, plain]);
    expect(out.deletes.creature_default_trainer).toEqual([{ CreatureId: '12000001' }, { CreatureId: '12000002' }]);
    expect(out.deletes.trainer).toEqual([{ Id: '900033' }]);
    expect(out.deletes.trainer_spell).toEqual([{ TrainerId: '900033' }]);
  });

  it('also deletes a trainer the database has it pointing at from an earlier export, but never another NPC\'s', () => {
    const context = { ...EMPTY_ENTITY_CONTEXT, trainerIds: [{ CreatureId: '12000001', TrainerId: '900031' }, { CreatureId: '555', TrainerId: '17' }] };
    const out = compile([{ ...teacher, trainer: null }], context);
    expect(out.deletes.trainer).toEqual([{ Id: '900031' }]);
    expect(out.deletes.trainer_spell).toEqual([{ TrainerId: '900031' }]);
  });

  it('is a table the entities are written to, keyed correctly', () => {
    for (const table of ['creature_default_trainer', 'trainer', 'trainer_spell']) expect(ENTITY_TABLES).toContain(table);
    expect(ENTITY_KEYS.creature_default_trainer).toEqual(['CreatureId']);
    expect(ENTITY_KEYS.trainer).toEqual(['Id']);
    expect(ENTITY_KEYS.trainer_spell).toEqual(['TrainerId', 'SpellId']);
  });

  it('orders the statements: spells and the default row deleted before the trainer, all inserted after the template', async () => {
    const tables = ['creature_template', 'creature_template_model', 'creature_default_trainer', 'trainer', 'trainer_spell'];
    const schema = await loadSchema(FakeWorldDb.fromFork(tables), tables);
    const { statements } = scriptStatements(compile([teacher]), schema);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'trainer_spell')).toBeLessThan(at('delete', 'trainer'));
    expect(at('delete', 'creature_default_trainer')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('delete', 'trainer')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'trainer'));
    expect(at('insert', 'trainer')).toBeLessThan(at('insert', 'trainer_spell'));
    expect(at('insert', 'trainer')).toBeLessThan(at('insert', 'creature_default_trainer'));
  });
});
