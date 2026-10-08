import { describe, expect, it } from 'vitest';
import { invokeApi } from '../../src/main/api/invoke';
import type { Api } from '../../src/shared/ipc';

const fake = (over: Partial<Record<keyof Api, (...a: any[]) => any>>) => over as unknown as Api;

describe('invokeApi', () => {
  it('validates the arguments before the API sees them', async () => {
    let called = false;
    const api = fake({ searchQuests: async () => { called = true; return { ok: true, value: [] }; } });
    const out = await invokeApi(api, 'searchQuests', [42]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('BAD_REQUEST');
    expect(called).toBe(false);
  });

  it('passes parsed arguments and returns the API result', async () => {
    const api = fake({ searchQuests: async (text: string) => ({ ok: true, value: [{ id: 1, title: text, level: 1 }] }) });
    expect(await invokeApi(api, 'searchQuests', ['kobold'])).toEqual({ ok: true, value: [{ id: 1, title: 'kobold', level: 1 }] });
  });

  it('turns a thrown error into UNKNOWN instead of rejecting', async () => {
    const api = fake({ listNodes: async () => { throw new Error('boom'); } });
    const out = await invokeApi(api, 'listNodes', []);
    expect(out).toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'boom' } });
  });
});
