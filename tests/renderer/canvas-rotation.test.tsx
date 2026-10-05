// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { createAppStore } from '../../src/renderer/state/app-store';
import { CanvasHome } from '../../src/renderer/views/CanvasHome';
import { makeMockApi, okv, errv, sampleOpen, nodeOf } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const rec = { id: 1, name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd' };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };

const aggregateOf = (questId: number, title: string, flags = 0) => ({
  questId,
  isNew: false,
  values: { 'quest_template.LogTitle': title, 'quest_template.Flags': flags },
  readOnly: [],
  sharedItems: {},
});
const rotation = () => ({
  id: 900010,
  name: 'Dailies',
  map: 0,
  maxActive: 1,
  members: [{ type: 'quest' as const, questId: 60001 }, { type: 'quest' as const, questId: 60002 }],
  origin: { kind: 'new' as const },
  event: null,
});

async function canvas(over: Record<string, any> = {}) {
  const api = makeMockApi({
    saveProfile: async () => okv(rec),
    connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }),
    listNodes: async () => okv([nodeOf({ daily: true }), nodeOf({ questId: 60002, title: 'Boars', x: 320, weekly: true })]),
    openQuest: vi.fn(async (id: number) =>
      okv(sampleOpen({ questId: id, aggregate: id === 60001 ? aggregateOf(60001, 'Wolves', 0x1000) : aggregateOf(60002, 'Boars', 0x8000) })),
    ),
    validate: async () => okv([]),
    ...over,
  });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  const view = render(<CanvasHome store={store} />);
  return { api, store, view };
}

