import { vi } from 'vitest';
import type { Api, ApiError, CanvasNode, ErrorCode, OpenResult, Result } from '@shared/ipc';

export function okv<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function errv(code: ErrorCode, message: string): Result<never> {
  const error: ApiError = { code, message };
  return { ok: false, error };
}

export function sampleOpen(overrides: Partial<OpenResult> = {}): OpenResult {
  const base: OpenResult = {
    questId: 60001,
    aggregate: {
      questId: 60001,
      isNew: false,
      values: { 'quest_template.LogTitle': 'Wolves' },
      readOnly: [],
      sharedItems: {},
    },
    fidelity: { ok: true },
    unmodelled: [],
    issues: [],
    hasDraft: false,
    stale: false,
  };
  return { ...base, ...overrides };
}

export function nodeOf(overrides: Partial<CanvasNode> = {}): CanvasNode {
  const base: CanvasNode = {
    questId: 60001,
    title: 'Wolves',
    level: 10,
    isNew: false,
    exported: false,
    unsafe: false,
    errors: 0,
    warnings: 0,
    x: 0,
    y: 0,
  };
  return { ...base, ...overrides };
}

/**
 * Builds a mock `Api` where every method not overridden is a `vi.fn` answering with a sensible
 * empty success, so tests can assert on calls without wiring every method by hand.
 */
export function makeMockApi(overrides: Partial<Record<keyof Api, (...args: any[]) => any>> = {}): Api {
  const defaults: Record<keyof Api, (...args: any[]) => any> = {
    testConnection: vi.fn(async () => okv({ ok: true as const })),
    saveProfile: vi.fn(async () => okv({ id: 1, name: '', role: 'world', host: '', port: 3306, user: '', database: '' })),
    listProfiles: vi.fn(async () => okv([])),
    connect: vi.fn(async () => okv({ profileId: 1, schemaHash: '', drift: { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] }, blocking: false })),
    searchQuests: vi.fn(async () => okv([])),
    openQuest: vi.fn(async () => okv(sampleOpen())),
    newQuest: vi.fn(async () => okv(sampleOpen())),
    listNodes: vi.fn(async () => okv([])),
    moveNodes: vi.fn(async () => okv(true as const)),
    removeNode: vi.fn(async () => okv(true as const)),
    saveViewport: vi.fn(async () => okv(true as const)),
    lookupNames: vi.fn(async () => okv({})),
    rewardTables: vi.fn(async () => okv({ xp: [], money: [] })),
    saveDraft: vi.fn(async () => okv({ updatedAt: new Date(0).toISOString() })),
    previewChanges: vi.fn(async () => okv([])),
    validate: vi.fn(async () => okv([])),
    exportQuest: vi.fn(async () => okv({ path: '', sql: '', warnings: [], issues: [] })),
    applyToDev: vi.fn(async () => okv({ statements: 0 })),
    getProject: vi.fn(async () => okv({ id: 1, name: 'Default project', idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } })),
    updateProject: vi.fn(async () => okv({ id: 1, name: '', idRangeStart: 60000, idRangeEnd: 99999, outputDir: '', viewport: { x: 0, y: 0, zoom: 1 } })),
  };

  const wrapped = Object.fromEntries(
    Object.entries(overrides).map(([key, fn]) => [key, vi.fn(fn)]),
  ) as Partial<Record<keyof Api, (...args: any[]) => any>>;

  const merged = { ...defaults, ...wrapped } as unknown as Api;
  return merged;
}
