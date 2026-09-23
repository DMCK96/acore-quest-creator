import { describe, it, expect } from 'vitest';
import { findQuestChain } from '@core/import/quest-chain';
import { layoutChain } from '@core/canvas/layout';
import { forkDb } from '../helpers/fixtures';
import type { FakeWorldDb } from '../helpers/fake-world-db';

function quest(db: FakeWorldDb, id: number, addon: Record<string, string> = {}, template: Record<string, string> = {}): void {
  db.insert('quest_template', { ID: String(id), LogTitle: `Quest ${id}`, ...template });
  if (Object.keys(addon).length > 0) db.insert('quest_template_addon', { ID: String(id), ...addon });
}

const sorted = (ids: number[]): number[] => ids.slice().sort((a, b) => a - b);

describe('findQuestChain', () => {
  it('walks parents and children through PrevQuestID, from any quest in the middle', async () => {
    const db = forkDb();
    quest(db, 1);
    quest(db, 2, { PrevQuestID: '1' });
    quest(db, 3, { PrevQuestID: '-2' }); // negative: 2 must be active, still the parent
    quest(db, 99); // unrelated
    const chain = await findQuestChain(db, 2);
    expect(sorted(chain.questIds)).toEqual([1, 2, 3]);
    expect(chain.links).toEqual(expect.arrayContaining([{ from: 1, to: 2 }, { from: 2, to: 3 }]));
  });

  it('follows NextQuestID, RewardNextQuest and breadcrumbs both ways', async () => {
    const db = forkDb();
    quest(db, 10, { NextQuestID: '11' });
    quest(db, 11, {}, { RewardNextQuest: '12' });
    quest(db, 12);
    quest(db, 13, { BreadcrumbForQuestId: '10' });
    expect(sorted((await findQuestChain(db, 12)).questIds)).toEqual([10, 11, 12, 13]);
    expect(sorted((await findQuestChain(db, 13)).questIds)).toEqual([10, 11, 12, 13]);
  });

  it('pulls in exclusive-group siblings and their children', async () => {
    const db = forkDb();
    quest(db, 20);
    quest(db, 21, { PrevQuestID: '20', ExclusiveGroup: '21' });
    quest(db, 22, { PrevQuestID: '20', ExclusiveGroup: '21' });
    quest(db, 23, { ExclusiveGroup: '21' });
    quest(db, 24, { PrevQuestID: '23' });
    expect(sorted((await findQuestChain(db, 21)).questIds)).toEqual([20, 21, 22, 23, 24]);
  });

  it('ignores links to quests that do not exist and survives cycles', async () => {
    const db = forkDb();
    quest(db, 30, { PrevQuestID: '31', NextQuestID: '555' });
    quest(db, 31, { PrevQuestID: '30' });
    const chain = await findQuestChain(db, 30);
    expect(sorted(chain.questIds)).toEqual([30, 31]);
    expect(chain.links.every((l) => l.from !== 555 && l.to !== 555)).toBe(true);
  });

  it('returns just the quest when it has no chain', async () => {
    const db = forkDb();
    quest(db, 40);
    expect(await findQuestChain(db, 40)).toEqual({ questIds: [40], links: [], truncated: false });
  });

  it('stops at the size limit and says so', async () => {
    const db = forkDb();
    quest(db, 100);
    for (let i = 101; i < 110; i++) quest(db, i, { PrevQuestID: String(i - 1) });
    const chain = await findQuestChain(db, 100, 4);
    expect(chain.questIds).toHaveLength(4);
    expect(chain.truncated).toBe(true);
  });
});

describe('layoutChain', () => {
  it('puts each quest one column right of its deepest parent, siblings stacked', () => {
    const slots = layoutChain([1, 2, 3, 4], [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 4 },
      { from: 3, to: 4 },
    ]);
    expect(slots.get(1)).toEqual({ column: 0, row: 0 });
    expect(slots.get(2)).toEqual({ column: 1, row: 0 });
    expect(slots.get(3)).toEqual({ column: 1, row: 1 });
    expect(slots.get(4)).toEqual({ column: 2, row: 0 });
  });

  it('terminates on a cycle and still places every quest', () => {
    const slots = layoutChain([1, 2], [
      { from: 1, to: 2 },
      { from: 2, to: 1 },
    ]);
    expect(slots.size).toBe(2);
  });
});
