import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTrackerClient, trackerBase, TrackerError, DEFAULT_TRACKER_URL } from '../../src/main/tracker-client';

const fixture = (n: number) => JSON.parse(readFileSync(`tests/fixtures/candidates/p${n}.json`, 'utf8'));
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('tracker client', () => {
  it('only talks to a local tracker', () => {
    expect(trackerBase('')).toBe(DEFAULT_TRACKER_URL);
    expect(trackerBase('http://localhost:9000/')).toBe('http://localhost:9000');
    expect(() => trackerBase('http://192.168.1.5:8089')).toThrow(TrackerError);
    expect(() => trackerBase('https://127.0.0.1:8089')).toThrow('Use a local address: http://127.0.0.1:<port> or http://localhost:<port>.');
  });
  it('lists candidates with the query in the URL', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { total: 1, rows: [{ key: 1209, title: 'Windroc Remastery I', status: 'Ready', tier: 2, tier_label: '2 Giver+ender placeable', top_blocker: '', giver: 'npc 18200', ender: 'npc 18200', work: 'none', changed: 'x' }] }));
    const list = await createTrackerClient(DEFAULT_TRACKER_URL, fetchImpl as never).list({ q: 'wind', status: 'Ready', depsOnly: true, page: 2 });
    expect(list.rows[0]!.key).toBe(1209);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('http://127.0.0.1:8089/api/candidates?kind=quest&q=wind&status=Ready&deps_only=1&page=2');
  });
  it('reads real payloads', async () => {
    for (const n of [1209, 1215, 1224, 28394]) {
      const client = createTrackerClient(DEFAULT_TRACKER_URL, (async () => reply(200, fixture(n))) as never);
      expect((await client.payload(n)).format).toBe('acqc-candidate/1');
    }
  });
  it('refuses a payload format it does not know', async () => {
    const client = createTrackerClient(DEFAULT_TRACKER_URL, (async () => reply(200, { ...fixture(1209), format: 'acqc-candidate/2' })) as never);
    await expect(client.payload(1209)).rejects.toThrow('This tracker is newer than the app understands (format acqc-candidate/2).');
  });
  it('says when the tracker is not running, and passes HTTP errors on', async () => {
    const down = createTrackerClient(DEFAULT_TRACKER_URL, (async () => { throw new TypeError('fetch failed'); }) as never);
    await expect(down.list({})).rejects.toThrow("The CoA Content Tracker isn't running at http://127.0.0.1:8089. Start it with python tracker.py.");
    const bad = createTrackerClient(DEFAULT_TRACKER_URL, (async () => reply(404, { error: 'not found' })) as never);
    await expect(bad.payload(5)).rejects.toThrow('The tracker answered 404: {"error":"not found"}');
  });
  it('sets work with the Origin header the tracker checks', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { ok: true }));
    await createTrackerClient(DEFAULT_TRACKER_URL, fetchImpl as never).setWork(1209, 'in_progress', 'Imported into P');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8089/api/candidates/work');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Origin).toBe('http://127.0.0.1:8089');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'quest', key: 1209, state: 'in_progress', notes: 'Imported into P' });
  });
});

describe('tracker client redirects', () => {
  it('never follows a redirect away from the local tracker', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { total: 0, rows: [] }));
    await createTrackerClient(DEFAULT_TRACKER_URL, fetchImpl as never).list({});
    expect(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).redirect).toBe('error');
  });
});
