import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const deps = (debug?: any) => ({
  store: openStore(':memory:', box), openWorldDb: async () => { throw new Error('x'); }, openDevDb: async () => { throw new Error('x'); },
  fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
  session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController, debug,
});

describe('the debug API', () => {
  it('forwards each call to the controller and wraps the answer', async () => {
    const calls: string[] = [];
    const controller = {
      status: () => ({ enabled: true }),
      setEnabled: async (on: boolean) => { calls.push(`set ${on}`); return { enabled: on }; },
      events: () => [{ name: 'e' }],
      snapshot: async () => ({ rendererAnswered: false }),
      type: async (t: string) => ({ typed: t.length }),
      screenshot: async () => ({ width: 1 }),
      ingest: (b: unknown[]) => { calls.push(`ingest ${b.length}`); },
      answer: (id: number) => { calls.push(`answer ${id}`); },
    };
    const api = createApi(deps(controller));
    expect(await api.debugStatus()).toEqual({ ok: true, value: { enabled: true } });
    expect(await api.debugSetEnabled(true)).toEqual({ ok: true, value: { enabled: true } });
    expect(await api.debugEvents()).toEqual({ ok: true, value: [{ name: 'e' }] });
    expect(await api.debugType('ab')).toEqual({ ok: true, value: { typed: 2 } });
    expect(await api.debugRecord([{ at: 1, category: 'a', name: 'b' }])).toEqual({ ok: true, value: null });
    expect(await api.debugAnswer(7, { rect: null })).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['set true', 'ingest 1', 'answer 7']);
  });

  it('turns a controller failure into the error the window is sent', async () => {
    const { fail } = await import('../../src/main/api/errors');
    const api = createApi(deps({ snapshot: async () => { throw fail('NOT_ENABLED', 'Turn on Debug mode in Preferences first.'); } }));
    expect(await api.debugSnapshot()).toEqual({ ok: false, error: { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' } });
  });

  it('answers a plain error where the app has no debug controller', async () => {
    const out: any = await createApi(deps()).debugStatus();
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Debug mode is not available in this build.');
  });
});
