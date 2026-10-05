// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { HistoryButtons, isTextField } from '../../src/renderer/components/HistoryButtons';
import { HistoryNote } from '../../src/renderer/components/HistoryNote';
import { makeMockApi, okv, emptyHistoryResult } from './mock-api';

const steps = { steps: [
  { id: 1, label: 'New quest 60012', kind: 'quest' as const, where: { questId: 60012 } },
  { id: 2, label: 'Moved Stormwind Guard', kind: 'world' as const, where: { map: 0, x: 1, y: 2, z: 3 } },
  { id: 3, label: 'Renamed the project', kind: 'project' as const, where: null },
], current: 2, saved: 1 };

function setup() {
  // An undo or redo that leaves the history as it was, so both buttons stay
  const api = makeMockApi({ historyUndo: async () => okv({ ...emptyHistoryResult, history: steps }), historyRedo: async () => okv({ ...emptyHistoryResult, history: steps }) });
  const store = createAppStore(api);
  store.getState().setHistory(steps);
  return { api, store };
}

describe('the undo buttons and History list', () => {
  it('name the step each would act on, and are disabled with nothing to do', async () => {
    const { store } = setup();
    render(<HistoryButtons store={store} />);
    expect(screen.getByRole('button', { name: 'Undo: Moved Stormwind Guard (Ctrl+Z)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redo: Renamed the project (Ctrl+Y)' })).toBeEnabled();
    store.getState().setHistory({ steps: [], current: 0, saved: 0 });
    expect(await screen.findByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Y)' })).toBeDisabled();
  });

  it('undo and redo buttons call the store', async () => {
    const { api, store } = setup();
    render(<HistoryButtons store={store} />);
    await userEvent.click(screen.getByRole('button', { name: /^Undo:/ }));
    expect(api.historyUndo).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Redo:/ }));
    expect(api.historyRedo).toHaveBeenCalled();
  });

  it('lists the steps newest first, marks the current and saved points, and jumps on a click', async () => {
    const { api, store } = setup();
    render(<HistoryButtons store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items[0]).toContain('Renamed the project');
    expect(items[2]).toContain('New quest 60012');
    expect(items[2]).toContain('Saved');
    expect(screen.getByRole('menuitem', { name: /Moved Stormwind Guard/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('menuitem', { name: /Renamed the project/ })).toHaveClass('history__step--undone');
    await userEvent.click(screen.getByRole('menuitem', { name: /New quest 60012/ }));
    expect(api.historyJump).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists a way back to before every step, and says so when empty', async () => {
    const { api, store } = setup();
    render(<HistoryButtons store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Start of this session/ }));
    expect(api.historyJump).toHaveBeenCalledWith(0);
    store.getState().setHistory({ steps: [], current: 0, saved: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Nothing to undo yet.')).toBeTruthy();
  });

  it('closes the list on Esc', async () => {
    const { store } = setup();
    render(<HistoryButtons store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the undo note', () => {
  it('says what was undone, lists what was skipped, and Show goes there', async () => {
    const { store } = setup();
    const onShowQuest = vi.fn(); const onShowPlace = vi.fn();
    store.setState({ historyNote: { text: 'Undid: Title of X', where: { questId: 60012 }, skipped: ['Could not redo: spawn 9 is now in the database'] } });
    render(<HistoryNote store={store} onShowQuest={onShowQuest} onShowPlace={onShowPlace} />);
    expect(screen.getByRole('status').textContent).toContain('Undid: Title of X');
    expect(screen.getByText('Could not redo: spawn 9 is now in the database')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(onShowQuest).toHaveBeenCalledWith(60012);
    store.setState({ historyNote: { text: 'Redid: Moved Guard', where: { map: 0, x: 1, y: 2, z: 3 }, skipped: [] } });
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }));
    expect(onShowPlace).toHaveBeenCalledWith({ map: 0, x: 1, y: 2, z: 3 });
  });

  it('has no Show without a place, and closes', async () => {
    const { store } = setup();
    store.setState({ historyNote: { text: 'Undid: Renamed the project', where: null, skipped: [] } });
    render(<HistoryNote store={store} onShowQuest={vi.fn()} onShowPlace={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(store.getState().historyNote).toBeNull();
  });
});

describe('isTextField', () => {
  it('knows text fields from other targets', () => {
    const text = document.createElement('input');
    const box = document.createElement('input'); box.type = 'checkbox';
    const area = document.createElement('textarea');
    const div = document.createElement('div'); div.contentEditable = 'true';
    expect([isTextField(text), isTextField(box), isTextField(area), isTextField(div), isTextField(document.body), isTextField(null)]).toEqual([true, false, true, true, false, false]);
  });
});
