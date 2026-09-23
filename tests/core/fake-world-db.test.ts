import { describe, it, expect } from 'vitest';
import { loadFork } from '../helpers/ddl';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { UnknownColumnError, UnknownTableError } from '@core/db/world-db';

describe('parseCreateTable via loadFork', () => {
  const cols = loadFork(['quest_template', 'creature_queststarter'])['quest_template'];
  it('reads every column in order with types, nullability and defaults', () => {
    expect(cols.length).toBe(105);
    expect(cols[0]).toMatchObject({ name: 'ID', ordinal: 1, isKey: true, nullable: false });
    const title = cols.find((c) => c.name === 'LogTitle')!;
    expect(['text', 'varchar']).toContain(title.dataType);
    expect(cols.find((c) => c.name === 'RewardItem1')!.default).toBe('0');
  });
  it('marks composite keys', () => {
    const s = loadFork(['creature_queststarter'])['creature_queststarter'];
    expect(s.filter((c) => c.isKey).map((c) => c.name)).toEqual(['id', 'quest']);
  });
});

describe('FakeWorldDb', () => {
  const make = () => FakeWorldDb.fromFork(['quest_template', 'creature_queststarter', 'item_template', 'creature_template']);
  it('fills defaults on insert and returns text values', async () => {
    const db = make();
    db.insert('quest_template', { ID: '60001', LogTitle: 'Test' });
    const [row] = await db.selectRows('quest_template', { ID: '60001' });
    expect(row.LogTitle).toBe('Test');
    expect(row.RewardItem1).toBe('0');
    expect(Object.keys(row).length).toBe(105);
  });
  it('supports IN filters, empty IN, and numeric key ordering', async () => {
    const db = make();
    for (const id of ['9', '10', '100']) db.insert('quest_template', { ID: id });
    expect((await db.selectRows('quest_template', { ID: ['9', '100'] })).map((r) => r.ID)).toEqual(['9', '100']);
    expect(await db.selectRows('quest_template', { ID: [] })).toEqual([]);
    expect((await db.selectRows('quest_template', {})).map((r) => r.ID)).toEqual(['9', '10', '100']);
  });
  it('rejects unknown tables and columns', async () => {
    const db = make();
    await expect(db.selectRows('nope', {})).rejects.toBeInstanceOf(UnknownTableError);
    await expect(db.selectRows('quest_template', { Nope: '1' })).rejects.toBeInstanceOf(UnknownColumnError);
    expect(await db.columns('nope')).toEqual([]);
  });
  it('searches quests by title substring or exact id', async () => {
    const db = make();
    db.insert('quest_template', { ID: '5', LogTitle: 'Wolves of Elwynn', QuestLevel: '3' });
    db.insert('quest_template', { ID: '6', LogTitle: 'Other' });
    expect((await db.searchQuests('wolves', 10))[0]).toEqual({ id: 5, title: 'Wolves of Elwynn', level: 3 });
    expect((await db.searchQuests('6', 10)).map((q) => q.id)).toEqual([6]);
  });
  it('searches entities by id or name, exact then prefix then id order', async () => {
    const db = make();
    db.insert('creature_template', { entry: '300', name: 'Young Wolf', minlevel: '1', maxlevel: '2' });
    db.insert('creature_template', { entry: '299', name: 'Diseased Young Wolf', minlevel: '1', maxlevel: '2' });
    db.insert('creature_template', { entry: '301', name: 'Wolf', minlevel: '5', maxlevel: '5' });
    expect((await db.searchEntities('creature', 'wolf', 25)).map((h) => h.id)).toEqual([301, 299, 300]);
    expect((await db.searchEntities('creature', 'young', 25)).map((h) => h.id)).toEqual([300, 299]);
    expect(await db.searchEntities('creature', '301', 25)).toEqual([{ id: 301, name: 'Wolf', detail: 'Level 5' }]);
    expect((await db.searchEntities('creature', 'wolf', 1)).map((h) => h.id)).toEqual([301]);
    expect((await db.searchEntities('creature', 'Young Wolf', 25))[0].detail).toBe('Level 1–2');
  });
  it('names item quality and treats quotes and percent signs as plain text', async () => {
    const db = make();
    db.insert('item_template', { entry: '750', name: "Thrall's Pelt", Quality: '2' });
    db.insert('item_template', { entry: '751', name: 'Other', Quality: '0' });
    expect(await db.searchEntities('item', "thrall's", 25)).toEqual([{ id: 750, name: "Thrall's Pelt", detail: 'Uncommon' }]);
    expect(await db.searchEntities('item', '%', 25)).toEqual([]);
    expect(await db.searchEntities('item', '   ', 25)).toEqual([]);
  });
  it('searches quests by title', async () => {
    const db = make();
    db.insert('quest_template', { ID: '5', LogTitle: 'Wolves of Elwynn', QuestLevel: '3' });
    expect(await db.searchEntities('quest', 'wolves', 25)).toEqual([{ id: 5, name: 'Wolves of Elwynn', detail: 'Level 3' }]);
  });
  it('resolves names only for lookup kinds and treats other kinds as existing', async () => {
    const db = make();
    db.insert('item_template', { entry: '25', name: 'Worn Shortsword' });
    expect((await db.lookupNames('item', [25, 26])).get(25)).toBe('Worn Shortsword');
    expect((await db.lookupNames('spell', [1])).size).toBe(0);
    expect([...(await db.existingIds('item', [25, 26]))]).toEqual([25]);
    expect([...(await db.existingIds('spell', [7, 8]))].sort()).toEqual([7, 8]);
  });
  it('lists quest ids in a range', async () => {
    const db = make();
    for (const id of ['59999', '60000', '60005']) db.insert('quest_template', { ID: id });
    expect(await db.questIdsInRange(60000, 69999)).toEqual([60000, 60005]);
  });
  it('lets tests simulate fork drift', async () => {
    const db = make();
    db.insert('quest_template', { ID: '1' });
    db.addColumn('quest_template', { name: 'FutureCol', dataType: 'int', columnType: 'int', nullable: false, default: '5', ordinal: 106, isKey: false });
    expect((await db.selectRows('quest_template', { ID: '1' }))[0].FutureCol).toBe('5');
    db.dropTable('creature_queststarter');
    expect(await db.columns('creature_queststarter')).toEqual([]);
  });
});
