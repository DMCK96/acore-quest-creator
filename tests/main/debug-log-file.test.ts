import { describe, expect, it } from 'vitest';
import { createLogFiles, type LogFs } from '../../src/main/debug/log-file';

const base = (p: string) => p.split(/[\\/]/).pop()!;

function fakeFs(initial: string[] = []) {
  const files = new Map<string, string>(initial.map((n) => [n, '']));
  let failAppend = false;
  const fs: LogFs = {
    mkdir: async () => {},
    readdir: async () => [...files.keys()],
    rm: async (p) => { files.delete(base(p)); },
    append: async (p, text) => {
      if (failAppend) throw new Error('disk full');
      files.set(base(p), (files.get(base(p)) ?? '') + text);
    },
  };
  return { files, fs, failAppends: () => { failAppend = true; } };
}

const at = new Date('2026-10-10T12:30:45.000Z');

describe('the debug log file', () => {
  it('opens debug-<start-time>.jsonl and writes one line per call', async () => {
    const { fs, files } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    expect(base(log.path)).toBe('debug-2026-10-10T12-30-45.jsonl');
    log.write('{"a":1}');
    log.write('{"b":2}');
    await log.close();
    expect(files.get('debug-2026-10-10T12-30-45.jsonl')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('keeps at most 5 debug files, deleting the oldest, and leaves other files alone', async () => {
    const old = ['debug-2026-10-01T00-00-00.jsonl', 'debug-2026-10-02T00-00-00.jsonl', 'debug-2026-10-03T00-00-00.jsonl', 'debug-2026-10-04T00-00-00.jsonl', 'debug-2026-10-05T00-00-00.jsonl', 'debug-2026-10-06T00-00-00.jsonl'];
    const { fs, files } = fakeFs([...old, 'notes.txt']);
    await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    const debugFiles = [...files.keys()].filter((n) => n.startsWith('debug-'));
    expect(debugFiles).toHaveLength(5);
    expect(debugFiles).not.toContain('debug-2026-10-01T00-00-00.jsonl');
    expect(debugFiles).not.toContain('debug-2026-10-02T00-00-00.jsonl');
    expect(debugFiles).toContain('debug-2026-10-03T00-00-00.jsonl');
    expect(files.has('notes.txt')).toBe(true);
  });

  it('stops at its size limit with one truncated marker, then drops everything', async () => {
    const { fs, files } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at, maxBytes: 40 }).open();
    log.write('x'.repeat(30));
    expect(log.truncated()).toBe(false);
    log.write('y'.repeat(30));
    log.write('z'.repeat(30));
    await log.close();
    expect(log.truncated()).toBe(true);
    const lines = files.get('debug-2026-10-10T12-30-45.jsonl')!.trim().split('\n');
    expect(lines[0]).toBe('x'.repeat(30));
    expect(JSON.parse(lines[1]!)).toMatchObject({ category: 'log', name: 'truncated' });
    expect(lines).toHaveLength(2);
  });

  it('counts a failed write and never throws', async () => {
    const { fs, failAppends } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    failAppends();
    expect(() => log.write('{"a":1}')).not.toThrow();
    await log.close();
    expect(log.failures()).toBe(1);
  });
});
