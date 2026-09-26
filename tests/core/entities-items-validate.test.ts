import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newItem } from '../../src/core/entities/model';

const good = { ...newItem(990030), name: 'Pearl', displayId: 7040 };
const run = (item: unknown, extra: Partial<Parameters<typeof entityIssues>[0]> = {}) =>
  entityIssues({ entities: { npcs: [], objects: [], items: [item as never] }, dbNames: new Map(), ...extra }).map((i) => [i.code, i.severity, i.message]);

describe('item validation', () => {
  it('accepts a complete item', () => expect(run(good)).toEqual([]));
  it('needs a name and a positive stack size', () => {
    expect(run({ ...good, name: ' ', stackable: 0 })).toEqual([
      ['ITEM_NO_NAME', 'error', 'Item 990030: give it a name.'],
      ['ITEM_STACK', 'error', 'Item 990030: the stack size must be at least 1.'],
    ]);
  });
  it('rejects negative levels and empty stat, damage and spell rows', () => {
    expect(run({ ...good, requiredLevel: -1, stats: [{ type: 0, value: 5 }], damage: [{ min: 0, max: 0, school: 0 }], spells: [{ spell: 0, trigger: 0, charges: 0, cooldownMs: -1, category: 0, categoryCooldownMs: -1 }] }).map((r) => r[0])).toEqual([
      'ITEM_LEVELS', 'ITEM_EMPTY_STAT', 'ITEM_EMPTY_DAMAGE', 'ITEM_EMPTY_SPELL',
    ]);
  });
  it('warns about a missing look, a taken entry, an unknown quest and an equippable quest item', () => {
    expect(run({ ...good, displayId: 0, startsQuest: 777, inventoryType: 13 }, {
      dbNames: new Map([['item:990030', 'Other Thing']]), knownQuest: (id) => id !== 777,
    })).toEqual([
      ['ITEM_NO_LOOK', 'warning', 'Item "Pearl": it has no look, so it shows as a question mark; choose a display ID.'],
      ['ITEM_QUEST_EQUIP', 'warning', 'Item "Pearl": it can be equipped but its class is Quest; pick the class it should be.'],
      ['ITEM_STARTS_UNKNOWN', 'warning', 'Item "Pearl": it starts quest 777, which is neither in the world database nor in this project.'],
      ['ENTITY_TAKEN', 'warning', 'Item "Pearl": entry 990030 already holds "Other Thing" in the database, which this would replace.'],
    ]);
  });
  it('checks advanced values against the column type and pages for text', () => {
    expect(run({ ...good, advanced: { holy_res: 'lots', ScriptName: 'x' }, pages: [{ id: 1, text: '' }] }, {
      itemColumnTypes: new Map([['holy_res', 'smallint'], ['ScriptName', 'varchar']]),
    })).toEqual([
      ['ITEM_EMPTY_PAGE', 'warning', 'Item "Pearl": a page has no text.'],
      ['ITEM_ADVANCED_TYPE', 'error', 'Item "Pearl": holy_res must be a number, not "lots".'],
    ]);
  });
});
