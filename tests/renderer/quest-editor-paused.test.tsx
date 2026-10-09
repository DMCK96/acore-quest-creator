// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { createAppStore } from '../../src/renderer/state/app-store';
import { QuestEditorModal } from '../../src/renderer/views/QuestEditorModal';
import { makeMockApi, okv, sampleOpen } from './mock-api';

async function editing() {
  const store = createAppStore(makeMockApi({ openQuest: async () => okv(sampleOpen()), validate: async () => okv([]) }), { saveDelayMs: 0 });
  render(<QuestEditorModal store={store} />);
  await act(async () => { await store.getState().openQuest(sampleOpen().questId); store.getState().editQuest(); });
  return store;
}
const body = () => document.querySelector('.quest-editor-modal__body') as HTMLElement;

describe('the quest editor while an AI write is on its way', () => {
  it('is greyed out and takes no input, with a notice, and is back once the write is over', async () => {
    const store = await editing();
    expect(body().hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => store.getState().holdEdits(true));
    expect(body().hasAttribute('inert')).toBe(true);
    expect(body().className).toMatch(/paused/);
    expect(screen.getByRole('status').textContent).toMatch(/assistant is changing this quest/i);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    act(() => store.getState().holdEdits(false));
    expect(body().hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
