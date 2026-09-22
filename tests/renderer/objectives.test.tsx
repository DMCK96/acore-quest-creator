// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectivesPanel } from '../../src/renderer/groups/ObjectivesPanel';
import { NamesProvider } from '../../src/renderer/state/names';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, okv } from './mock-api';

async function agg(over: Record<string, any> = {}, shared: Record<string, number[]> = {}) {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60001);
  return { ...a, values: { ...a.values, ...over }, sharedItems: shared };
}
const api = makeMockApi({ lookupNames: async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.map((i) => [i, `Name ${i}`]))) });
const mount = (a: any, onChange = vi.fn()) => render(<NamesProvider api={api}><ObjectivesPanel aggregate={a} onChange={onChange} /></NamesProvider>);

describe('ObjectivesPanel', () => {
  it('shows kill/use and collect objectives', async () => {
    mount(await agg({ 'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 299 }, count: 8 }], 'quest_template.RequiredItems': [{ item: 2000, count: 5 }] }));
    expect(await screen.findByText('Name 299')).toBeInTheDocument();
    expect(await screen.findByText('Name 2000')).toBeInTheDocument();
  });
  it('adds a drop source for a required item through the form', async () => {
    const onChange = vi.fn();
    mount(await agg({ 'quest_template.RequiredItems': [{ item: 2000, count: 5 }] }), onChange);
    const region = screen.getByRole('region', { name: /where .* comes from/i });
    await userEvent.selectOptions(within(region).getByLabelText('Source type'), 'Creature');
    await userEvent.type(within(region).getByLabelText('Source ID'), '299');
    await userEvent.clear(within(region).getByLabelText('Drop chance (%)')); await userEvent.type(within(region).getByLabelText('Drop chance (%)'), '60');
    await userEvent.click(within(region).getByRole('button', { name: 'Add source' }));
    expect(onChange).toHaveBeenCalledWith('creature_loot_template', [expect.objectContaining({ Entry: 299, Item: 2000, Chance: 60, QuestRequired: 1 })]);
    expect(onChange).toHaveBeenCalledWith('creature_questitem', [expect.objectContaining({ CreatureEntry: 299, Idx: 0, ItemId: 2000 })]);
  });
  it('warns when another quest also needs the item', async () => {
    mount(await agg({ 'quest_template.RequiredItems': [{ item: 2000, count: 5 }] }, { '2000': [60002, 60003] }));
    expect(screen.getByText(/also used by quest 60002, 60003/i)).toBeInTheDocument();
  });
  it('lists existing sources with a remove button', async () => {
    const a = await agg({
      'quest_template.RequiredItems': [{ item: 2000, count: 5 }],
      creature_loot_template: [{ Entry: 299, Item: 2000, Reference: 0, Chance: 60, QuestRequired: 1, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 2, Comment: null }],
      creature_questitem: [{ CreatureEntry: 299, Idx: 0, ItemId: 2000, VerifiedBuild: 0 }],
    });
    const onChange = vi.fn();
    mount(a, onChange);
    await userEvent.click(await screen.findByRole('button', { name: /Remove source 299/ }));
    expect(onChange).toHaveBeenCalledWith('creature_loot_template', []);
    expect(onChange).toHaveBeenCalledWith('creature_questitem', []);
  });
  it('does not render the linked rowsets as raw tables', async () => {
    mount(await agg());
    expect(screen.queryByText('creature_loot_template')).toBeNull();
  });
});
