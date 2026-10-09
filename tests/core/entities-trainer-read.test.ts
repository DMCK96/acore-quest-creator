import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { newNpc, projectEntitiesSchema, readProjectEntities, sameTrainer, trainerUnread } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const template = { entry: '198', name: 'Warrior Trainer', subname: '', minlevel: '30', maxlevel: '30', faction: '11', rank: '0', type: '7', npcflag: '51', lootid: '0', AIName: '', ScriptName: '' };
const trainer = { Id: '17', Type: '0', Requirement: '1', Greeting: 'Hello, warrior!', VerifiedBuild: '12340' };
const spell = (id: string, extra: Record<string, string> = {}) => ({ TrainerId: '17', SpellId: id, MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10', VerifiedBuild: '12340', ...extra });
const rows = { creature_template: [template], creature_default_trainer: [{ CreatureId: '198', TrainerId: '17' }], trainer: [trainer], trainer_spell: [spell('78'), spell('100', { ReqLevel: '4', ReqAbility1: '78', ReqAbility2: '5', ReqSkillLine: '26', ReqSkillRank: '50', MoneyCost: '3500' })] };

describe('reading an existing NPC\'s trainer', () => {
  it('maps the trainer, its type and class, and its spells in spell order', () => {
    const npc = npcFromRows(198, { ...rows, trainer_spell: [rows.trainer_spell[1]!, rows.trainer_spell[0]!] }, counts);
    expect(npc.trainer).toEqual({
      trainerId: 17, type: 'class', requirement: 1, greeting: 'Hello, warrior!',
      spells: [
        { spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] },
        { spell: 100, cost: 3500, reqLevel: 4, reqSkill: 26, reqSkillRank: 50, reqSpells: [78, 5] },
      ],
    });
    expect(npc.origin).toMatchObject({ kind: 'existing', locked: [] });
  });

  it('reads the other types and an NPC without a trainer', () => {
    const profession = { ...rows, trainer: [{ ...trainer, Type: '2', Requirement: '0' }] };
    expect(npcFromRows(198, profession, counts).trainer).toMatchObject({ type: 'profession', requirement: 0 });
    expect(npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '1' }] }, counts).trainer).toMatchObject({ type: 'mount' });
    expect(npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '3' }] }, counts).trainer).toMatchObject({ type: 'pet' });
    expect(npcFromRows(198, { creature_template: [template], creature_default_trainer: [] }, counts).trainer).toBeNull();
    expect(npcFromRows(198, { creature_template: [template] }, counts).trainer).toBeNull();
  });

  it('locks a trainer other NPCs share', () => {
    expect(npcFromRows(198, rows, { ...counts, sharedTrainer: 30 }).origin).toMatchObject({ locked: ['trainer'], sharedTrainer: 30 });
  });

  it('locks, and does not model, a trainer type it does not know or one whose row is missing', () => {
    const odd = npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '9' }] }, counts);
    expect(odd.trainer).toBeNull();
    expect(odd.origin).toMatchObject({ locked: ['trainer'] });
    const gone = npcFromRows(198, { ...rows, trainer: [] }, counts);
    expect(gone.trainer).toBeNull();
    expect(gone.origin).toMatchObject({ locked: ['trainer'] });
  });

  it('a new NPC and one saved before trainers have none', () => {
    expect(newNpc(1).trainer).toBeNull();
    const { trainer: _t, ...old } = newNpc(7);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.trainer).toBeNull();
    const bad = { ...newNpc(7), trainer: { trainerId: 1, type: 'class', requirement: 1, greeting: '', spells: [{ spell: 1, cost: -5, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } };
    expect(projectEntitiesSchema.safeParse({ npcs: [bad], objects: [], items: [] }).success).toBe(false);
    const tooMany = { ...bad, trainer: { ...bad.trainer, spells: [{ spell: 1, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [1, 2, 3, 4] }] } };
    expect(projectEntitiesSchema.safeParse({ npcs: [tooMany], objects: [], items: [] }).success).toBe(false);
  });

  it('knows a trainer never read from one that was', () => {
    expect(trainerUnread(npcFromRows(198, rows, counts))).toBe(false);
    const { creature_default_trainer: _k, ...unread } = rows;
    expect(trainerUnread(npcFromRows(198, unread, counts))).toBe(true);
    expect(trainerUnread(newNpc(1))).toBe(false);
  });

  it('compares trainers by value, in order', () => {
    const a = npcFromRows(198, rows, counts).trainer;
    const b = npcFromRows(198, rows, counts).trainer;
    expect(sameTrainer(a, b)).toBe(true);
    expect(sameTrainer(a, null)).toBe(false);
    expect(sameTrainer(null, null)).toBe(true);
    expect(sameTrainer(a, { ...b!, greeting: 'Hi' })).toBe(false);
    expect(sameTrainer(a, { ...b!, spells: [...b!.spells].reverse() })).toBe(false);
    const shuffledKeys = { requirement: b!.requirement, spells: b!.spells.map((s) => ({ reqSpells: s.reqSpells, reqSkillRank: s.reqSkillRank, reqSkill: s.reqSkill, reqLevel: s.reqLevel, cost: s.cost, spell: s.spell })), greeting: b!.greeting, type: b!.type, trainerId: b!.trainerId };
    expect(sameTrainer(a, shuffledKeys)).toBe(true);
  });
});

describe('the rows an existing NPC\'s trainer is read from', () => {
  const insertAll = (db: FakeWorldDb) => {
    db.insert('creature_template', template);
    db.insert('creature_default_trainer', { CreatureId: '198', TrainerId: '17' });
    db.insert('creature_default_trainer', { CreatureId: '328', TrainerId: '16' });
    db.insert('trainer', trainer);
    db.insert('trainer', { ...trainer, Id: '16' });
    db.insert('trainer_spell', spell('78'));
    db.insert('trainer_spell', { ...spell('78'), TrainerId: '16' });
    db.insert('npc_trainer', { ID: '198', SpellID: '-200007', MoneyCost: '0', ReqSkillLine: '0', ReqSkillRank: '0', ReqLevel: '0', ReqSpell: '0' });
  };

  it('reads the default trainer, its row, its spells and the NPC\'s npc_trainer rows', async () => {
    const db = forkDb();
    insertAll(db);
    const read = await readOriginalRows(db, 'npc', 198);
    expect(read!.creature_default_trainer).toEqual([{ CreatureId: '198', TrainerId: '17' }]);
    expect(read!.trainer).toEqual([trainer]);
    expect(read!.trainer_spell).toEqual([spell('78')]);
    expect(read!.npc_trainer).toHaveLength(1);
  });

  it('reads empty lists for an NPC that is not a trainer', async () => {
    const db = forkDb();
    insertAll(db);
    db.insert('creature_template', { ...template, entry: '999' });
    const read = await readOriginalRows(db, 'npc', 999);
    expect(read).toMatchObject({ creature_default_trainer: [], trainer: [], trainer_spell: [] });
  });

  it('leaves the keys out when the fork has no trainer tables, so the trainer is never written', async () => {
    const db = FakeWorldDb.fromFork(['creature_template', 'creature_template_model', 'creature_equip_template', 'creature_loot_template', 'creature', 'game_event_creature', 'npc_vendor']);
    db.insert('creature_template', template);
    const read = await readOriginalRows(db, 'npc', 198);
    for (const key of ['creature_default_trainer', 'trainer', 'trainer_spell']) expect(read).not.toHaveProperty(key);
  });
});
