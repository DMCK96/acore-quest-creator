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
    inProject: false,
    stale: false,
    locales: [],
    importedText: {},
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
    links: [],
    starts: [],
    groups: [],
    offCanvasLinks: 0,
    notConnected: false,
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
    saveProfile: vi.fn(async () => okv({ id: 1, name: '', role: 'world', host: '', port: 3306, user: '', database: '', dbcDir: '' })),
    listProfiles: vi.fn(async () => okv([])),
    startupProfile: vi.fn(async () => okv(null)),
    chooseServerDataDir: vi.fn(async () => okv(null)),
    connect: vi.fn(async () => okv({ profileId: 1, schemaHash: '', drift: { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] }, blocking: false, serverData: null })),
    searchQuests: vi.fn(async () => okv([])),
    searchEntities: vi.fn(async () => okv([])),
    openQuest: vi.fn(async () => okv(sampleOpen())),
    newQuest: vi.fn(async () => okv(sampleOpen())),
    addQuestChain: vi.fn(async () => okv({ open: sampleOpen(), questIds: [sampleOpen().questId], truncated: false })),
    listNodes: vi.fn(async () => okv([])),
    moveNodes: vi.fn(async () => okv(true as const)),
    removeNode: vi.fn(async () => okv(true as const)),
    saveViewport: vi.fn(async () => okv(true as const)),
    lookupNames: vi.fn(async () => okv({})),
    questLinks: vi.fn(async () => okv({ instances: [], unrecognised: [], unavailable: [] })),
    rewardTables: vi.fn(async () => okv({ xp: [], money: [] })),
    updateQuest: vi.fn(async () => okv(true as const)),
    previewChanges: vi.fn(async () => okv([])),
    allocateIds: vi.fn(async () => okv([])),
    entityTemplate: vi.fn(async () => okv(null)),
    groundHeight: vi.fn(async () => okv({ reason: 'x' })),
    testCommands: vi.fn(async () => okv({ reload: [], restart: [], go: [], quest: [] })),
    questScripts: vi.fn(async () => okv({ foreign: [], unreadable: [], missingTables: [] })),
    validate: vi.fn(async () => okv([])),
    exportQuest: vi.fn(async () => okv({ path: '', sql: '', warnings: [], issues: [] })),
    applyToDev: vi.fn(async () => okv({ statements: 0 })),
    projectState: vi.fn(async () => okv({ name: 'Untitled Project', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } })),
    renameProject: vi.fn(async () => okv(true as const)),
    newProject: vi.fn(async () => okv({ done: true })),
    openProject: vi.fn(async () => okv({ done: true })),
    saveProject: vi.fn(async () => okv({ done: true })),
    saveProjectAs: vi.fn(async () => okv({ done: true })),
    recentProjects: vi.fn(async () => okv([])),
    forgetRecent: vi.fn(async () => okv(true as const)),
    recoveries: vi.fn(async () => okv([])),
    restoreRecovery: vi.fn(async () => okv(true as const)),
    discardRecovery: vi.fn(async () => okv(true as const)),
  };

  const wrapped = Object.fromEntries(
    Object.entries(overrides).map(([key, fn]) => [key, vi.fn(fn)]),
  ) as Partial<Record<keyof Api, (...args: any[]) => any>>;

  const merged = { ...defaults, ...wrapped } as unknown as Api;
  return merged;
}
