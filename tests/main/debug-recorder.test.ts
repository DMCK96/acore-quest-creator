import { describe, expect, it } from 'vitest';
import { createDebugRecorder } from '../../src/main/debug/recorder';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; }, advance: (d: number) => { t += d; } };
}

describe('the debug recorder', () => {
  it('records nothing until it is enabled, and nothing after it is disabled', () => {
    const c = clock();
    const r = createDebugRecorder({ now: c.now });
    r.record('main', { category: 'window', name: 'focus' });
    expect(r.count()).toBe(0);
    r.enable();
    r.record('main', { category: 'window', name: 'focus' });
    expect(r.count()).toBe(1);
    r.disable();
    r.record('main', { category: 'window', name: 'blur' });
    expect(r.count()).toBe(1);
    expect(r.enabled()).toBe(false);
  });

  it('starts a fresh timeline each time it is enabled', () => {
    const c = clock();
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    r.record('main', { category: 'a', name: 'one' });
    r.disable();
    r.enable();
    expect(r.count()).toBe(0);
  });

  it('stamps t as milliseconds since it was enabled, from now() or from the event\'s own time', () => {
    const c = clock(1_000);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    c.advance(250);
    r.record('main', { category: 'a', name: 'now' });
    r.record('renderer', { category: 'a', name: 'earlier', at: 1_100 });
    const byName = Object.fromEntries(r.events().map((e) => [e.name, e]));
    expect(byName['now']).toMatchObject({ t: 250, source: 'main', data: {} });
    expect(byName['earlier']).toMatchObject({ t: 100, source: 'renderer' });
  });

  it('returns events in time order even when a late batch arrives', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    c.set(500);
    r.record('main', { category: 'a', name: 'second' });
    r.record('renderer', { category: 'a', name: 'first', at: 200 });
    expect(r.events().map((e) => e.name)).toEqual(['first', 'second']);
  });

  it('drops the oldest events past its capacity', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now, capacity: 3 });
    r.enable();
    for (const name of ['a', 'b', 'c', 'd', 'e']) { c.advance(1); r.record('main', { category: 'x', name }); }
    expect(r.count()).toBe(3);
    expect(r.events().map((e) => e.name)).toEqual(['c', 'd', 'e']);
    expect(r.capacity).toBe(3);
  });

  it('defaults to a capacity of 5000', () => {
    expect(createDebugRecorder({ now: () => 0 }).capacity).toBe(5000);
  });

  it('filters by since (strictly later), by category, and keeps the newest events up to a limit', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    for (const [i, category] of ['input', 'window', 'input', 'input'].entries()) { c.set((i + 1) * 10); r.record('main', { category, name: `e${i}` }); }
    expect(r.events({ since: 20 }).map((e) => e.name)).toEqual(['e2', 'e3']);
    expect(r.events({ categories: ['window'] }).map((e) => e.name)).toEqual(['e1']);
    expect(r.events({ categories: ['input'], limit: 2 }).map((e) => e.name)).toEqual(['e2', 'e3']);
  });

  it('writes each event to the sink as one JSON line, and survives a sink that throws', () => {
    const c = clock(0);
    const lines: string[] = [];
    const r = createDebugRecorder({ now: c.now });
    r.enable({ write: (l) => { lines.push(l); } });
    r.record('main', { category: 'a', name: 'one', data: { n: 1 } });
    expect(JSON.parse(lines[0]!)).toEqual({ t: 0, source: 'main', category: 'a', name: 'one', data: { n: 1 } });
    r.disable();
    r.enable({ write: () => { throw new Error('disk full'); } });
    expect(() => r.record('main', { category: 'a', name: 'two' })).not.toThrow();
    expect(r.count()).toBe(1);
  });
});
