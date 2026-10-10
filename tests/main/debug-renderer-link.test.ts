import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererLink } from '../../src/main/debug/renderer-link';
import type { RendererRequest } from '../../src/shared/ipc';

afterEach(() => { vi.useRealTimers(); });

describe('the renderer link', () => {
  it('sends a numbered request and resolves with the matching answer', async () => {
    const sent: RendererRequest[] = [];
    const link = createRendererLink({ send: (r) => { sent.push(r); return true; } });
    const first = link.ask({ kind: 'rect', selector: '.a' });
    const second = link.ask({ kind: 'rect', selector: '.b' });
    expect(sent.map((r) => r.id)).toEqual([1, 2]);
    link.answer(2, { rect: { x: 1, y: 2, width: 3, height: 4 } });
    link.answer(1, { rect: null });
    expect(await first).toEqual({ rect: null });
    expect(await second).toEqual({ rect: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it('resolves null when the window does not answer in time', async () => {
    vi.useFakeTimers();
    const link = createRendererLink({ send: () => true, timeoutMs: 2000 });
    const pending = link.ask({ kind: 'snapshot', includeValue: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeNull();
  });

  it('resolves null at once when there is no window to ask', async () => {
    const link = createRendererLink({ send: () => false });
    expect(await link.ask({ kind: 'snapshot', includeValue: false })).toBeNull();
  });

  it('ignores an answer for a request it does not know, or one that already timed out', async () => {
    vi.useFakeTimers();
    const link = createRendererLink({ send: () => true, timeoutMs: 100 });
    const pending = link.ask({ kind: 'rect', selector: '.a' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    expect(() => link.answer(1, { rect: null })).not.toThrow();
    expect(() => link.answer(99, { rect: null })).not.toThrow();
  });
});
