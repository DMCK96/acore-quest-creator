// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestEditorModal } from '../../src/renderer/views/QuestEditorModal';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const ready = async () => {
  const store = createAppStore(makeMockApi({ openQuest: async () => okv(sampleOpen()), validate: async () => okv([]) }), { saveDelayMs: 0 });
  render(<QuestEditorModal store={store} />);
  return store;
};
const edit = (store: Awaited<ReturnType<typeof ready>>) =>
  act(async () => { await store.getState().openQuest(sampleOpen().questId); store.getState().editQuest(); });

describe('QuestEditorModal', () => {
  it('shows nothing until a quest is being edited', async () => {
    const store = await ready();
    expect(screen.queryByRole('dialog')).toBeNull();
    await edit(store);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Escape and on a backdrop click, back to the chain', async () => {
    const store = await ready();
    await edit(store);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.getState().screen).not.toBe('edit');
    await edit(store);
    await userEvent.click(document.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog that takes focus and gives it back', async () => {
    const store = await ready();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await edit(store);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Escape closes an open module panel first, and only then the editor', async () => {
    const store = await ready();
    await edit(store);
    await userEvent.click(screen.getByRole('button', { name: /Dialogue/ }));
    expect(store.getState().openPanel).toBe('dialogue');
    await userEvent.keyboard('{Escape}');
    expect(store.getState().openPanel).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
