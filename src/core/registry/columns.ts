import type { FieldDef, ScalarType } from './types';

/** Column name of a list member in a given 1-based slot. */
export function slotColumn(template: string, n: number): string {
  return template.replace('{n}', String(n));
}

/** Every DB column the field owns; lists are expanded over slots. */
export function columnsOfField(def: FieldDef): string[] {
  return Object.keys(columnTypes(def));
}

/** The scalar type of every column the field owns. */
export function columnTypes(def: FieldDef): Record<string, ScalarType> {
  const out: Record<string, ScalarType> = {};
  if (def.shape === 'scalar') {
    out[def.column] = def.type;
  } else if (def.shape === 'list') {
    for (let n = 1; n <= def.slots; n++) {
      for (const m of def.members) out[slotColumn(m.columnTemplate, n)] = m.type;
    }
  } else {
    if (def.questColumn !== undefined) out[def.questColumn] = { kind: 'int' };
    for (const key of Object.keys(def.fixedColumns ?? {})) out[key] = { kind: 'int' };
    for (const c of def.columns) out[c.name] = c.type;
  }
  return out;
}
