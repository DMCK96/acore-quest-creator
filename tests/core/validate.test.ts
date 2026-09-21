import { describe, it, expect } from 'vitest';
import { validateQuest, refCheckerFor, type RefChecker } from '@core/validate/validate';
import { FakeWorldDb } from '../helpers/fake-world-db';
import type { QuestAggregate } from '@core/model/aggregate';

const base = (values: Record<string, any> = {}): QuestAggregate => ({
  questId: 60001, isNew: true, readOnly: [], sharedItems: {},
  values: {
    'quest_template.LogTitle': 'Fetch', 'quest_template.QuestLevel': 10, 'quest_template.MinLevel': 5,
    'quest_template.StartItem': 0, 'quest_template.RewardItems': [], 'quest_template.RewardChoiceItems': [],
    'quest_template.RequiredItems': [], 'quest_template.RequiredNpcOrGo': [],
    'quest_template_addon.PrevQuestID': 0, 'quest_template_addon.NextQuestID': 0, 'quest_template_addon.BreadcrumbForQuestId': 0,
    creature_queststarter: [{ id: 1 }], gameobject_queststarter: [], creature_questender: [{ id: 2 }], gameobject_questender: [], areatrigger_involvedrelation: [],
    ...values,
  },
});
const allExist: RefChecker = { exists: async () => true, questGiver: async () => true };
const nothingExists: RefChecker = { exists: async () => false, questGiver: async () => null };
const codes = async (a: QuestAggregate, r: RefChecker = allExist) => (await validateQuest(a, r)).map((i) => i.code);

describe('validateQuest', () => {
  it('passes a complete quest', async () => expect(await codes(base())).toEqual([]));
  it('requires a title', async () => {
    const issues = await validateQuest(base({ 'quest_template.LogTitle': '  ' }), allExist);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'NO_TITLE', severity: 'error', fieldId: 'quest_template.LogTitle' }));
  });
  it('flags a missing starter and ender, but not when a start item or trigger exists', async () => {
    const none = base({ creature_queststarter: [], creature_questender: [] });
    expect(await codes(none)).toEqual(expect.arrayContaining(['NO_STARTER', 'NO_ENDER']));
    expect(await codes(base({ creature_queststarter: [], 'quest_template.StartItem': 25 }))).not.toContain('NO_STARTER');
    expect(await codes(base({ creature_questender: [], areatrigger_involvedrelation: [{ id: 5 }] }))).not.toContain('NO_ENDER');
  });
  it('checks chain references using the absolute value and treats the quest itself as existing', async () => {
    const onlyMissing55: RefChecker = { exists: async (k, id) => !(k === 'quest' && id === 55), questGiver: async () => true };
    const c = await codes(base({ 'quest_template_addon.PrevQuestID': -55, 'quest_template_addon.NextQuestID': 60001 }), onlyMissing55);
    expect(c).toContain('DANGLING_PREV');
    expect(c).not.toContain('DANGLING_NEXT');
    expect(await codes(base({ 'quest_template_addon.BreadcrumbForQuestId': 55 }), onlyMissing55)).toContain('DANGLING_BREADCRUMB');
  });
  it('warns about items, creatures and objects that do not exist', async () => {
    const a = base({
      'quest_template.RewardItems': [{ item: 1, amount: 1 }], 'quest_template.RequiredItems': [{ item: 2, count: 1 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 3 }, count: 1 }, { target: { target: 'gameobject', id: 4 }, count: 1 }],
    });
    const issues = await validateQuest(a, nothingExists);
    const byCode = (c: string) => issues.filter((i) => i.code === c);
    expect(byCode('MISSING_ITEM')).toHaveLength(2);
    expect(byCode('MISSING_CREATURE').length).toBeGreaterThanOrEqual(1);
    expect(byCode('MISSING_GAMEOBJECT')).toHaveLength(1);
    expect(issues.every((i) => i.severity === 'warning' || i.code.startsWith('DANGLING') || i.code === 'NO_TITLE')).toBe(true);
  });
  it('warns when an object starter or ender is not a quest-giver object, but never for creatures', async () => {
    const notGiver: RefChecker = { exists: async () => true, questGiver: async () => false };
    const a = base({ creature_queststarter: [{ id: 1 }], creature_questender: [{ id: 2 }], gameobject_queststarter: [{ id: 10 }], gameobject_questender: [{ id: 11 }] });
    const flagged = (await validateQuest(a, notGiver)).filter((i) => i.code === 'NOT_QUESTGIVER');
    expect(flagged.map((i) => i.fieldId).sort()).toEqual(['gameobject_questender', 'gameobject_queststarter']);
    expect(flagged.every((i) => i.severity === 'warning')).toBe(true);
    expect(flagged[0].message).toMatch(/never be (offered|turned in)/i);
    const missing: RefChecker = { exists: async () => true, questGiver: async () => null };
    expect(await codes(a, missing)).not.toContain('NOT_QUESTGIVER');
  });
  it('warns when MinLevel exceeds QuestLevel', async () => {
    expect(await codes(base({ 'quest_template.MinLevel': 20, 'quest_template.QuestLevel': 10 }))).toContain('MIN_LEVEL_ABOVE_LEVEL');
    expect(await codes(base({ 'quest_template.MinLevel': 20, 'quest_template.QuestLevel': -1 }))).not.toContain('MIN_LEVEL_ABOVE_LEVEL');
  });
  it('skips checks for fields absent from the aggregate (read-only or drifted)', async () => {
    const a = base(); delete a.values['quest_template.LogTitle'];
    expect(await codes(a)).not.toContain('NO_TITLE');
  });
});

describe('refCheckerFor', () => {
  it('reads quest-giver status from npcflag and object type', async () => {
    const db = FakeWorldDb.fromFork(['creature_template', 'gameobject_template']);
    db.insert('creature_template', { entry: '1', npcflag: '3' });
    db.insert('creature_template', { entry: '2', npcflag: '0' });
    db.insert('gameobject_template', { entry: '10', type: '2' });
    db.insert('gameobject_template', { entry: '11', type: '5' });
    const r = refCheckerFor(db);
    expect(await r.questGiver('creature', 1)).toBe(true);
    expect(await r.questGiver('creature', 2)).toBe(false);
    expect(await r.questGiver('creature', 3)).toBeNull();
    expect(await r.questGiver('gameobject', 10)).toBe(true);
    expect(await r.questGiver('gameobject', 11)).toBe(false);
  });
  it('returns null when the template table is absent from the fork', async () => {
    const r = refCheckerFor(FakeWorldDb.fromFork(['item_template']));
    expect(await r.questGiver('creature', 1)).toBeNull();
    expect(await r.questGiver('gameobject', 1)).toBeNull();
  });
  it('asks the DB once per id', async () => {
    const db = FakeWorldDb.fromFork(['item_template']);
    db.insert('item_template', { entry: '25', name: 'x' });
    let calls = 0;
    const orig = db.existingIds.bind(db);
    db.existingIds = async (k, ids) => { calls++; return orig(k, ids); };
    const r = refCheckerFor(db);
    expect(await r.exists('item', 25)).toBe(true);
    expect(await r.exists('item', 25)).toBe(true);
    expect(await r.exists('item', 26)).toBe(false);
    expect(calls).toBe(2);
  });
});
