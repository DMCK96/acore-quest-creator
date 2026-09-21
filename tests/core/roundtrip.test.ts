import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { applyPatchInMemory, keyColumnsByTable } from '@core/roundtrip/apply';
import { compareTables } from '@core/roundtrip/compare';
import { verifyRoundTrip, FidelityError } from '@core/roundtrip/verify';
import { registry } from '@core/registry';

const keys = keyColumnsByTable(registry);
const row = (o: Record<string, string | null>) => o;

describe('applyPatchInMemory', () => {
  it('deletes by key then inserts, without mutating its input', () => {
    const before = { t: [row({ ID: '1', v: 'a' })] };
    const after = applyPatchInMemory(before, [
      { kind: 'delete', table: 't', key: { ID: '1' } },
      { kind: 'insert', table: 't', row: row({ ID: '1', v: 'b' }) },
    ], { t: ['ID'] });
    expect(after.t).toEqual([{ ID: '1', v: 'b' }]);
    expect(before.t[0].v).toBe('a');
  });
  it('applies set-flag by OR-ing the bit, is idempotent, and ignores tables it does not hold', () => {
    const before = { creature_template: [row({ entry: '1', npcflag: '1' }), row({ entry: '2', npcflag: '2' })] };
    const flag = (table: string, key: Record<string, string>) => ({ kind: 'set-flag' as const, table, column: table === 'creature_template' ? 'npcflag' : 'x', bit: 2, key });
    const st = [flag('creature_template', { entry: '1' }), flag('creature_template', { entry: '2' }), flag('other', { id: '9' })];
    const after = applyPatchInMemory(before, st, { creature_template: ['entry'] });
    expect(after.creature_template.map((r) => r.npcflag)).toEqual(['3', '2']);
    expect(Object.keys(after)).toEqual(['creature_template']);
    expect(applyPatchInMemory(after, st, { creature_template: ['entry'] }).creature_template.map((r) => r.npcflag)).toEqual(['3', '2']);
  });
  it('rejects a duplicate key insert', () => {
    expect(() => applyPatchInMemory({ t: [row({ ID: '1' })] }, [{ kind: 'insert', table: 't', row: row({ ID: '1' }) }], { t: ['ID'] })).toThrow(/duplicate/i);
  });
});

describe('compareTables', () => {
  const k = { t: ['ID'] };
  it('is empty for identical tables regardless of row order', () => {
    expect(compareTables({ t: [row({ ID: '1' }), row({ ID: '2' })] }, { t: [row({ ID: '2' }), row({ ID: '1' })] }, k)).toEqual([]);
  });
  it('is strict about text: 1.0 vs 1, NULL vs empty, whitespace', () => {
    for (const [a, b] of [['1', '1.0'], [null, ''], ['x', 'x ']] as const) {
      const d = compareTables({ t: [row({ ID: '1', v: a })] }, { t: [row({ ID: '1', v: b })] }, k);
      expect(d).toEqual([{ table: 't', key: 'ID=1', column: 'v', before: a, after: b }]);
    }
  });
  it('reports added and removed rows', () => {
    const added = compareTables({ t: [] }, { t: [row({ ID: '3' })] }, k);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ table: 't', key: 'ID=3', column: null });
    expect(added[0].before).toBeUndefined();
    const removed = compareTables({ t: [row({ ID: '3' })] }, { t: [] }, k);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ table: 't', key: 'ID=3', column: null });
    expect(removed[0].after).toBeUndefined();
  });
});

describe('verifyRoundTrip', () => {
  it('passes for an untouched quest, including hostile text and awkward numerics', async () => {
    const db = forkDb();
    db.insert('quest_template', {
      ID: '60001', LogTitle: "It's \ \"quoted\" 🙂", QuestDescription: 'line1\r\nline2\t$B$N  ',
      LogDescription: '', AreaDescription: null, POIx: '1.50', POIy: '-0', RewardMoney: '4294967295',
    });
    db.insert('quest_template_addon', { ID: '60001', PrevQuestID: '-55' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
  });
  it('passes when a table row is absent and when unknown columns exist', async () => {
    const db = forkDb();
    db.addColumn('quest_template', { name: 'FutureCol', dataType: 'int', columnType: 'int', nullable: false, default: '0', ordinal: 106, isKey: false });
    db.insert('quest_template', { ID: '60001', FutureCol: '9' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry }).ok).toBe(true);
  });
  it('reports a difference when the snapshot is inconsistent with what export would write', async () => {
    const db = forkDb();
    db.insert('quest_template', { ID: '60001', LogTitle: 'A' });
    const { aggregate, snapshot, schema } = await importFixture(db, 60001);
    const tampered = { ...snapshot, tables: { ...snapshot.tables, quest_template: [{ ...snapshot.tables['quest_template'][0], LogTitle: null }] } };
    const report = verifyRoundTrip({ aggregate, snapshot: tampered, schema, registry });
    expect(report.ok).toBe(false);
  });
  it('FidelityError carries the differences', () => {
    const e = new FidelityError([{ table: 't', key: 'ID=1', column: 'v', before: 'a', after: 'b' }]);
    expect(e.differences).toHaveLength(1);
    expect(e.message).toContain('t');
    expect(keys.quest_template).toEqual(['ID']);
  });
});
