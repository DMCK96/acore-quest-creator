// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestFlowView } from '../../src/renderer/views/QuestFlowView';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import type { Issue } from '@core/validate/validate';
import type { FieldValue } from '@core/registry/types';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi, okv, sampleOpen } from './mock-api';

async function mountFlow(over: Record<string, FieldValue> = {}, issues: Issue[] = []) {
  const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
  const a = createNewAggregate(schema, registry, 60123);
  const open = sampleOpen({ questId: 60123, issues, aggregate: { ...a, values: { ...a.values, ...over } } });
  const api = makeMockApi({ newQuest: vi.fn(async () => okv(open)) });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().newQuest();
  render(<NamesProvider api={api}><RewardTablesProvider api={api}><QuestFlowView store={store} /></RewardTablesProvider></NamesProvider>);
  return { store, api };
}

describe('quest flow view', () => {
  it('shows a new quest as four empty core modules and a header', async () => {
    await mountFlow();
    const flow = screen.getByRole('list', { name: 'Modules' });
    expect(within(flow).getAllByRole('button').map((b) => b.getAttribute('data-module'))).toEqual(['giver', 'objectives', 'dialogue', 'rewards']);
    expect(screen.getByLabelText('Quest title')).toBeInTheDocument();
    expect(screen.getByText('#60123')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('opens a module panel from its box and closes it with Escape', async () => {
    await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: /^Rewards/ }));
    expect(screen.getByRole('dialog', { name: 'Rewards' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Rewards' })).toBeNull();
  });

  it('adds an optional module from the menu', async () => {
    const { store } = await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Timer/ }));
    expect(store.getState().addedModules).toEqual(['timer']);
    expect(screen.getByRole('dialog', { name: 'Timer' })).toBeInTheDocument();
  });

  it('removes an optional module after confirming', async () => {
    const { store } = await mountFlow({ 'quest_template.TimeAllowed': 900 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /^Timer/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove module' }));
    expect(store.getState().open?.aggregate.values['quest_template.TimeAllowed']).toBe(0);
  });

  it('Advanced cannot be removed, since it holds every rare column', async () => {
    await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Advanced/ }));
    expect(screen.getByRole('dialog', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove module' })).toBeNull();
  });

  it('core modules cannot be removed', async () => {
    await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: /^Objectives/ }));
    expect(screen.queryByRole('button', { name: 'Remove module' })).toBeNull();
  });

  it('shows a readiness chip coloured by the worst issue and opens that module', async () => {
    await mountFlow({}, [{ severity: 'error', code: 'X', fieldId: 'quest_template.RewardItems', message: 'Item 9 does not exist.' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Rewards: error' }));
    expect(within(screen.getByRole('dialog', { name: 'Rewards' })).getByText('Item 9 does not exist.')).toBeInTheDocument();
  });

  it('shows module summaries in the boxes', async () => {
    await mountFlow({ 'quest_template.TimeAllowed': 905 });
    expect(within(screen.getByRole('button', { name: /^Timer/ })).getByText('15m 5s')).toBeInTheDocument();
  });

  it('edits the title from the header', async () => {
    const { store } = await mountFlow();
    await userEvent.type(screen.getByLabelText('Quest title'), 'W');
    expect(store.getState().open?.aggregate.values['quest_template.LogTitle']).toMatch(/W$/);
  });

  it('goes back to the chain', async () => {
    const { store } = await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: '← Back to chain' }));
    expect(store.getState().screen).toBe('preview');
  });

  it('opens the changes view from the header', async () => {
    await mountFlow();
    await userEvent.click(screen.getByRole('button', { name: 'Changes' }));
    expect(screen.getByRole('dialog', { name: 'Changes' })).toBeInTheDocument();
  });
});
