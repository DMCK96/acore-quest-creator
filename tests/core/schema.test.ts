// tests/core/schema.test.ts
import { describe, it, expect } from 'vitest';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { loadSchema } from '@core/schema/load';
import { diffSchema, hasBlockingDrift } from '@core/schema/diff';
import type { Registry } from '@core/registry/types';

const tiny: Registry = {
  tables: [
    { table: 'quest_template', role: 'owned', cardinality: 'one', keyColumns: ['ID'], alwaysEmit: true, where: (q) => ({ ID: String(q) }) },
    { table: 'creature_queststarter', role: 'owned', cardinality: 'many', keyColumns: ['id', 'quest'], where: (q) => ({ quest: String(q) }) },
  ],
  fields: [
    { shape: 'scalar', id: 'quest_template.ID', table: 'quest_template', column: 'ID', type: { kind: 'int' }, label: 'ID', help: '', group: 'identity' },
    { shape: 'scalar', id: 'quest_template.LogTitle', table: 'quest_template', column: 'LogTitle', type: { kind: 'string' }, label: 'Title', help: '', group: 'identity' },
    { shape: 'scalar', id: 'quest_template.GhostCol', table: 'quest_template', column: 'GhostCol', type: { kind: 'int' }, label: 'Ghost', help: '', group: 'identity' },
    { shape: 'rowset', id: 'creature_queststarter', table: 'creature_queststarter', questColumn: 'quest', label: 'S', help: '', group: 'availability',
      columns: [{ name: 'id', type: { kind: 'idRef', target: 'creature' }, label: 'NPC' }] },
  ],
};
const dbWith = (tables: string[]) => FakeWorldDb.fromFork(tables);

describe('loadSchema', () => {
  it('includes only existing tables and hashes deterministically', async () => {
    const a = await loadSchema(dbWith(['quest_template']), ['quest_template', 'nope']);
    expect(Object.keys(a.tables)).toEqual(['quest_template']);
    const b = await loadSchema(dbWith(['quest_template']), ['quest_template']);
    expect(a.hash).toBe(b.hash);
    const drifted = dbWith(['quest_template']);
    drifted.addColumn('quest_template', { name: 'X', dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 106, isKey: false });
    expect((await loadSchema(drifted, ['quest_template'])).hash).not.toBe(a.hash);
  });
});

describe('diffSchema', () => {
  it('reports unregistered columns, missing columns and missing tables', async () => {
    const db = dbWith(['quest_template']);
    const diff = diffSchema(await loadSchema(db, ['quest_template', 'creature_queststarter']), tiny);
    expect(diff.missingTables).toEqual(['creature_queststarter']);
    expect(diff.missingColumns).toEqual([{ table: 'quest_template', column: 'GhostCol', fieldId: 'quest_template.GhostCol' }]);
    expect(diff.unregistered.some((u) => u.table === 'quest_template' && u.column === 'RewardMoney')).toBe(true);
    expect(diff.unregistered.some((u) => u.column === 'ID')).toBe(false);
    expect(hasBlockingDrift(diff)).toBe(false);
  });
  it('flags type mismatches (string field on a numeric column)', async () => {
    const db = dbWith(['quest_template']);
    const diff = diffSchema(await loadSchema(db, ['quest_template']), tiny);
    expect(diff.typeMismatches).toEqual([]);
    const bad: Registry = { ...tiny, fields: [{ shape: 'scalar', id: 'q.T', table: 'quest_template', column: 'QuestLevel', type: { kind: 'string' }, label: '', help: '', group: 'identity' }] };
    const d2 = diffSchema(await loadSchema(db, ['quest_template']), bad);
    expect(d2.typeMismatches[0]).toMatchObject({ table: 'quest_template', column: 'QuestLevel', fieldId: 'q.T' });
  });
  it('blocks when an always-emitted table is missing', async () => {
    const diff = diffSchema(await loadSchema(dbWith([]), ['quest_template']), tiny);
    expect(diff.missingTables).toContain('quest_template');
    expect(hasBlockingDrift(diff)).toBe(true);
  });
});