describe('rotations on the Quests graph', () => {
  it('Rotate these quests is offered for two or more selected quests and opens the dialog with them', async () => {
    const { api } = await canvas();
    const [wolves, boars] = await screen.findAllByTestId('quest-node');
    const tools = screen.getByRole('toolbar', { name: 'Quest tools' });
    expect(within(tools).queryByRole('button', { name: 'Rotate these quests…' })).toBeNull();
    // d3's drag cannot take user-event's mouse down in jsdom, so the clicks are fired as the other canvas tests fire them
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    fireEvent.click(wolves!, { ctrlKey: true });
    fireEvent.click(boars!, { ctrlKey: true });
    fireEvent.keyUp(document.body, { key: 'Control' });
    // A Ctrl+click selects; it does not open the preview
    expect(api.openQuest).not.toHaveBeenCalled();
    await userEvent.click(await within(tools).findByRole('button', { name: 'Rotate these quests…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quest rotation' });
    expect(within(dialog).getByRole('listitem', { name: 'Wolves' })).toBeTruthy();
    expect(within(dialog).getByRole('listitem', { name: 'Boars' })).toBeTruthy();
    expect(api.worldNewGroupId).toHaveBeenCalled();
  });

  it('Shift+click adds to the selection like Ctrl+click, without opening the quest', async () => {
    const { api } = await canvas();
    const [wolves, boars] = await screen.findAllByTestId('quest-node');
    const tools = screen.getByRole('toolbar', { name: 'Quest tools' });
    fireEvent.keyDown(document.body, { key: 'Shift', shiftKey: true });
    fireEvent.click(wolves!, { shiftKey: true });
    fireEvent.click(boars!, { shiftKey: true });
    fireEvent.keyUp(document.body, { key: 'Shift' });
    expect(await within(tools).findByRole('button', { name: 'Rotate these quests…' })).toBeTruthy();
    expect(api.openQuest).not.toHaveBeenCalled();
  });

  it('a single click on a card still opens its preview', async () => {
    const { api } = await canvas();
    const [wolves] = await screen.findAllByTestId('quest-node');
    fireEvent.click(wolves!, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(api.openQuest).toHaveBeenCalledWith(60001));
  });

  it('outlines the selection only while two or more quests are selected, so a plain click leaves only the open highlight', async () => {
    const { api } = await canvas();
    const [wolves, boars] = await screen.findAllByTestId('quest-node');
    const flow = screen.getByTestId('rf__wrapper');
    fireEvent.click(wolves!, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(api.openQuest).toHaveBeenCalledWith(60001));
    expect(flow).not.toHaveClass('canvas--multi');
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    fireEvent.click(boars!, { ctrlKey: true });
    fireEvent.keyUp(document.body, { key: 'Control' });
    await waitFor(() => expect(flow).toHaveClass('canvas--multi'));
    // A click on the empty graph clears the selection, and the outline with it
    fireEvent.click(flow.querySelector('.react-flow__pane')!);
    await waitFor(() => expect(flow).not.toHaveClass('canvas--multi'));
    // The outline is drawn only under the multi-selection class
    const css = readFileSync('src/renderer/views/QuestNodeCard.css', 'utf-8');
    const outlined = css.match(/([^{}]+)\{[^}]*outline:\s*2px solid/)?.[1]?.trim();
    expect(outlined).toBe('.canvas--multi .react-flow__node.selected .quest-card');
  });

  it('the click that ends a drag neither opens nor outlines the quest', async () => {
    const { api } = await canvas();
    const [wolves] = await screen.findAllByTestId('quest-node');
    // React Flow's drag reads the event's `view`, which jsdom's events lack; the browser ends a drag with a click
    const withView = (event: Event): Event => Object.defineProperty(event, 'view', { value: window });
    fireEvent(wolves!, withView(createEvent.mouseDown(wolves!, { clientX: 10, clientY: 10, buttons: 1 })));
    fireEvent(window, withView(createEvent.mouseMove(window, { clientX: 80, clientY: 60, buttons: 1 })));
    fireEvent(window, withView(createEvent.mouseUp(window, { clientX: 80, clientY: 60 })));
    fireEvent.click(wolves!, { clientX: 80, clientY: 60 });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.openQuest).not.toHaveBeenCalled();
    expect(wolves!.getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('rf__wrapper')).not.toHaveClass('canvas--multi');
  });

  it('shows a rotation tag on each quest in a pool, which opens the dialog', async () => {
    const existing = { ...rotation(), id: 900, origin: { kind: 'existing', original: { template: {}, members: [], event: null } } };
    const { api } = await canvas({
      questPools: async () => okv([{ id: 900, name: 'Dailies', maxActive: 1, daily: true, questIds: [60001, 60002] }]),
      worldGroup: vi.fn(async () => okv(existing)),
    });
    const wolves = await screen.findByRole('button', { name: 'Quest 60001: Wolves' });
    const tag = await within(wolves).findByRole('button', { name: 'Daily rotation: Dailies' });
    await userEvent.click(tag);
    const dialog = await screen.findByRole('dialog', { name: 'Quest rotation' });
    expect(within(dialog).getByLabelText('Name')).toHaveProperty('value', 'Dailies');
    expect(api.worldGroup).toHaveBeenCalledWith(900);
    expect(within(dialog).getByRole('button', { name: 'Delete rotation' })).toBeTruthy();
  });

  it('the open quest names its rotation in the Behaviour module, in the preview and the editor', async () => {
    const { store } = await canvas({ questPools: async () => okv([{ id: 900, name: 'Dailies', maxActive: 1, daily: true, questIds: [60001, 60002] }]) });
    await screen.findAllByTestId('quest-node');
    await store.getState().openQuest(60001);
    const preview = await screen.findByRole('complementary', { name: 'Quest preview' });
    expect(within(preview).getByText('Daily rotation: Dailies')).toBeTruthy();
    store.getState().editQuest();
    const modules = await screen.findByRole('list', { name: 'Modules' });
    expect(within(modules).getByRole('button', { name: /Behaviour/ }).textContent).toContain('Daily rotation: Dailies');
  });

  it('saves a rotation as one step, making the other quests daily, and reloads the pools', async () => {
    const pools = vi.fn(async () => okv([] as any[]));
    const { api, store } = await canvas({ questPools: pools });
    await screen.findAllByTestId('quest-node');
    const before = pools.mock.calls.length;
    expect(await store.getState().saveRotation(rotation(), [], 'daily')).toBe(true);
    expect(api.historyBegin).toHaveBeenCalledWith('Saved rotation Dailies', undefined);
    // Wolves is already daily; Boars, weekly, is made daily
    expect(api.updateQuest).toHaveBeenCalledTimes(1);
    expect((api.updateQuest as any).mock.calls[0][0]).toMatchObject({ questId: 60002, values: { 'quest_template.Flags': 0x1000 } });
    expect(api.worldSetGroup).toHaveBeenCalledWith(rotation(), []);
    expect(pools.mock.calls.length).toBeGreaterThan(before);
  });

  it('makes the open quest daily through its own edit', async () => {
    const { api, store } = await canvas();
    await screen.findAllByTestId('quest-node');
    await store.getState().openQuest(60002);
    await store.getState().saveRotation(rotation(), [], 'daily');
    expect(store.getState().open?.aggregate.values['quest_template.Flags']).toBe(0x1000);
    expect((api.updateQuest as any).mock.calls.at(-1)[0]).toMatchObject({ questId: 60002, values: { 'quest_template.Flags': 0x1000 } });
  });

  it('a refused rotation save puts back the flags it changed, so it leaves no step', async () => {
    const { api, store } = await canvas({ worldSetGroup: vi.fn(async () => errv('VALIDATION', 'This spawn group cannot be saved.')) });
    await screen.findAllByTestId('quest-node');
    expect(await store.getState().saveRotation(rotation(), [], 'daily')).toBe(false);
    // Boars was made daily for the save, then put back to weekly when the save was refused
    const boars = (api.updateQuest as any).mock.calls.filter((c: any[]) => c[0].questId === 60002).map((c: any[]) => c[0].values['quest_template.Flags']);
    expect(boars).toEqual([0x1000, 0x8000]);
    expect(store.getState().error).toBe('This spawn group cannot be saved.');
  });

  it('a refused rotation save puts back the flags of the open quest', async () => {
    const { store } = await canvas({ worldSetGroup: vi.fn(async () => errv('VALIDATION', 'This spawn group cannot be saved.')) });
    await screen.findAllByTestId('quest-node');
    await store.getState().openQuest(60001);
    expect(await store.getState().saveRotation(rotation(), [], 'weekly')).toBe(false);
    expect(store.getState().open?.aggregate.values['quest_template.Flags']).toBe(0x1000);
  });

  it('deletes a rotation as one step', async () => {
    const { api, store } = await canvas();
    await screen.findAllByTestId('quest-node');
    expect(await store.getState().deleteRotation(900, 'Dailies')).toBe(true);
    expect(api.worldDeleteGroup).toHaveBeenCalledWith(900);
    expect(api.historyBegin).toHaveBeenCalledWith('Deleted rotation Dailies', undefined);
  });
});
