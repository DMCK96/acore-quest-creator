import { describe, it, expect } from 'vitest';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { findQuestGiverFixes } from '@core/export/quest-giver';

const db = () => {
  const d = FakeWorldDb.fromFork(['creature_template']);
  d.insert('creature_template', { entry: '1', npcflag: '3' });
  d.insert('creature_template', { entry: '2', npcflag: '0' });
  d.insert('creature_template', { entry: '3', npcflag: '1' });
  return d;
};

describe('findQuestGiverFixes', () => {
  it('returns creatures lacking bit 2, ascending, with their current flags', async () => {
    const values = { creature_queststarter: [{ id: 2 }, { id: 1 }], creature_questender: [{ id: 3 }, { id: 4 }, { id: 2 }, { id: 0 }] };
    expect(await findQuestGiverFixes(db(), values)).toEqual([{ entry: 2, npcflag: 0 }, { entry: 3, npcflag: 1 }]);
  });
  it('ignores objects and returns nothing when the table is absent', async () => {
    expect(await findQuestGiverFixes(db(), { gameobject_queststarter: [{ id: 2 }] })).toEqual([]);
    const none = FakeWorldDb.fromFork(['quest_template']);
    expect(await findQuestGiverFixes(none, { creature_queststarter: [{ id: 2 }] })).toEqual([]);
  });
  it('skips a creature whose npcflag text is not a number', async () => {
    const d = db();
    d.update('creature_template', { entry: '2' }, { npcflag: 'garbage' });
    expect(await findQuestGiverFixes(d, { creature_queststarter: [{ id: 2 }] })).toEqual([]);
  });
});
