import { z } from 'zod';
import type { QuestAggregate, Snapshot } from '../../core/model/aggregate';
import type { FidelityReport } from '../../core/roundtrip/verify';
import { TOOL_VERSION } from '../../core/version';
import type { Viewport } from '../../shared/ipc';

/**
 * The project file: everything one piece of work needs, in a single JSON document the user saves,
 * moves and shares. The local store holds none of it; the open project lives in memory until saved.
 */

export const PROJECT_FORMAT = 'acore-quest-creator/project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'aqc';
export const DEFAULT_PROJECT_NAME = 'Untitled Project';
export const DEFAULT_ID_RANGE = { start: 60000, end: 99999 } as const;

/** One quest on the canvas: its edits, the rows it was imported from, and where it sits. */
export interface ProjectQuest {
  questId: number;
  isNew: boolean;
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  fidelity: FidelityReport | null;
  x: number;
  y: number;
  lastExportPath: string | null;
}

export interface ProjectMeta {
  name: string;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
  viewport: Viewport;
}

export interface ProjectDocument extends ProjectMeta {
  quests: ProjectQuest[];
}

/** The file system as the project code needs it, injected so tests run without a disk. */
export interface ProjectFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Resolves when the file is already gone. */
  remove(path: string): Promise<void>;
  /** File names; `[]` when the directory is missing. */
  listDir(path: string): Promise<string[]>;
  ensureDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type ProjectFileReason = 'not-a-project' | 'newer-version' | 'corrupt' | 'unreadable';

/** A project (or recovery) file that cannot be opened; `reason` says which way it failed. */
export class ProjectFileError extends Error {
  readonly reason: ProjectFileReason;
  constructor(reason: ProjectFileReason, message: string) {
    super(message);
    this.name = 'ProjectFileError';
    this.reason = reason;
  }
}

export class SaveFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFailedError';
  }
}

export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNameError';
  }
}

export function defaultProjectMeta(name: string, outputDir: string): ProjectMeta {
  return {
    name,
    idRangeStart: DEFAULT_ID_RANGE.start,
    idRangeEnd: DEFAULT_ID_RANGE.end,
    outputDir,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * Keys are written in a fixed order and quests by id, so saving the same project twice gives the
 * same bytes and a project kept in git diffs by what actually changed.
 */
export function serializeProject(doc: ProjectDocument): string {
  const quests = [...doc.quests]
    .sort((a, b) => a.questId - b.questId)
    .map((q) => ({
      questId: q.questId,
      isNew: q.isNew,
      x: q.x,
      y: q.y,
      lastExportPath: q.lastExportPath,
      fidelity: q.fidelity,
      snapshot: q.snapshot,
      aggregate: q.aggregate,
    }));
  const file = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    toolVersion: TOOL_VERSION,
    name: doc.name,
    idRange: { start: doc.idRangeStart, end: doc.idRangeEnd },
    outputDir: doc.outputDir,
    viewport: { x: doc.viewport.x, y: doc.viewport.y, zoom: doc.viewport.zoom },
    quests,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// `z.number()` already refuses NaN and Infinity, so every number below is finite.
const aggregateSchema = z.looseObject({
  questId: z.number(),
  isNew: z.boolean(),
  values: z.record(z.string(), z.unknown()),
  readOnly: z.array(z.unknown()),
  sharedItems: z.record(z.string(), z.array(z.number())),
});

const snapshotSchema = z.looseObject({
  questId: z.number(),
  tables: z.record(z.string(), z.unknown()),
  columnsRead: z.record(z.string(), z.unknown()),
  linkedContext: z.record(z.string(), z.unknown()),
  schemaHash: z.string(),
});

const fileSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.number().int(),
  toolVersion: z.string(),
  name: z.string(),
  idRange: z.object({ start: z.number().int(), end: z.number().int() }),
  outputDir: z.string(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  quests: z.array(
    z.object({
      questId: z.number().int(),
      isNew: z.boolean(),
      x: z.number(),
      y: z.number(),
      lastExportPath: z.string().nullable(),
      fidelity: z.looseObject({ ok: z.boolean() }).nullable(),
      snapshot: snapshotSchema.nullable(),
      aggregate: aggregateSchema,
    }),
  ),
});

const NOT_A_PROJECT = 'This file is not an ACORE Quest Creator project.';

export function parseProject(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('not-a-project', NOT_A_PROJECT);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || (raw as { format?: unknown }).format !== PROJECT_FORMAT) {
    throw new ProjectFileError('not-a-project', NOT_A_PROJECT);
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version === 'number' && version > PROJECT_VERSION) {
    throw new ProjectFileError(
      'newer-version',
      `This project was saved by a newer version of the tool (format version ${version}). Update the tool to open it.`,
    );
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.join('.') : '';
    throw new ProjectFileError('corrupt', `The project file is damaged at ${path}: ${issue?.message ?? 'invalid'}`);
  }
  const f = parsed.data;
  return {
    name: f.name,
    idRangeStart: f.idRange.start,
    idRangeEnd: f.idRange.end,
    outputDir: f.outputDir,
    viewport: f.viewport,
    quests: f.quests.map((q) => ({
      questId: q.questId,
      isNew: q.isNew,
      aggregate: q.aggregate as unknown as QuestAggregate,
      snapshot: q.snapshot as unknown as Snapshot | null,
      fidelity: q.fidelity as unknown as FidelityReport | null,
      x: q.x,
      y: q.y,
      lastExportPath: q.lastExportPath,
    })),
  };
}

/** Writes beside the target and renames over it, so a failure never leaves a half-written file. */
export async function writeFileAtomic(fs: ProjectFs, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, text);
  try {
    await fs.rename(tmp, path);
  } catch (error) {
    await fs.remove(tmp);
    throw error;
  }
}
