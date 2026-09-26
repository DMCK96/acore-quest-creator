import type { z } from 'zod';
import {
  CANDIDATE_FORMAT,
  candidateListSchema,
  candidatePayloadSchema,
  workStateSchema,
  type CandidateList,
  type CandidatePayload,
  type CandidateQuery,
  type WorkState,
} from '../shared/candidate';

/**
 * The CoA Content Tracker's candidate API, read from the main process. The tracker only ever runs
 * on this machine (it listens on 127.0.0.1 and has no public mode), so any other address is refused
 * before a request is made.
 */

export const DEFAULT_TRACKER_URL = 'http://127.0.0.1:8089';
const LIST_TIMEOUT_MS = 10_000;
const PAYLOAD_TIMEOUT_MS = 30_000;
const BODY_LIMIT = 200;
const LOCAL_ONLY = 'Use a local address: http://127.0.0.1:<port> or http://localhost:<port>.';

export class TrackerError extends Error {}

/** The tracker's origin, or a `TrackerError` when the address is not on this machine. */
export function trackerBase(raw: string): string {
  const text = raw.trim();
  if (text === '') return DEFAULT_TRACKER_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TrackerError(LOCAL_ONLY);
  }
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) throw new TrackerError(LOCAL_ONLY);
  return url.origin;
}

export interface TrackerClient {
  list(query: CandidateQuery): Promise<CandidateList>;
  payload(questId: number): Promise<CandidatePayload>;
  work(questId: number): Promise<WorkState>;
  setWork(questId: number, state: string, notes: string): Promise<void>;
}

export function createTrackerClient(baseUrl: string, fetchImpl: typeof fetch = fetch): TrackerClient {
  const base = trackerBase(baseUrl);
  const notRunning = `The CoA Content Tracker isn't running at ${base}. Start it with python tracker.py.`;

  async function request(path: string, timeoutMs: number, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new TrackerError(notRunning);
    }
    const body = await response.text();
    if (!response.ok) throw new TrackerError(`The tracker answered ${response.status}: ${body.slice(0, BODY_LIMIT)}`);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new TrackerError(`The tracker sent something the app cannot read: ${body.slice(0, BODY_LIMIT)}`);
    }
  }

  function parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0]!;
    throw new TrackerError(`The tracker sent something the app cannot read: ${issue.path.join('.') || '(top)'} ${issue.message}`);
  }

  return {
    async list(query) {
      const params = new URLSearchParams({ kind: 'quest' });
      if (query.q) params.set('q', query.q);
      if (query.status) params.set('status', query.status);
      if (query.tier !== undefined) params.set('tier', String(query.tier));
      if (query.work) params.set('work', query.work);
      if (query.depsOnly) params.set('deps_only', '1');
      if (query.page !== undefined) params.set('page', String(query.page));
      return parse(candidateListSchema, await request(`/api/candidates?${params}`, LIST_TIMEOUT_MS));
    },
    async payload(questId) {
      const data = await request(`/api/candidates/payload?quest=${questId}`, PAYLOAD_TIMEOUT_MS);
      // Checked first, so a newer tracker says so instead of failing on whichever field changed.
      const format = typeof data === 'object' && data !== null ? (data as { format?: unknown }).format : undefined;
      if (format !== CANDIDATE_FORMAT) throw new TrackerError(`This tracker is newer than the app understands (format ${String(format)}).`);
      return parse(candidatePayloadSchema, data);
    },
    async work(questId) {
      const data = await request(`/api/candidate?kind=quest&key=${questId}`, LIST_TIMEOUT_MS);
      return parse(workStateSchema, (data as { work?: unknown } | null)?.work);
    },
    async setWork(questId, state, notes) {
      // The tracker takes writes only from its own origin, with a JSON body.
      await request('/api/candidates/work', LIST_TIMEOUT_MS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ kind: 'quest', key: questId, state, notes }),
      });
    },
  };
}
