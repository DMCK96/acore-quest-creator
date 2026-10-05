import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT, ENTITY_KEYS, ENTITY_TABLES } from '../../src/core/entities/context';
import { newItem } from '../../src/core/entities/model';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { forkDb } from '../helpers/fixtures';

const pearl = { ...newItem(990020), name: 'Golden Pearl', displayId: 7040, pages: [{ id: 3800, text: 'It glitters.' }], advanced: { holy_res: '3', not_a_column: '1' } };
const compile = (itemColumns?: ReadonlySet<string> | null) =>
  compileEntities({ entities: { npcs: [], objects: [], items: [pearl] }, givers: [], context: EMPTY_ENTITY_CONTEXT, itemColumns });

describe('compileEntities with items', () => {
  it('writes the item row and its pages, and deletes by entry', () => {
    const out = compile();
    expect(out.inserts.item_template).toEqual([expect.objectContaining({ entry: '990020', name: 'Golden Pearl', displayid: '7040', PageText: '3800', holy_res: '3' })]);
    expect(out.inserts.page_text).toEqual([{ ID: '3800', Text: 'It glitters.', NextPageID: '0' }]);
    expect(out.deletes.item_template).toEqual([{ entry: '990020' }]);
    expect(out.deletes.page_text).toEqual([{ ID: '3800' }]);
    expect(ENTITY_TABLES).toContain('item_template');
    expect(ENTITY_KEYS.item_template).toEqual(['entry']);
  });
  it('warns about advanced columns the database does not have', () => {
    expect(compile(new Set(['entry', 'name', 'holy_res'])).warnings).toEqual([
      'Item "Golden Pearl": the database has no item_template column not_a_column, so its value is not written.',
    ]);
    expect(compile(null).warnings).toEqual([]);
  });
  it('turns into an insert the fork schema accepts, before loot rows', async () => {
    const schema = await loadSchema(forkDb(), ['item_template', 'page_text', 'creature_loot_template']);
    const { statements, missingTables } = scriptStatements(compile(), schema);
    expect(missingTables).toEqual([]);
    const insert = statements.find((s) => s.kind === 'insert' && s.table === 'item_template');
    expect(insert && insert.kind === 'insert' ? insert.row.not_a_column : 'absent').toBeUndefined();
    expect(insert && insert.kind === 'insert' ? insert.row.Quality : null).toBe('1');
  });
});
