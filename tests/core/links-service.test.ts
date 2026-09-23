import { describe, it, expect } from 'vitest';
import { loadLinks, touches } from '@core/links/service';
import type { QuestAggregate } from '@core/model/aggregate';
import { forkDb, importFixture } from '../helpers/fixtures';

function seed() {
  const db = forkDb();
  db.insert('quest_template', { ID: '1', LogTitle: 'One', RewardNextQuest: '2' });
  db.insert('quest_template', { ID: '2', LogTitle: 'Two' });
  db.insert('quest_template_addon', { ID: '2', PrevQuestID: '1' });
  db.insert('creature_questender', { id: '100', quest: '1' });
  return db;
}

describe('loadLinks', () => {
  it('uses the draft over the world row for a quest the project holds', async () => {
    const db = seed();
    const { aggregate } = await importFixture(db, 2);
    const edited: QuestAggregate = { ...aggregate, values: { ...aggregate.values, 'quest_template_addon.PrevQuestID': 0 } };
    const snap = await loadLinks(db, [1, 2], new Map([[2, edited]]));
    expect(snap.result.instances.some((i) => i.component === 'unlock.afterTurnIn')).toBe(false);
  });
  it('reads facts for quests a scoped link points at, so checks across a link can see both ends', async () => {
    const snap = await loadLinks(seed(), [1], new Map());
    expect(snap.facts.has(2)).toBe(true);
    expect(snap.result.instances.every((i) => touches(i, 1))).toBe(true);
  });
  it('finds quests that point back at the scope, since a chain is often written on its later quest only', async () => {
    const db = seed();
    db.insert('quest_template', { ID: '3', LogTitle: 'Three' });
    db.insert('quest_template_addon', { ID: '3', PrevQuestID: '-1' });
    const snap = await loadLinks(db, [1], new Map());
    expect(snap.facts.has(3)).toBe(true);
    expect(snap.result.instances.some((i) => i.to.kind === 'quest' && i.to.questId === 3)).toBe(true);
  });
  it('finds a draft that points at the scope even when the world row does not', async () => {
    const db = seed();
    db.insert('quest_template', { ID: '3', LogTitle: 'Three' });
    const { aggregate } = await importFixture(db, 3);
    const edited: QuestAggregate = { ...aggregate, values: { ...aggregate.values, 'quest_template_addon.PrevQuestID': 2 } };
    const snap = await loadLinks(db, [2], new Map([[3, edited]]));
    expect(snap.result.instances.some((i) => i.component === 'unlock.afterTurnIn' && i.owner === 3)).toBe(true);
  });
  it('counts a quest as touched by a group it belongs to', () => {
    const group = { from: { kind: 'group', group: 5 }, to: { kind: 'group', group: 5 }, params: { members: [3, 4] } } as any;
    expect(touches(group, 4)).toBe(true);
    expect(touches(group, 9)).toBe(false);
  });
});
