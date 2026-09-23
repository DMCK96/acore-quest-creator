import { describe, it, expect } from 'vitest';
import { registry, fieldById, fieldsOfGroup, tableDef } from '@core/registry';
import { columnsOfField } from '@core/registry/columns';
import { loadFork } from '../helpers/ddl';

describe('registry coverage', () => {
  const tables = registry.tables.filter((t) => t.role !== 'verbatim').map((t) => t.table);
  const fork = loadFork(tables);
  for (const table of tables) {
    it(`${table}: every DB column is registered exactly once and nothing extra`, () => {
      const registered = registry.fields.filter((f) => f.table === table).flatMap(columnsOfField);
      const dupes = registered.filter((c, i) => registered.indexOf(c) !== i);
      expect(dupes).toEqual([]);
      expect([...registered].sort()).toEqual(fork[table].map((c) => c.name).sort());
    });
  }
  it('has unique field ids', () => {
    const ids = registry.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('gives every field a label and a group', () => {
    for (const f of registry.fields) {
      expect(f.label.trim(), f.id).not.toBe('');
      expect(f.group, f.id).toBeTruthy();
    }
  });
  it('pins the numbered families as lists with the agreed members', () => {
    const list = (id: string) => fieldById(id) as any;
    expect(list('quest_template.RewardItems').slots).toBe(4);
    expect(list('quest_template.RewardChoiceItems').slots).toBe(6);
    expect(list('quest_template.RequiredNpcOrGo').members.map((m: any) => m.name)).toEqual(['target', 'count']);
    expect(list('quest_template.RequiredItems').members.map((m: any) => m.name)).toEqual(['item', 'count']);
    expect(list('quest_template.ItemDrops').members.map((m: any) => m.name)).toEqual(['item', 'quantity']);
    expect(list('quest_template.RewardFactions').members.map((m: any) => m.name)).toEqual(['faction', 'value', 'override']);
    expect(list('quest_template.RequiredFactions').slots).toBe(2);
    expect(list('quest_template.ObjectiveText').members[0].type.kind).toBe('string');
    expect(list('quest_template.RequiredItems').linksItems).toEqual(['item']);
  });
  it('labels the writing-order fields plainly', () => {
    expect(fieldById('quest_template.LogTitle')!.label).toBe('Quest title');
    expect(fieldById('quest_template.QuestDescription')!.group).toBe('story');
    expect(fieldById('quest_template.RewardXPDifficulty')!.control).toBe('xpDifficulty');
    expect(fieldById('quest_template.AllowableRaces')!.control).toBe('raceMask');
    expect(fieldById('quest_template_addon.AllowableClasses')!.control).toBe('classMask');
    expect(fieldById('quest_template_addon.BreadcrumbForQuestId')!.group).toBe('availability');
  });
  it('types flag and enum fields with well-formed options', () => {
    const flags = (fieldById('quest_template.Flags') as any).type;
    expect(flags.kind).toBe('flags');
    const bits = flags.flags.map((f: any) => f.bit);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) expect(b & (b - 1), `bit ${b} is a power of two`).toBe(0);
    expect((fieldById('quest_template.QuestInfoID') as any).type.kind).toBe('enum');
  });
  it('builds table where-clauses', () => {
    expect(tableDef('quest_template').where(60001, [])).toEqual({ ID: '60001' });
    expect(tableDef('quest_template_addon').where(60001, [])).toEqual({ ID: '60001' });
    expect(fieldsOfGroup('story').length).toBeGreaterThan(3);
  });
});
