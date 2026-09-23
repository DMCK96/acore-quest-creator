// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
    render(<QuestStartsList links={links} />);
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
    render(<><QuestStartsList links={withClaim} /><div data-field="creature_queststarter"><fieldset><input aria-label="Starters" /></fieldset></div></>);
    screen.getByRole('button', { name: 'Edit: Offered by Marshal (100)' }).click();
    expect(document.activeElement).toBe(screen.getByLabelText('Starters'));
  });
  it('says so when nothing is found', () => {
    render(<QuestStartsList links={{ instances: [], unrecognised: [], unavailable: [] }} />);
    expect(screen.getByText('Nothing starts or unlocks this quest yet.')).toBeInTheDocument();
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
