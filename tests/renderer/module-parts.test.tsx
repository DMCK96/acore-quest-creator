// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSetting } from '../../src/renderer/modules/FieldSetting';
import { ListFieldEditor } from '../../src/renderer/modules/ListFieldEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import type { QuestAggregate } from '@core/model/aggregate';
import { makeMockApi, okv } from './mock-api';

const agg = (values: QuestAggregate['values'], readOnly: QuestAggregate['readOnly'] = []): QuestAggregate =>
  ({ questId: 60001, isNew: true, values, readOnly, sharedItems: {} });

const wrap = (ui: React.ReactNode, api = makeMockApi()) => render(<NamesProvider api={api}>{ui}</NamesProvider>);

describe('FieldSetting', () => {
  it('renders nothing for a field the quest does not carry', () => {
    const { container } = wrap(<FieldSetting fieldId="quest_template.TimeAllowed" aggregate={agg({})} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('uses the label override and reports changes by field id', async () => {
    const onChange = vi.fn();
    wrap(<FieldSetting fieldId="quest_template.RewardTalents" label="Talent points" aggregate={agg({ 'quest_template.RewardTalents': 0 })} onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText('Talent points'));
    await userEvent.type(screen.getByLabelText('Talent points'), '5');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardTalents', 5);
  });
  it('disables a read-only field and shows why', () => {
    wrap(<FieldSetting fieldId="quest_template.RewardTalents" label="Talent points"
      aggregate={agg({ 'quest_template.RewardTalents': 0 }, [{ fieldId: 'quest_template.RewardTalents', reason: 'Schema drift' }])} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Talent points')).toBeDisabled();
    expect(screen.getByText('Schema drift')).toBeInTheDocument();
  });
  it('uses a search picker for an item, NPC or quest reference, unless raw', async () => {
    const { unmount } = wrap(<FieldSetting fieldId="quest_template.StartItem" label="Started by item" aggregate={agg({ 'quest_template.StartItem': 0 })} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Started by item' })).toBeInTheDocument();
    unmount();
    wrap(<FieldSetting raw fieldId="quest_template.StartItem" label="Started by item" aggregate={agg({ 'quest_template.StartItem': 0 })} onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Started by item' })).toBeNull();
  });
  it('marks the wrapper with data-field so links can jump to it', () => {
    const { container } = wrap(<FieldSetting fieldId="quest_template.RewardTalents" aggregate={agg({ 'quest_template.RewardTalents': 0 })} onChange={vi.fn()} />);
    expect(container.querySelector('[data-field="quest_template.RewardTalents"]')).not.toBeNull();
  });
});

describe('ListFieldEditor', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ item: i + 1, amount: 1 }));
  const mountList = (values: QuestAggregate['values'], onChange = vi.fn(), api = makeMockApi()) => {
    wrap(<ListFieldEditor fieldId="quest_template.RewardItems" aggregate={agg(values)} onChange={onChange}
      noun="reward item" addLabel="Add reward item" title={(e) => `Item ${e.item}`} />, api);
    return onChange;
  };

  it('adds a blank entry built from the member types', async () => {
    const onChange = mountList({ 'quest_template.RewardItems': [] });
    await userEvent.click(screen.getByRole('button', { name: 'Add reward item' }));
    expect(onChange).toHaveBeenCalledWith('quest_template.RewardItems', [{ item: 0, amount: 1 }]);
  });
  it('blocks adding past the slot limit and says so', () => {
    mountList({ 'quest_template.RewardItems': items(4) });
    expect(screen.getByRole('button', { name: 'Add reward item' })).toBeDisabled();
    expect(screen.getByText('A quest can have at most 4 reward items.')).toBeInTheDocument();
  });
  it('removes and reorders cards', async () => {
    const onChange = mountList({ 'quest_template.RewardItems': items(3) });
    await userEvent.click(screen.getByRole('button', { name: 'Remove reward item 2' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardItems', [{ item: 1, amount: 1 }, { item: 3, amount: 1 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Move reward item 1 down' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardItems', [{ item: 2, amount: 1 }, { item: 1, amount: 1 }, { item: 3, amount: 1 }]);
    expect(screen.getByRole('button', { name: 'Move reward item 1 up' })).toBeDisabled();
  });
  it('edits an item member with the search picker and a count with a number box', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 750, name: 'Tough Wolf Meat' }])) });
    const onChange = mountList({ 'quest_template.RewardItems': [{ item: 0, amount: 1 }] }, vi.fn(), api);
    await userEvent.type(screen.getByRole('combobox', { name: 'Item 1' }), 'meat');
    await userEvent.click(await screen.findByRole('option', { name: 'Tough Wolf Meat · #750' }));
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardItems', [{ item: 750, amount: 1 }]);
    await userEvent.clear(screen.getByLabelText('How many 1'));
    await userEvent.type(screen.getByLabelText('How many 1'), '3');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RewardItems', [{ item: 0, amount: 3 }]);
  });
  it('edits a creature-or-object member as a kind switch plus a picker', async () => {
    const onChange = vi.fn();
    wrap(<ListFieldEditor fieldId="quest_template.RequiredNpcOrGo" onChange={onChange} noun="kill or use target" addLabel="Add"
      aggregate={agg({ 'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 5 }, count: 1 }] })} title={() => 'T'} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind 1' }), 'Object');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.RequiredNpcOrGo', [{ target: { target: 'gameobject', id: 0 }, count: 1 }]);
  });
});
