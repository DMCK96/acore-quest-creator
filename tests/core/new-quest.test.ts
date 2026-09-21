import { describe, it, expect } from 'vitest';
import { forkDb } from '../helpers/fixtures';
import { loadSchema } from '@core/schema/load';
import { createNewAggregate } from '@core/import/new-quest';
import { registry } from '@core/registry';

describe('createNewAggregate', () => {
  it('builds defaults for every field and sets the id', async () => {
    const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
    const a = createNewAggregate(schema, registry, 60123);
    expect(a).toMatchObject({ questId: 60123, isNew: true, readOnly: [], sharedItems: {} });
    expect(a.values['quest_template.ID']).toBe(60123);
    expect(a.values['quest_template.RewardItems']).toEqual([]);
    expect(a.values['creature_queststarter']).toEqual([]);
    expect(a.values['quest_template_addon.PrevQuestID']).toBe(0);
    expect(a.values['quest_template.LogTitle']).toBe('');
  });
});
