import { describe, expect, it } from 'vitest';
import { registry } from '../../src/core/registry';
import { checkFieldValue } from '../../src/core/registry/check-value';
import type { FieldDef, ScalarFieldDef } from '../../src/core/registry/types';

const field = (id: string): FieldDef => {
  const f = registry.fields.find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f;
};
const firstScalar = (kind: string): ScalarFieldDef =>
  registry.fields.find((f): f is ScalarFieldDef => f.shape === 'scalar' && f.type.kind === kind)!;
const bounded: ScalarFieldDef = {
  shape: 'scalar', id: 'x.Bounded', table: 'x', column: 'Bounded', label: 'Bounded', help: 'h', group: 'identity',
  type: { kind: 'int', min: 1, max: 255 },
};

describe('checkFieldValue', () => {
  it('accepts a title string and refuses a number for it', () => {
    expect(checkFieldValue(field('quest_template.LogTitle'), 'Kobold Camp Cleanup')).toBeNull();
    expect(checkFieldValue(field('quest_template.LogTitle'), 5)).toMatch(/text/i);
  });

  it('accepts a whole level and refuses text, fractions and NaN', () => {
    const level = field('quest_template.QuestLevel');
    expect(checkFieldValue(level, 10)).toBeNull();
    expect(checkFieldValue(level, '10')).not.toBeNull();
    expect(checkFieldValue(level, 10.5)).not.toBeNull();
    expect(checkFieldValue(level, Number.NaN)).not.toBeNull();
  });

  it('respects an int field\'s min and max', () => {
    expect(checkFieldValue(bounded, 1)).toBeNull();
    expect(checkFieldValue(bounded, 255)).toBeNull();
    expect(checkFieldValue(bounded, 0)).toMatch(/between 1 and 255/);
    expect(checkFieldValue(bounded, 256)).toMatch(/between 1 and 255/);
  });

  it('accepts only the listed values of an enum', () => {
    const e = firstScalar('enum');
    const options = (e.type as any).options as { value: number }[];
    expect(checkFieldValue(e, options[0]!.value)).toBeNull();
    expect(checkFieldValue(e, Math.max(...options.map((o) => o.value)) + 1000)).not.toBeNull();
    expect(checkFieldValue(e, 'first')).not.toBeNull();
  });

  it('takes any non-negative whole number for flags, as the codec does, and refuses negatives', () => {
    const f = firstScalar('flags');
    expect(checkFieldValue(f, 0)).toBeNull();
    expect(checkFieldValue(f, 0x80000000)).toBeNull();
    expect(checkFieldValue(f, -1)).not.toBeNull();
  });

  it('accepts null for an id reference and refuses it for a title', () => {
    expect(checkFieldValue(firstScalar('idRef'), null)).toBeNull();
    expect(checkFieldValue(field('quest_template.LogTitle'), null)).not.toBeNull();
  });

  it('wants a target and a positive id for a creature-or-object value', () => {
    const f: ScalarFieldDef = { ...bounded, id: 'x.Who', label: 'Who', type: { kind: 'creatureOrGo' } };
    expect(checkFieldValue(f, { target: 'creature', id: 1423 })).toBeNull();
    expect(checkFieldValue(f, { target: 'npc', id: 1423 })).not.toBeNull();
    expect(checkFieldValue(f, { target: 'creature', id: 0 })).not.toBeNull();
    expect(checkFieldValue(f, null)).toBeNull();
  });

  it('checks the keys and values of a list field', () => {
    const list = registry.fields.find((f) => f.shape === 'list')!;
    expect(checkFieldValue(list, [])).toBeNull();
    expect(checkFieldValue(list, 'nope')).not.toBeNull();
    expect(checkFieldValue(list, [{ notAMember: 1 }])).toMatch(/notAMember/);
    expect(checkFieldValue(list, Array.from({ length: (list as any).slots + 1 }, () => ({})))).not.toBeNull();
  });

  it('checks the columns of a row-set field', () => {
    const rows = registry.fields.find((f) => f.shape === 'rowset')!;
    expect(checkFieldValue(rows, [])).toBeNull();
    expect(checkFieldValue(rows, [{ notAColumn: 1 }])).toMatch(/notAColumn/);
  });
});
