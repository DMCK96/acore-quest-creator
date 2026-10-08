import { describe, expect, it } from 'vitest';
import { questsInZone, questSummaries } from '../../src/core/lore/quests';
import { forkDb } from '../helpers/fixtures';

const ELWYNN = { id: 12, name: 'Elwynn Forest' };

function world() {
  const db = forkDb();
  db.insert('creature_template', { entry: '295', name: 'Innkeeper Farley' });
  db.insert('creature_template', { entry: '54', name: 'Brog Hamfist' });
  db.insert('creature_template', { entry: '6', name: 'Kobold Vermin' });
  db.insert('gameobject_template', { entry: '500', type: '8', displayId: '1', name: 'Anvil', size: '1' });
  db.insert('item_template', { entry: '1234', name: 'Kobold Candle' });
  db.insert('item_template', { entry: '2000', name: 'Worn Shortsword' });
  db.insert('item_template', { entry: '2001', name: 'Tattered Cloak' });
  db.insert('quest_template', { ID: '33', LogTitle: 'Kobold Camp Cleanup', QuestLevel: '10', MinLevel: '8', QuestSortID: '12' });
  db.insert('quest_template', { ID: '34', LogTitle: 'Daily Wolves', QuestLevel: '8', MinLevel: '6', QuestSortID: '12', Flags: '4096' });
  db.insert('quest_template', { ID: '35', LogTitle: 'Deep Forest', QuestLevel: '15', QuestSortID: '12' });
  db.insert('quest_template', { ID: '36', LogTitle: 'Scales', QuestLevel: '-1', QuestSortID: '12', Flags: '32768' });
  db.insert('quest_template', { ID: '37', LogTitle: 'Elsewhere', QuestLevel: '10', QuestSortID: '14' });
  db.insert('creature_queststarter', { id: '295', quest: '33' });
  db.insert('gameobject_queststarter', { id: '500', quest: '34' });
  return db;
}

describe('questsInZone', () => {
  it("lists a zone's quests by level, the scaling one last, and nothing from other zones", async () => {
    const out = await questsInZone(world(), ELWYNN, {});
    expect(out.zone).toEqual(ELWYNN);
    expect(out.quests.map((q) => q.id)).toEqual([34, 33, 35, 36]);
    expect(out.total).toBe(4);
    expect(out.truncated).toBe(false);
  });

  it('filters by level and always keeps a quest that scales to the player', async () => {
    expect((await questsInZone(world(), ELWYNN, { minLevel: 9, maxLevel: 11 })).quests.map((q) => q.id)).toEqual([33, 36]);
    expect((await questsInZone(world(), ELWYNN, { minLevel: 8, maxLevel: 8 })).quests.map((q) => q.id)).toEqual([34, 36]);
    expect((await questsInZone(world(), ELWYNN, { minLevel: 12 })).quests.map((q) => q.id)).toEqual([35, 36]);
  });

  it('marks daily and weekly quests and names who starts each', async () => {
    const byId = new Map((await questsInZone(world(), ELWYNN, {})).quests.map((q) => [q.id, q]));
    expect(byId.get(34)!.repeatable).toBe('daily');
    expect(byId.get(36)!.repeatable).toBe('weekly');
    expect(byId.get(33)!.repeatable).toBeNull();
    expect(byId.get(33)!.starters).toEqual([{ kind: 'creature', id: 295, name: 'Innkeeper Farley' }]);
    expect(byId.get(34)!.starters).toEqual([{ kind: 'gameobject', id: 500, name: 'Anvil' }]);
    expect(byId.get(33)!.minLevel).toBe(8);
  });

  it('cuts at the limit and says so', async () => {
    const out = await questsInZone(world(), ELWYNN, { limit: 2 });
    expect(out.quests.map((q) => q.id)).toEqual([34, 33]);
    expect(out.total).toBe(4);
    expect(out.truncated).toBe(true);
  });

  it('caps the limit at 200', async () => {
    const db = world();
    for (let i = 0; i < 210; i++) db.insert('quest_template', { ID: String(1000 + i), LogTitle: `Q${i}`, QuestLevel: '20', QuestSortID: '12' });
    const out = await questsInZone(db, ELWYNN, { limit: 9999 });
    expect(out.quests).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });
});

