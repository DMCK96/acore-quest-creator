import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { importQuest, QuestNotFoundError, InvalidQuestIdError } from '@core/import/importer';
import { listUnmodelled } from '@core/import/unmodelled';
import { loadSchema } from '@core/schema/load';
import { registry } from '@core/registry';

const tables = registry.tables.map((t) => t.table);

describe('importQuest', () => {
  it('decodes scalars, lists and creature/object targets', async () => {
    const db = forkDb();
    db.insert('quest_template', {
      ID: '60001', LogTitle: 'Test', RewardItem1: '25', RewardAmount1: '1',
      RequiredNpcOrGo1: '-77', RequiredNpcOrGoCount1: '2', RewardChoiceItemID2: '30', RewardChoiceItemQuantity2: '1',
    });
    const { aggregate } = await importFixture(db, 60001);
    expect(aggregate.isNew).toBe(false);
    expect(aggregate.values['quest_template.LogTitle']).toBe('Test');
    expect(aggregate.values['quest_template.RewardItems']).toEqual([{ item: 25, amount: 1 }]);
    expect(aggregate.values['quest_template.RequiredNpcOrGo']).toEqual([{ target: { target: 'gameobject', id: 77 }, count: 2 }]);
    expect(aggregate.values['quest_template.RewardChoiceItems']).toEqual([{ item: 30, quantity: 1 }]);
  });

  it('stores the raw rows and columns read in the snapshot', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001', LogTitle: "O'Neil\r\n" });
    const { snapshot, schema } = await importFixture(db, 60001);
    expect(snapshot.tables['quest_template'][0].LogTitle).toBe("O'Neil\r\n");
    expect(snapshot.columnsRead['quest_template']).toEqual(schema.tables['quest_template'].map((c) => c.name));
    expect(snapshot.tables['quest_template_addon']).toEqual([]);
    expect(snapshot.schemaHash).toBe(schema.hash);
  });

  it('decodes a missing one-to-one row from column defaults', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001' });
    const { aggregate } = await importFixture(db, 60001);
    expect(aggregate.values['quest_template_addon.PrevQuestID']).toBe(0);
  });

  it('marks a field read-only when its text cannot be represented, and still imports', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001', RewardMoney: 'garbage' });
    const { aggregate } = await importFixture(db, 60001);
    expect(aggregate.readOnly.map((r) => r.fieldId)).toContain('quest_template.RewardMoney');
    expect(aggregate.values['quest_template.RewardMoney']).toBeUndefined();
  });

  it('preserves unknown columns in the snapshot and lists them as unmodelled', async () => {
    const db = forkDb();
    db.addColumn('quest_template', { name: 'FutureCol', dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 106, isKey: false });
    db.insert('quest_template', { ID: '60001', FutureCol: '9' });
    const { snapshot, schema } = await importFixture(db, 60001);
    expect(snapshot.tables['quest_template'][0].FutureCol).toBe('9');
    const un = listUnmodelled(schema, registry, snapshot);
    expect(un).toContainEqual({ table: 'quest_template', column: 'FutureCol', values: [{ key: 'ID=60001', value: '9' }] });
  });

  it('skips tables absent from the DB', async () => {
    const db = forkDb();
    db.dropTable('quest_template_addon');
    db.insert('quest_template', { ID: '60001' });
    const { aggregate, snapshot } = await importFixture(db, 60001);
    expect(snapshot.tables['quest_template_addon']).toEqual([]);
    expect(Object.keys(aggregate.values).some((k) => k.startsWith('quest_template_addon.'))).toBe(false);
  });

  it('rejects bad ids and unknown quests with named errors', async () => {
    const db = forkDb();
    const schema = await loadSchema(db, tables);
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      await expect(importQuest(db, schema, registry, bad)).rejects.toBeInstanceOf(InvalidQuestIdError);
    }
    await expect(importQuest(db, schema, registry, 424242)).rejects.toBeInstanceOf(QuestNotFoundError);
  });
});
