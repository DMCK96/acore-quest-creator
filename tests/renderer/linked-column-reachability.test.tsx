// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registry } from '@core/registry';
import type { RowSetFieldDef } from '@core/registry/types';
import { mountBody } from './module-harness';

const ITEM = 2000;
const CREATURE = 100;
const OBJECT = 500;

const linkedFields = registry.fields.filter(
  (f): f is RowSetFieldDef => f.shape === 'rowset' && f.linked === true,
);

async function objectives() {
  await mountBody('objectives', {
    'quest_template.RequiredItems': [{ item: ITEM, count: 1 }],
    creature_loot_template: [
      { Entry: CREATURE, Item: ITEM, Reference: 0, Chance: 100, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null },
    ],
    creature_questitem: [{ CreatureEntry: CREATURE, Idx: 0, ItemId: ITEM, VerifiedBuild: 0 }],
    gameobject_loot_template: [
      { Entry: OBJECT, Item: ITEM, Reference: 0, Chance: 50, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1, Comment: null },
    ],
    gameobject_questitem: [{ GameObjectEntry: OBJECT, Idx: 0, ItemId: ITEM, VerifiedBuild: 0 }],
  });
  const view = { container: document.body };
  // Advanced columns live behind a collapsed <details>, which jsdom keeps out of the accessibility
  // tree until it is open — so open every one before looking.
  for (const summary of view.container.querySelectorAll('summary')) await userEvent.click(summary);
  return { view };
}

/**
 * Spec success criterion 4: "Every field of every table in sections 4.1 and 4.2 is reachable
 * through a curated control. Nothing is only editable via a raw view."
 *
 * The old coverage test only asked `resolveControl` for a component, which it answered for columns
 * no panel ever rendered. This asks the rendered tree.
 */
describe('linked-table column reachability', () => {
  it('covers all four linked tables', () => {
    expect(linkedFields.map((f) => f.table).sort()).toEqual([
      'creature_loot_template', 'creature_questitem', 'gameobject_loot_template', 'gameobject_questitem',
    ]);
  });

  it('renders an editable control for every column of every linked table', async () => {
    const { view } = await objectives();
    const controls = [...view.container.querySelectorAll('input, select, textarea')];
    const labelled = new Set<string>();
    for (const el of controls) {
      const id = el.getAttribute('id');
      const label = id ? view.container.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      if (label?.textContent) labelled.add(label.textContent.trim());
      const aria = el.getAttribute('aria-label');
      if (aria) labelled.add(aria.trim());
    }
    // A fieldset legend labels the group of controls inside it (list and row-set editors).
    for (const legend of view.container.querySelectorAll('fieldset > legend')) {
      if (legend.querySelector('input, select, textarea') === null && legend.textContent) {
        labelled.add(legend.textContent.trim());
      }
    }
    // The two columns that say *which* row this is are set elsewhere in the same UI, so the test
    // names the control that reaches each one rather than pretending they are unreachable.
    const VIA_FORM: Record<string, string> = {
      Entry: 'Source ID',
      CreatureEntry: 'Source ID',
      GameObjectEntry: 'Source ID',
      Item: 'Item 1',
      ItemId: 'Item 1',
    };
    const missing: string[] = [];
    for (const field of linkedFields) {
      for (const column of field.columns) {
        const via = VIA_FORM[column.name];
        if (labelled.has(column.label)) continue;
        if (via !== undefined && labelled.has(via)) continue;
        missing.push(`${field.table}.${column.name} (${column.label})`);
      }
    }
    expect(missing, 'columns with no control anywhere in the objectives UI').toEqual([]);
    // The exemptions have to be real: the controls they point at must actually be on the page.
    for (const via of new Set(Object.values(VIA_FORM))) expect(labelled.has(via), via).toBe(true);
  });

  it('keeps the previously unreachable columns specifically in reach', async () => {
    await objectives();
    for (const label of ['Reference loot', 'Only while on the quest', 'Loot mode', 'Group', 'Comment', 'Slot', 'Verified build']) {
      expect(screen.getAllByLabelText(label, { exact: false }).length, label).toBeGreaterThan(0);
    }
  });
});
