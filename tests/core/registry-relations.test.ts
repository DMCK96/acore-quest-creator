import { describe, it, expect } from 'vitest';
import { importFixture, forkDb } from '../helpers/fixtures';
import { buildPatch, DuplicateRowError } from '@core/export/build-patch';
import { verifyRoundTrip } from '@core/roundtrip/verify';
import { registry, fieldById, TABLE_ORDER } from '@core/registry';

const seed = () => {
  const db = forkDb();
  db.insert('quest_template', { ID: '60001', LogTitle: 'T' });
  db.insert('creature_queststarter', { id: '100', quest: '60001' });
  db.insert('creature_queststarter', { id: '200', quest: '60001' });
  db.insert('creature_queststarter', { id: '100', quest: '55555' });
  db.insert('creature_questender', { id: '300', quest: '60001' });
  db.insert('areatrigger_involvedrelation', { id: '77', quest: '60001' });
  db.insert('pool_quest', { entry: '60001', pool_entry: '9', description: 'daily pool' });
  return db;
};
const inserts = (p: any, table: string) => p.statements.filter((s: any) => s.kind === 'insert' && s.table === table).map((s: any) => s.row);
const deletes = (p: any, table: string) => p.statements.filter((s: any) => s.kind === 'delete' && s.table === table).map((s: any) => s.key);

describe('relation tables', () => {
  it('only imports rows for this quest', async () => {
    const { aggregate } = await importFixture(seed(), 60001);
    expect(aggregate.values['creature_queststarter']).toEqual([{ id: 100 }, { id: 200 }]);
    expect(aggregate.values['creature_questender']).toEqual([{ id: 300 }]);
    expect(aggregate.values['areatrigger_involvedrelation']).toEqual([{ id: 77 }]);
    expect(aggregate.values['pool_quest']).toEqual([{ pool_entry: 9, description: 'daily pool' }]);
  });

  it('round-trips untouched', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    expect(verifyRoundTrip({ aggregate, snapshot, schema, registry })).toEqual({ ok: true });
  });

  it('adds and removes rows with exact-key deletes', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const edited = { ...aggregate, values: { ...aggregate.values, creature_queststarter: [{ id: 200 }, { id: 999 }] } };
    const p = buildPatch({ aggregate: edited, snapshot, schema, registry });
    expect(deletes(p, 'creature_queststarter')).toEqual(expect.arrayContaining([{ id: '100', quest: '60001' }, { id: '200', quest: '60001' }, { id: '999', quest: '60001' }]));
    expect(inserts(p, 'creature_queststarter').map((r: any) => r.id).sort()).toEqual(['200', '999']);
    expect(deletes(p, 'creature_queststarter').some((k: any) => k.quest === '55555')).toBe(false);
  });

  it('writes starters after enders and triggers', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const order = buildPatch({ aggregate, snapshot, schema, registry }).statements
      .filter((s) => s.kind === 'insert').map((s) => s.table);
    expect(order.indexOf('creature_queststarter')).toBeGreaterThan(order.indexOf('creature_questender'));
    expect(order.indexOf('creature_queststarter')).toBeGreaterThan(order.indexOf('areatrigger_involvedrelation'));
    expect(order.indexOf('creature_queststarter')).toBeGreaterThan(order.indexOf('quest_template'));
    const tables = registry.tables.map((t) => t.table).filter((t) => !t.endsWith('_locale'));
    expect(tables.slice(-2)).toEqual(['creature_queststarter', 'gameobject_queststarter']);
  });

  it('a new quest with a starter and an ender is fully specified', async () => {
    const { aggregate, schema } = await importFixture(seed(), 60001);
    const fresh = { ...aggregate, isNew: true, questId: 60020, values: { ...aggregate.values, creature_queststarter: [{ id: 5 }], creature_questender: [{ id: 6 }] } };
    const p = buildPatch({ aggregate: fresh, snapshot: null, schema, registry });
    expect(inserts(p, 'creature_queststarter')).toEqual([{ id: '5', quest: '60020' }]);
    expect(inserts(p, 'creature_questender')).toEqual([{ id: '6', quest: '60020' }]);
    expect(deletes(p, 'creature_queststarter')).toEqual([{ id: '5', quest: '60020' }]);
  });

  it('labels the starter and ender controls', () => {
    expect((fieldById('creature_queststarter') as any).control).toBe('starters');
    expect((fieldById('gameobject_questender') as any).control).toBe('enders');
  });
});

describe('many-row tables in the patch builder', () => {
  it('refuses two rows with the same primary key instead of emitting two INSERTs for one DELETE', async () => {
    const { aggregate, snapshot, schema } = await importFixture(seed(), 60001);
    const edited = { ...aggregate, values: { ...aggregate.values, creature_queststarter: [{ id: 200 }, { id: 200 }] } };
    expect(() => buildPatch({ aggregate: edited, snapshot, schema, registry })).toThrow(DuplicateRowError);
    expect(() => buildPatch({ aggregate: edited, snapshot, schema, registry })).toThrow(
      /creature_queststarter.*"id":"200".*"quest":"60001"/,
    );
  });

  it('fills unmodelled columns of a new many-row entry from their defaults, not from the quest ID', async () => {
    const { aggregate, schema } = await importFixture(seed(), 60001);
    const fresh = { ...aggregate, isNew: true, questId: 60020, values: { ...aggregate.values, pool_quest: [{ pool_entry: 9, description: null }] } };
    const p = buildPatch({ aggregate: fresh, snapshot: null, schema, registry });
    expect(inserts(p, 'pool_quest')).toEqual([{ entry: '60020', pool_entry: '9', description: null }]);
  });

  it('keeps every registered table in TABLE_ORDER', () => {
    const missing = registry.tables.map((t) => t.table).filter((t) => !TABLE_ORDER.includes(t));
    expect(missing).toEqual([]);
  });
});
