import { describe, it, expect, vi } from 'vitest';
import { createCloseGuard, windowTitle } from '../../src/main/project/close-guard';
import type { ProjectController } from '../../src/main/project/controller';

const controller = (settle: boolean) => {
  const calls: string[] = [];
  const projects = {
    settleUnsaved: vi.fn(async () => { calls.push('settle'); return settle; }),
    discardOnQuit: vi.fn(async () => { calls.push('discard'); }),
  } as unknown as ProjectController;
  return { projects, calls };
};

describe('windowTitle', () => {
  it('shows the name and a dot while there are unsaved changes', () => {
    expect(windowTitle('Northshire', false)).toBe('Northshire — ACORE Quest Creator');
    expect(windowTitle('Northshire', true)).toBe('Northshire • — ACORE Quest Creator');
  });
});

describe('close guard', () => {
  it('flushes the renderer, then asks, then clears the recovery copy', async () => {
    const { projects, calls } = controller(true);
    const guard = createCloseGuard({ flush: async () => { calls.push('flush'); }, projects });
    expect(await guard()).toBe(true);
    expect(calls).toEqual(['flush', 'settle', 'discard']);
  });
  it('keeps the window open, and the recovery copy, when the user cancels', async () => {
    const { projects, calls } = controller(false);
    expect(await createCloseGuard({ flush: async () => {}, projects })()).toBe(false);
    expect(calls).toEqual(['settle']);
  });
  it('keeps the window open and says why when saving on close fails', async () => {
    const projects = {
      settleUnsaved: vi.fn(async () => { throw new Error('Could not save the project to X: EACCES'); }),
      discardOnQuit: vi.fn(async () => {}),
    } as unknown as ProjectController;
    const onError = vi.fn();
    expect(await createCloseGuard({ flush: async () => {}, projects, onError })()).toBe(false);
    expect(onError).toHaveBeenCalledWith('Could not save the project to X: EACCES');
    expect(projects.discardOnQuit).not.toHaveBeenCalled();
  });
  it('does not wait forever for a renderer that never answers', async () => {
    vi.useFakeTimers();
    try {
      const { projects } = controller(true);
      const result = createCloseGuard({ flush: () => new Promise(() => {}), projects, timeoutMs: 2000 })();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await result).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
