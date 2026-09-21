import { describe, it, expect } from 'vitest';
import { columnsOfField, columnTypes } from '@core/registry/columns';
import type { FieldDef } from '@core/registry/types';

const list: FieldDef = {
  shape: 'list', id: 'x.L', table: 'x', slots: 2, label: '', help: '', group: 'rewards',
  members: [
    { name: 'a', columnTemplate: 'A{n}', type: { kind: 'int' }, label: '' },
    { name: 'b', columnTemplate: 'B{n}', type: { kind: 'string' }, label: '' },
  ],
};
const rowset: FieldDef = {
  shape: 'rowset', id: 'y', table: 'y', label: '', help: '', group: 'availability',
  questColumn: 'quest', fixedColumns: { Kind: '19' },
  columns: [{ name: 'id', type: { kind: 'int' }, label: '' }],
};

describe('columnsOfField', () => {
  it('expands list slots', () => expect(columnsOfField(list)).toEqual(['A1', 'B1', 'A2', 'B2']));
  it('includes quest and fixed columns for rowsets', () =>
    expect(columnsOfField(rowset).sort()).toEqual(['Kind', 'id', 'quest']));
  it('returns the type per column', () => expect(columnTypes(list).B2).toEqual({ kind: 'string' }));
});
