import { describe, it, expect } from 'vitest';
import { componentAvailability } from '@core/links/availability';
import { CATALOG } from '@core/links/catalog';
import { loadSchema } from '@core/schema/load';
import { registry } from '@core/registry';
import { CONTEXT_TABLES } from '@core/links/context';
import { forkDb } from '../helpers/fixtures';

async function tablesOf(db: ReturnType<typeof forkDb>) {
  const s = await loadSchema(db, [...registry.tables.map((t) => t.table), ...CONTEXT_TABLES]);
  return s.tables;
}

describe('componentAvailability', () => {
  it('makes everything available on a full fork', async () => {
    const a = componentAvailability(await tablesOf(forkDb()));
    expect(a.unavailable).toEqual([]);
    expect(a.available.size).toBe(CATALOG.length);
  });
  it('names the missing table when smart_scripts is absent', async () => {
    const db = forkDb();
    db.dropTable('smart_scripts');
    const a = componentAvailability(await tablesOf(db));
    expect(a.available.has('start.smartai')).toBe(false);
    expect(a.unavailable).toEqual([{ component: 'start.smartai', label: 'Offered by a SmartAI script', reason: 'Needs table smart_scripts, which this database does not have.' }]);
  });
  it('names a missing column', async () => {
    const tables = await tablesOf(forkDb());
    const withoutStartquest = { ...tables, item_template: tables.item_template.filter((c) => c.name !== 'startquest') };
    expect(componentAvailability(withoutStartquest).unavailable).toEqual([
      { component: 'start.item', label: 'Begun by an item', reason: 'Needs item_template.startquest, which this database does not have.' },
    ]);
  });
});
