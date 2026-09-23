import { describe, it, expect } from 'vitest';
import { factsFromAggregate, readWorldFacts } from '@core/links/facts';
import { instanceId, questEdges, scriptRowKey, isQuestLink, type ComponentInstance, type ScriptRow } from '@core/links/model';
import { forkDb, importFixture } from '../helpers/fixtures';

function seed() {
  const db = forkDb();
  db.insert('quest_template', { ID: '500', LogTitle: 'Middle', RewardNextQuest: '502' });
  db.insert('quest_template_addon', { ID: '500', PrevQuestID: '-499', NextQuestID: '501', ExclusiveGroup: '7' });
  db.insert('creature_queststarter', { id: '100', quest: '500' });
  db.insert('gameobject_queststarter', { id: '200', quest: '500' });
  db.insert('creature_questender', { id: '101', quest: '500' });
  db.insert('game_event_creature_quest', { eventEntry: '12', id: '102', quest: '500' });
  db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceEntry: '500', ConditionTypeOrReference: '8', ConditionValue1: '400' });
  db.insert('quest_template', { ID: '600', LogTitle: 'Bare' });
  return db;
}

const expected500 = {
  questId: 500, isNew: false,
  prevQuestId: -499, nextQuestId: 501, rewardNextQuest: 502, breadcrumbFor: 0, exclusiveGroup: 7,
  creatureStarters: [100], objectStarters: [200], creatureEnders: [101], objectEnders: [],
  eventStarters: [{ eventEntry: 12, kind: 'creature', id: 102 }], availabilityConditions: 1,
};

describe('readWorldFacts', () => {
  it('reads every chain column, giver and condition count for a quest', async () => {
    const facts = await readWorldFacts(seed(), [500]);
    expect(facts.get(500)).toEqual(expected500);
  });
  it('gives zeros for a quest with no addon row and leaves out quests that do not exist', async () => {
    const facts = await readWorldFacts(seed(), [600, 999]);
    expect(facts.get(600)).toMatchObject({ prevQuestId: 0, nextQuestId: 0, exclusiveGroup: 0, creatureStarters: [] });
    expect(facts.has(999)).toBe(false);
  });
  it('treats a table the fork lacks as no rows', async () => {
    const db = seed();
    db.dropTable('game_event_creature_quest');
    expect((await readWorldFacts(db, [500])).get(500)?.eventStarters).toEqual([]);
  });
  it('asks nothing for an empty list', async () => {
    expect((await readWorldFacts(seed(), [])).size).toBe(0);
  });
});

describe('factsFromAggregate', () => {
  it('matches the world facts for an imported quest', async () => {
    const db = seed();
    const { aggregate } = await importFixture(db, 500);
    expect(factsFromAggregate(aggregate)).toEqual(expected500);
  });
  it('marks a new quest and tolerates missing fields', () => {
    const f = factsFromAggregate({ questId: 60001, isNew: true, values: {}, readOnly: [], sharedItems: {} });
    expect(f).toMatchObject({ questId: 60001, isNew: true, prevQuestId: 0, creatureStarters: [], availabilityConditions: 0 });
  });
});

describe('model helpers', () => {
  const row: ScriptRow = { entryorguid: -5, sourceType: 0, id: 2, link: 3, eventType: 61, eventParams: [0, 0, 0, 0, 0, 0], actionType: 7, actionParams: [500, 0, 0, 0, 0, 0], targetType: 7, comment: '' };
  it('keys script rows by their primary key', () => {
    expect(scriptRowKey(row)).toBe('entryorguid=-5,source_type=0,id=2,link=3');
  });
  it('builds deterministic instance ids from claims', () => {
    const claims = [{ table: 'quest_template_addon', key: 'ID=2', column: 'PrevQuestID' }];
    expect(instanceId('unlock.afterTurnIn', claims)).toBe('unlock.afterTurnIn:quest_template_addon[ID=2].PrevQuestID');
    expect(instanceId('start.backend', [], '60001')).toBe('start.backend:60001');
  });
  it('turns quest links and finish-all groups into edges', () => {
    const link = { from: { kind: 'quest', questId: 1 }, to: { kind: 'quest', questId: 2 } } as ComponentInstance;
    expect(isQuestLink(link)).toBe(true);
    expect(questEdges(link)).toEqual([{ from: 1, to: 2 }]);
    const group = { component: 'group.finishAll', from: { kind: 'group', group: -3 }, to: { kind: 'group', group: -3 }, params: { members: [4, 5], then: 9 } } as unknown as ComponentInstance;
    expect(questEdges(group)).toEqual([{ from: 4, to: 9 }, { from: 5, to: 9 }]);
    const pick = { ...group, component: 'group.pickOne', params: { members: [4, 5], then: 0 } } as ComponentInstance;
    expect(questEdges(pick)).toEqual([]);
  });
});
