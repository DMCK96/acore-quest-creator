import { describe, it, expect } from 'vitest';
import { forkDb } from '../helpers/fixtures';
import { runCorpus } from '@core/roundtrip/corpus';
import { loadSchema } from '@core/schema/load';
import { registry } from '@core/registry';

describe('runCorpus', () => {
  const setup = async () => {
    const db = forkDb();
    for (const id of ['60001', '60002', '60003']) db.insert('quest_template', { ID: id, LogTitle: `Q${id}` });
    const schema = await loadSchema(db, registry.tables.map((t) => t.table));
    return { db, schema };
  };
  it('passes every quest and reports totals', async () => {
    const { db, schema } = await setup();
    const report = await runCorpus({ db, schema, registry, questIds: [60001, 60002, 60003] });
    expect(report).toEqual({ total: 3, passed: 3, failures: [] });
  });
  it('records import failures without aborting the run', async () => {
    const { db, schema } = await setup();
    const report = await runCorpus({ db, schema, registry, questIds: [60001, 999999, 60003] });
    expect(report.passed).toBe(2);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ questId: 999999, stage: 'import' });
  });
  it('records round-trip differences', async () => {
    const { db, schema } = await setup();
    const verify = (a: any) => a.aggregate.questId === 60002
      ? { ok: false as const, differences: [{ table: 'quest_template', key: 'ID=60002', column: 'LogTitle', before: 'a', after: 'b' }] }
      : { ok: true as const };
    const report = await runCorpus({ db, schema, registry, questIds: [60001, 60002], verify });
    expect(report.failures[0]).toMatchObject({ questId: 60002, stage: 'roundtrip' });
    expect(report.failures[0].differences).toHaveLength(1);
  });
  it('reports progress', async () => {
    const { db, schema } = await setup();
    const seen: number[] = [];
    await runCorpus({ db, schema, registry, questIds: [60001, 60002], onProgress: (d) => seen.push(d) });
    expect(seen).toEqual([1, 2]);
  });
});
