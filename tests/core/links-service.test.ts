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
  it('loads every member of an exclusive group even when only one member is in scope', async () => {
    const db = forkDb();
    for (const id of [21, 22, 23, 30]) db.insert('quest_template', { ID: String(id), LogTitle: `Q${id}` });
    for (const id of [21, 22, 23]) db.insert('quest_template_addon', { ID: String(id), ExclusiveGroup: '-21', NextQuestID: '30' });
    const snap = await loadLinks(db, [21], new Map());
    const group = snap.result.instances.find((i) => i.component === 'group.finishAll');
    expect(group?.params.members).toEqual([21, 22, 23]);
  });
  it('does not say a finish-all group unlocks a quest when an out-of-scope member points elsewhere', async () => {
    const db = forkDb();
    for (const id of [21, 22, 23, 30, 31]) db.insert('quest_template', { ID: String(id), LogTitle: `Q${id}` });
    db.insert('quest_template_addon', { ID: '21', ExclusiveGroup: '-21', NextQuestID: '30' });
    db.insert('quest_template_addon', { ID: '22', ExclusiveGroup: '-21', NextQuestID: '30' });
    db.insert('quest_template_addon', { ID: '23', ExclusiveGroup: '-21', NextQuestID: '31' });
    const snap = await loadLinks(db, [21], new Map());
    const group = snap.result.instances.find((i) => i.component === 'group.finishAll');
    expect(group?.params).toMatchObject({ members: [21, 22, 23], then: 0 });
  });
  it('finds a draft that joins the group of a quest in scope', async () => {
    const db = forkDb();
    for (const id of [21, 22]) db.insert('quest_template', { ID: String(id), LogTitle: `Q${id}` });
    db.insert('quest_template_addon', { ID: '21', ExclusiveGroup: '21' });
    const { aggregate } = await importFixture(db, 22);
    const edited: QuestAggregate = { ...aggregate, values: { ...aggregate.values, 'quest_template_addon.ExclusiveGroup': 21 } };
    const snap = await loadLinks(db, [21], new Map([[22, edited]]));
    expect(snap.result.instances.find((i) => i.component === 'group.pickOne')?.params.members).toEqual([21, 22]);
  });
  it('counts a quest as touched by a group it belongs to', () => {
    const group = { from: { kind: 'group', group: 5 }, to: { kind: 'group', group: 5 }, params: { members: [3, 4] } } as any;
    expect(touches(group, 4)).toBe(true);
    expect(touches(group, 9)).toBe(false);
  });
});
