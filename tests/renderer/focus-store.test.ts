import { describe, expect, it } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv, sampleOpen } from './mock-api';

const make = () => createAppStore(makeMockApi({ openQuest: async () => okv(sampleOpen({ questId: 7 })) }), { saveDelayMs: 0 });

describe('focus', () => {
  it('starts empty', () => {
    expect(make().getState().focus).toMatchObject({ questId: null, part: null, nonce: 0 });
  });

  it('a different focus bumps the nonce and stamps the moment; the same one does nothing', () => {
    const s = make();
    s.getState().setFocus(7);
    const first = s.getState().focus;
    expect(first).toMatchObject({ questId: 7, part: null, nonce: 1 });
    s.getState().setFocus(7);
    expect(s.getState().focus.nonce).toBe(1);
    s.getState().setFocus(7, { kind: 'creature', entry: 1234 });
    expect(s.getState().focus).toMatchObject({ part: { kind: 'creature', entry: 1234 }, nonce: 2 });
    expect(s.getState().focus.at).toBeGreaterThan(first.at);
  });

  it('asked again, the same focus is a new one', () => {
    const s = make();
    s.getState().setFocus(7);
    const first = s.getState().focus;
    s.getState().setFocus(7, null, { again: true });
    expect(s.getState().focus).toMatchObject({ questId: 7, part: null, nonce: 2 });
    expect(s.getState().focus.at).toBeGreaterThan(first.at);
  });

  it('opening a quest focuses it and clears the part', async () => {
    const s = make();
    s.getState().setFocus(7, { kind: 'creature', entry: 1 });
    await s.getState().openQuest(7);
    expect(s.getState().focus).toMatchObject({ questId: 7, part: null });
  });

  it('a failed open leaves the focus alone', async () => {
    const s = createAppStore(makeMockApi({ openQuest: async () => ({ ok: false, error: { code: 'x', message: 'no' } }) as never }), { saveDelayMs: 0 });
    s.getState().setFocus(3);
    await s.getState().openQuest(9);
    expect(s.getState().focus.questId).toBe(3);
  });

  it('closing the quest clears the focus', async () => {
    const s = make();
    await s.getState().openQuest(7);
    await s.getState().closeEditor();
    expect(s.getState().focus).toMatchObject({ questId: null, part: null });
  });
});
