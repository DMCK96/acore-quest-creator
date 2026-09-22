// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupPanel } from '../../src/renderer/groups/GroupPanel';
import { NamesProvider } from '../../src/renderer/state/names';
import { registry, fieldsOfGroup } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi } from './mock-api';

async function aggregate() {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  return createNewAggregate(schema, registry, 60001);
}
const renderGroup = (group: any, agg: any, onChange = vi.fn()) =>
  render(<NamesProvider api={makeMockApi()}><GroupPanel group={group} aggregate={agg} onChange={onChange} /></NamesProvider>);

describe('GroupPanel', () => {
  it('renders every non-advanced field of the group with its label', async () => {
    renderGroup('story', await aggregate());
    for (const f of fieldsOfGroup('story').filter((f) => !f.advanced)) {
      expect(screen.getAllByText(f.label).length, f.id).toBeGreaterThan(0);
    }
  });
  it('puts advanced fields inside a collapsed Advanced section', async () => {
    const { container } = renderGroup('identity', await aggregate());
    const details = container.querySelector('details')!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Advanced');
  });
  it('emits the field id and a decoded value on edit', async () => {
    const onChange = vi.fn();
    renderGroup('story', await aggregate(), onChange);
    await userEvent.type(screen.getByLabelText('Quest title'), 'Hi');
    expect(onChange).toHaveBeenLastCalledWith('quest_template.LogTitle', 'Hi');
  });
  it('renders read-only fields disabled with the reason and omits drifted fields', async () => {
    const agg = await aggregate();
    const { 'quest_template.QuestLevel': _drop, ...rest } = agg.values;
    const withRO = { ...agg, values: rest, readOnly: [{ fieldId: 'quest_template.MinLevel', reason: 'Value "abc" is not a whole number' }] };
    renderGroup('identity', withRO);
    expect(screen.queryByLabelText('Quest level')).toBeNull();
    expect(screen.getByText(/is not a whole number/)).toBeInTheDocument();
  });
});
