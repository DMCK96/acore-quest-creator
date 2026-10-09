import { describe, expect, it } from 'vitest';
import { waitForFlush } from '../../src/main/wait-for-flush';

/** A stand-in for ipcMain: listeners that can be counted and fired. */
function bus() {
  const listeners = new Set<() => void>();
  return {
    listeners,
    listen: (done: () => void) => { listeners.add(done); return () => { listeners.delete(done); }; },
    fire: () => [...listeners].forEach((l) => l()),
  };
}

describe('waitForFlush', () => {
  it('asks the window, resolves when it answers, and leaves no listener behind', async () => {
    const b = bus();
    let asked = 0;
    const waiting = waitForFlush({ listen: b.listen, send: () => { asked++; } });
    expect(asked).toBe(1);
    expect(b.listeners.size).toBe(1);
    b.fire();
    await waiting;
    expect(b.listeners.size).toBe(0);
  });

  it('gives up after the timeout when the window never answers, and leaves no listener behind', async () => {
    const b = bus();
    await waitForFlush({ listen: b.listen, send: () => {}, timeoutMs: 20 });
    expect(b.listeners.size).toBe(0);
  });

  it('waits as long as it takes when there is no timeout', async () => {
    const b = bus();
    let settled = false;
    const waiting = waitForFlush({ listen: b.listen, send: () => {} }).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    b.fire();
    await waiting;
    expect(settled).toBe(true);
  });
});