describe('questSummaries', () => {
  const zoneName = (id: number) => (id === 12 ? 'Elwynn Forest' : undefined);

  function full() {
    const db = world();
    db.insert('quest_template', {
      ID: '40', LogTitle: 'Candles for Farley', QuestLevel: '9', MinLevel: '7', QuestSortID: '12',
      LogDescription: 'Bring Farley 4 candles.', QuestDescription: 'The cellar is full of kobolds.', QuestCompletionLog: 'Return to Farley.',
      RequiredNpcOrGo1: '6', RequiredNpcOrGoCount1: '8', RequiredNpcOrGo2: '-500', RequiredNpcOrGoCount2: '1',
      RequiredItemId1: '1234', RequiredItemCount1: '4',
      RewardItem1: '2000', RewardAmount1: '1', RewardChoiceItemID1: '2001', RewardChoiceItemQuantity1: '1',
      RewardMoney: '150', RewardFactionID1: '72', RewardFactionValue1: '5',
    });
    db.insert('quest_template_addon', { ID: '40', PrevQuestID: '33', NextQuestID: '41', ExclusiveGroup: '5', BreadcrumbForQuestId: '0' });
    db.insert('quest_offer_reward', { ID: '40', RewardText: 'Thank you, friend.' });
    db.insert('quest_request_items', { ID: '40', CompletionText: 'Have you the candles?' });
    db.insert('creature_queststarter', { id: '295', quest: '40' });
    db.insert('creature_questender', { id: '54', quest: '40' });
    return db;
  }

  it('reads a whole quest without importing it', async () => {
    const out = await questSummaries(full(), [40], zoneName);
    expect(out.missing).toEqual([]);
    const q = out.quests[0]!;
    expect(q).toMatchObject({ id: 40, title: 'Candles for Farley', level: 9, minLevel: 7, zone: { id: 12, name: 'Elwynn Forest' }, repeatable: null });
    expect(q.text).toEqual({
      objectives: 'Bring Farley 4 candles.', details: 'The cellar is full of kobolds.', reward: 'Thank you, friend.',
      requestItems: 'Have you the candles?', completion: 'Return to Farley.',
    });
    expect(q.objectives).toEqual([
      { kind: 'creature', id: 6, name: 'Kobold Vermin', count: 8 },
      { kind: 'gameobject', id: 500, name: 'Anvil', count: 1 },
      { kind: 'item', id: 1234, name: 'Kobold Candle', count: 4 },
    ]);
    expect(q.rewards).toEqual({
      money: 150, items: [{ id: 2000, name: 'Worn Shortsword', count: 1 }], choices: [{ id: 2001, name: 'Tattered Cloak', count: 1 }],
      reputation: [{ faction: 72, value: 5 }],
    });
    expect(q.starters).toEqual([{ kind: 'creature', id: 295, name: 'Innkeeper Farley' }]);
    expect(q.enders).toEqual([{ kind: 'creature', id: 54, name: 'Brog Hamfist' }]);
    expect(q.chain).toEqual({ previous: 33, next: 41, exclusiveGroup: 5, breadcrumbFor: 0 });
  });

  it('reports ids it cannot find, keeps the order of the rest, and tolerates a quest with no extras', async () => {
    const out = await questSummaries(full(), [999, 33, 40], zoneName);
    expect(out.missing).toEqual([999]);
    expect(out.quests.map((q) => q.id)).toEqual([33, 40]);
    expect(out.quests[0]!.chain).toEqual({ previous: 0, next: 0, exclusiveGroup: 0, breadcrumbFor: 0 });
    expect(out.quests[0]!.text.reward).toBe('');
  });

  it('cuts a long text at 1500 characters and marks the cut', async () => {
    const db = full();
    db.insert('quest_template', { ID: '41', LogTitle: 'Long', QuestDescription: 'x'.repeat(2000), QuestLevel: '5' });
    const q = (await questSummaries(db, [41], zoneName)).quests[0]!;
    expect(q.text.details).toHaveLength(1501);
    expect(q.text.details.endsWith('…')).toBe(true);
  });

  it('names a zone it has no name for by its id, and gives no zone for a category', async () => {
    const db = full();
    db.insert('quest_template', { ID: '42', LogTitle: 'Odd zone', QuestLevel: '5', QuestSortID: '9999' });
    db.insert('quest_template', { ID: '43', LogTitle: 'Class quest', QuestLevel: '5', QuestSortID: '-81' });
    const out = await questSummaries(db, [42, 43], zoneName);
    expect(out.quests[0]!.zone).toEqual({ id: 9999, name: 'Zone 9999' });
    expect(out.quests[1]!.zone).toBeNull();
  });
});
