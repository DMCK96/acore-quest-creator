import { describe, it, expect, vi } from 'vitest';
import { findQuestChain } from '@core/import/quest-chain';
import { loadLinks } from '@core/links/service';
import { readItemStarters } from '@core/links/context';
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

  it('follows a quest offered by a script when another quest is turned in', async () => {
    const db = forkDb();
    quest(db, 50);
    quest(db, 51);
    db.insert('smart_scripts', { entryorguid: '100', source_type: '0', id: '0', link: '0', event_type: '20', event_param1: '50', action_type: '7', action_param1: '51', comment: '' });
    const fromFirst = await findQuestChain(db, 50);
    expect(fromFirst.questIds.slice().sort((a, b) => a - b)).toEqual([50, 51]);
    expect(fromFirst.links).toContainEqual({ from: 50, to: 51 });
    expect((await findQuestChain(db, 51)).questIds.slice().sort((a, b) => a - b)).toEqual([50, 51]);
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

  it('stacks each column in the order of its parents, so branches do not cross', () => {
    // The Aldor/Scryers split: 10551 leads to 10554 and 10552 to 10553, so ID order would cross them.
    const slots = layoutChain([10210, 10211, 10551, 10552, 10553, 10554], [
      { from: 10210, to: 10211 },
      { from: 10211, to: 10551 },
      { from: 10211, to: 10552 },
      { from: 10551, to: 10554 },
      { from: 10552, to: 10553 },
    ]);
    expect(slots.get(10551)).toEqual({ column: 2, row: 0 });
    expect(slots.get(10552)).toEqual({ column: 2, row: 1 });
    expect(slots.get(10554)).toEqual({ column: 3, row: 0 });
    expect(slots.get(10553)).toEqual({ column: 3, row: 1 });
  });

  it('terminates on a cycle and still places every quest', () => {
    const slots = layoutChain([1, 2], [
      { from: 1, to: 2 },
      { from: 2, to: 1 },
    ]);
    expect(slots.size).toBe(2);
  });

  it('reads item_template once up front, never per chain step or per link read', async () => {
    const db = forkDb();
    for (let id = 1; id <= 6; id++) quest(db, id, id > 1 ? { PrevQuestID: String(id - 1) } : {});
    db.insert('item_template', { entry: '25', name: 'Letter', startquest: '1' });
    const spy = vi.spyOn(db, 'selectRows');
    const itemSelects = (): number => spy.mock.calls.filter(([table]) => table === 'item_template').length;

    const starters = await readItemStarters(db);
    const afterRead = itemSelects();
    const chain = await findQuestChain(db, 3, undefined, undefined, starters);
    const snapshot = await loadLinks(db, chain.questIds, new Map(), undefined, starters);

    expect(sorted(chain.questIds)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snapshot.result.instances.some((i) => i.component === 'start.item')).toBe(true);
    expect(afterRead).toBeLessThanOrEqual(1);
    expect(itemSelects()).toBe(afterRead);
  });
});
