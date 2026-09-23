// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestStartsList } from '../../src/renderer/views/QuestStartsList';
import { makeMockApi, okv, sampleOpen } from './mock-api';
import type { QuestLinks } from '@shared/ipc';

const links: QuestLinks = {
  instances: [
    { id: 'a', component: 'start.npc', owner: 60001, from: { kind: 'creature', entry: 100 }, to: { kind: 'quest', questId: 60001 }, params: {}, claims: [], editable: true, label: 'Offered by an NPC', summary: 'Offered by Marshal (100)' },
    { id: 'b', component: 'start.smartai', owner: 60001, from: { kind: 'creature', entry: 100 }, to: { kind: 'quest', questId: 60001 }, params: {}, claims: [], editable: false, readOnlyReason: 'SmartAI triggers become editable with the trigger catalog.', label: 'Offered by a SmartAI script', summary: 'Offered by a script on Marshal (100) when the player talks to it' },
  ],
  unrecognised: [{ questId: 60001, key: 'k', summary: 'when a quest objective is completed: SmartAI action 12 (quest 60001, row 0)' }],
  unavailable: [{ component: 'start.item', label: 'Begun by an item', reason: 'Needs item_template.startquest, which this database does not have.' }],
};

describe('QuestStartsList', () => {
  it('lists every start in plain language with read-only reasons, unknown script rows and unavailable components', () => {
    render(<QuestStartsList links={links} questId={60001} onOpenQuest={() => {}} />);
    expect(screen.getByRole('heading', { name: 'How this quest starts' })).toBeInTheDocument();
    expect(screen.getByText('Offered by Marshal (100)')).toBeInTheDocument();
    expect(screen.getByText('Offered by a script on Marshal (100) when the player talks to it')).toBeInTheDocument();
    expect(screen.getByText('SmartAI triggers become editable with the trigger catalog.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Script rows the tool does not understand yet' })).toBeInTheDocument();
    expect(screen.getByText(/SmartAI action 12/)).toBeInTheDocument();
    expect(screen.getByText('Begun by an item: Needs item_template.startquest, which this database does not have.')).toBeInTheDocument();
  });
  it('jumps to the field behind an editable start', async () => {
    const withClaim: QuestLinks = { ...links, instances: [{ ...links.instances[0], claims: [{ table: 'creature_queststarter', key: 'id=100,quest=60001' }] }] };
    render(<><QuestStartsList links={withClaim} questId={60001} onOpenQuest={() => {}} /><div data-field="creature_queststarter"><fieldset><input aria-label="Starters" /></fieldset></div></>);
    screen.getByRole('button', { name: 'Edit: Offered by Marshal (100)' }).click();
    expect(document.activeElement).toBe(screen.getByLabelText('Starters'));
  });
  it('splits what starts this quest from what it unlocks, and only edits links this quest owns', async () => {
    const claim = (id: number, column: string) => ({ table: 'quest_template_addon', key: `ID=${id}`, column });
    const view = (over: Partial<QuestLinks['instances'][number]>): QuestLinks['instances'][number] => ({
      id: 'x', component: 'unlock.afterTurnIn', owner: 60001, from: { kind: 'quest', questId: 60000 }, to: { kind: 'quest', questId: 60001 },
      params: {}, claims: [], editable: true, label: 'Unlocked by turning in', summary: '', ...over,
    });
    const split: QuestLinks = {
      unrecognised: [], unavailable: [],
      instances: [
        view({ id: 'in', summary: 'Turning in 60000 unlocks this', claims: [claim(60001, 'PrevQuestID')] }),
        view({ id: 'out', owner: 60002, from: { kind: 'quest', questId: 60001 }, to: { kind: 'quest', questId: 60002 }, summary: 'Turning in this unlocks 60002', claims: [claim(60002, 'PrevQuestID')] }),
        view({ id: 'grp', component: 'group.pickOne', owner: 59999, from: { kind: 'group', group: 7 }, to: { kind: 'group', group: 7 }, params: { group: 7, members: [59999, 60001] }, summary: 'Pick one of 59999, 60001', claims: [claim(59999, 'ExclusiveGroup')] }),
      ],
    };
    const onOpenQuest = vi.fn();
    render(<QuestStartsList links={split} questId={60001} onOpenQuest={onOpenQuest} />);
    const starts = screen.getByRole('region', { name: 'How this quest starts' });
    const unlocks = screen.getByRole('region', { name: 'What this quest unlocks' });
    expect(starts).toHaveTextContent('Turning in 60000 unlocks this');
    expect(starts).toHaveTextContent('Pick one of 59999, 60001');
    expect(starts).not.toHaveTextContent('Turning in this unlocks 60002');
    expect(unlocks).toHaveTextContent('Turning in this unlocks 60002');
    expect(screen.getByRole('button', { name: 'Edit: Turning in 60000 unlocks this' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit: Turning in this unlocks 60002' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit: Pick one of 59999, 60001' })).toBeNull();
    screen.getByRole('button', { name: 'Open quest 60002' }).click();
    screen.getByRole('button', { name: 'Open quest 59999' }).click();
    expect(onOpenQuest.mock.calls).toEqual([[60002], [59999]]);
  });
  it('says so when nothing is found', () => {
    render(<QuestStartsList links={{ instances: [], unrecognised: [], unavailable: [] }} questId={60001} onOpenQuest={() => {}} />);
    expect(screen.getByText('Nothing starts this quest yet.')).toBeInTheDocument();
    expect(screen.getByText('This quest does not unlock another quest.')).toBeInTheDocument();
  });
});

describe('store.loadLinks', () => {
  it('loads the open quest\'s links after opening it', async () => {
    const api = makeMockApi({ openQuest: async () => okv(sampleOpen()), questLinks: async () => okv(links) });
    const store = createAppStore(api, { saveDelayMs: 0 });
    await store.getState().openQuest(60001);
    await waitFor(() => expect(store.getState().links).toEqual(links));
    expect(api.questLinks).toHaveBeenCalledWith([60001]);
  });
});
