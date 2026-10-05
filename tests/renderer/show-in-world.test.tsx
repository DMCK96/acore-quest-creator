// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestHeader } from '../../src/renderer/views/QuestHeader';
import { QuestPreview } from '../../src/renderer/views/QuestPreview';
import { NamesProvider } from '../../src/renderer/state/names';
import { RewardTablesProvider } from '../../src/renderer/state/reward-tables';
import { ShowInWorldProvider } from '../../src/renderer/world3d/ShowInWorldContext';
import { mountBody } from './module-harness';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const names: Record<number, string> = { 1423: 'Stormwind Guard', 299: 'Diseased Young Wolf', 1561: 'Wanted Poster' };
const lookupNames = vi.fn(async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.filter((i) => names[i]).map((i) => [i, names[i]]))));

async function openStore() {
  const api = makeMockApi({ openQuest: vi.fn(async () => okv(sampleOpen({ questId: 60001 }))), lookupNames });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().openQuest(60001);
  return { api, store };
}

describe('Show in World', () => {
  it('Show in World in the quest header asks the host to show the quest', async () => {
    const show = vi.fn();
    const { api, store } = await openStore();
    render(
      <NamesProvider api={api}>
        <RewardTablesProvider api={api}>
          <ShowInWorldProvider value={show}>
            <QuestHeader store={store} chips={[]} />
          </ShowInWorldProvider>
        </RewardTablesProvider>
      </NamesProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show in World' }));
    expect(show).toHaveBeenCalledWith({ questId: 60001 });
  });

  it('Show in World in the graph preview asks the host to show the quest', async () => {
    const show = vi.fn();
    const { api, store } = await openStore();
    render(
      <NamesProvider api={api}>
        <ShowInWorldProvider value={show}>
          <QuestPreview store={store} />
        </ShowInWorldProvider>
      </NamesProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show in World' }));
    expect(show).toHaveBeenCalledWith({ questId: 60001 });
  });

  it('is not offered where there is no World to show', async () => {
    const { api, store } = await openStore();
    render(<NamesProvider api={api}><QuestPreview store={store} /></NamesProvider>);
    expect(screen.queryByRole('button', { name: 'Show in World' })).toBeNull();
  });
});

describe('Go to', () => {
  it('Go to beside a giver asks for that NPC', async () => {
    const show = vi.fn();
    await mountBody('giver', { creature_queststarter: [{ id: 1423 }] }, { api: makeMockApi({ lookupNames }), showInWorld: show });
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Stormwind Guard' }));
    expect(show).toHaveBeenCalledWith({ questId: 60001, kind: 'creature', entry: 1423 });
  });

  it('Go to beside an object ender asks for that object', async () => {
    const show = vi.fn();
    await mountBody('giver', { gameobject_questender: [{ id: 1561 }] }, { api: makeMockApi({ lookupNames }), showInWorld: show });
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Wanted Poster' }));
    expect(show).toHaveBeenCalledWith({ questId: 60001, kind: 'gameobject', entry: 1561 });
  });

  it('Go to beside a kill objective asks for that NPC; none for a blank one', async () => {
    const show = vi.fn();
    await mountBody('objectives', {
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 299 }, count: 10 }, { target: { target: 'creature', id: 0 }, count: 1 }],
    }, { api: makeMockApi({ lookupNames }), showInWorld: show });
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Diseased Young Wolf' }));
    expect(show).toHaveBeenCalledWith({ questId: 60001, kind: 'creature', entry: 299 });
    expect(screen.getAllByRole('button', { name: /^Go to / })).toHaveLength(1);
  });

  it('offers no Go to without a World', async () => {
    await mountBody('giver', { creature_queststarter: [{ id: 1423 }] }, { api: makeMockApi({ lookupNames }) });
    await screen.findAllByText(/Starts at/);
    expect(screen.queryByRole('button', { name: /^Go to / })).toBeNull();
  });
});
