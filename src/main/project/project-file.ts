import { z } from 'zod';
import type { QuestAggregate, Snapshot } from '../../core/model/aggregate';
import type { FidelityReport } from '../../core/roundtrip/verify';
import { TOOL_VERSION } from '../../core/version';
import { migrateQuestEntities } from '../../core/entities/migrate';
import { EMPTY_ENTITIES, readProjectEntities, type ProjectEntities } from '../../core/entities/model';
import { EMPTY_WORLD, groupsOf, movementsOf, respawnsOf, type Placement, type RoutePoint, type WorldLayer } from '../../core/world/layer';
import type { GroupMember, SpawnGroup } from '../../core/world/groups';
import type { Movement } from '../../core/world/movement';
import type { Viewport } from '../../shared/ipc';

/**
 * The project file: everything one piece of work needs, in a single JSON document the user saves,
 * moves and shares. The local store holds none of it; the open project lives in memory until saved.
 */

export const PROJECT_FORMAT = 'acore-quest-creator/project';
/**
 * 2 added the world layer (a version 1 file opens with an empty one); 3 added the spawns placed in it;
 * 4 moved new NPCs, objects and items from quests into the project (older files move them on open);
 * 5 added respawn times, spawn groups and route walkers to the world layer (an older tool would drop
 * them on a save, so it refuses the file instead).
 */
export const PROJECT_VERSION = 5;
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
  /** Edits to spawns and routes that are not part of any quest. */
  world: WorldLayer;
  /** The project's new NPCs, objects and items. */
  entities: ProjectEntities;
  /** What moving an older project's quest entities into the store had to say; set only by `parseProject` */
  migrationWarnings?: string[];
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

const placement = (p: Placement) => ({ x: p.x, y: p.y, z: p.z, orientation: p.orientation, rotation: p.rotation });
const movement = (m: Movement) => ({ type: m.type, wander: m.wander, pathId: m.pathId });
const point = (p: RoutePoint) => ({ x: p.x, y: p.y, z: p.z, rest: p.rest });
const member = (m: GroupMember) =>
  m.type === 'group' ? { type: m.type, id: m.id, chance: m.chance } : { type: m.type, kind: m.kind, guid: m.guid, entry: m.entry, chance: m.chance };
const group = (g: SpawnGroup) => ({
  id: g.id, name: g.name, map: g.map, maxActive: g.maxActive, members: g.members.map(member),
  origin: g.origin.kind === 'new'
    ? { kind: g.origin.kind }
    : { kind: g.origin.kind, original: { template: g.origin.original.template, members: g.origin.original.members.map((m) => ({ table: m.table, row: m.row })), event: g.origin.original.event } },
  ...(g.removed ? { removed: true } : {}),
});

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
    world: {
      spawns: doc.world.spawns.map((s) => ({
        kind: s.kind, guid: s.guid, entry: s.entry, name: s.name, map: s.map, original: placement(s.original), current: placement(s.current),
      })),
      routes: doc.world.routes.map((r) => ({
        pathId: r.pathId, walkers: r.walkers, ...(r.name ? { name: r.name } : {}),
        ...(r.walkerEntries ? { walkerEntries: r.walkerEntries.map((w) => ({ entry: w.entry, name: w.name })) } : {}),
        original: r.original.map(point), current: r.current.map(point),
      })),
      added: doc.world.added.map((a) => ({
        kind: a.kind, guid: a.guid, entry: a.entry, name: a.name, map: a.map, placement: placement(a.placement),
        look: { displayId: a.look.displayId, scale: a.look.scale, equipment: a.look.equipment, preset: a.look.preset, ...(a.look.objectType !== undefined ? { objectType: a.look.objectType } : {}) },
        ...(a.respawnSecs !== undefined ? { respawnSecs: a.respawnSecs } : {}),
      })),
      // Left out while there are none, so a project with no movement edits saves as it did before
      ...(movementsOf(doc.world).length > 0
        ? {
            movements: movementsOf(doc.world).map((m) => ({
              guid: m.guid, entry: m.entry, name: m.name, map: m.map, addonRow: m.addonRow,
              ...(m.addonSeed ? { addonSeed: m.addonSeed } : {}),
              ...(m.originalRaw ? { originalRaw: { wander: m.originalRaw.wander, type: m.originalRaw.type } } : {}),
              original: movement(m.original), current: movement(m.current),
            })),
          }
        : {}),
      // Left out while there are none, like movements
      ...(respawnsOf(doc.world).length > 0
        ? {
            respawns: respawnsOf(doc.world).map((r) => ({
              kind: r.kind, guid: r.guid, entry: r.entry, name: r.name, map: r.map, original: r.original, current: r.current,
            })),
          }
        : {}),
      ...(groupsOf(doc.world).length > 0 ? { groups: groupsOf(doc.world).map(group) } : {}),
    },
    entities: doc.entities,
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

const placementSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  orientation: z.number(),
  rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});
const pointSchema = z.object({ x: z.number(), y: z.number(), z: z.number(), rest: z.record(z.string(), z.string().nullable()) });
const presetSchema = z.object({
  race: z.number(),
  sex: z.number(),
  skin: z.number(),
  face: z.number(),
  hairStyle: z.number(),
  hairColour: z.number(),
  facialHair: z.number(),
  items: z.object({
    head: z.number(), shoulders: z.number(), body: z.number(), chest: z.number(), waist: z.number(), legs: z.number(),
    feet: z.number(), wrists: z.number(), hands: z.number(), back: z.number(), tabard: z.number(),
  }),
});
const movementSchema = z.object({ type: z.enum(['idle', 'wander', 'path']), wander: z.number(), pathId: z.number().int().nullable() });
const rowSchema = z.record(z.string(), z.string().nullable());
const groupMemberSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spawn'), kind: z.enum(['npc', 'object']), guid: z.number().int(), entry: z.number().int(), chance: z.number() }),
  z.object({ type: z.literal('group'), id: z.number().int(), chance: z.number() }),
]);
const groupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  map: z.number().int(),
  maxActive: z.number().int(),
  members: z.array(groupMemberSchema),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new') }),
    z.object({
      kind: z.literal('existing'),
      original: z.object({
        template: rowSchema,
        members: z.array(z.object({ table: z.enum(['pool_creature', 'pool_gameobject', 'pool_pool']), row: rowSchema })),
        event: rowSchema.nullable(),
      }),
    }),
  ]),
  removed: z.boolean().optional(),
});
const worldSchema = z.object({
  spawns: z.array(
    z.object({
      kind: z.enum(['creature', 'gameobject']),
      guid: z.number().int(),
      entry: z.number().int(),
      name: z.string(),
      map: z.number().int(),
      original: placementSchema,
      current: placementSchema,
    }),
  ),
  routes: z.array(
    z.object({
      pathId: z.number().int(),
      walkers: z.number().int(),
      name: z.string().optional(),
      // Absent from a project saved before the walkers' NPCs were kept
      walkerEntries: z.array(z.object({ entry: z.number().int(), name: z.string() })).optional(),
      original: z.array(pointSchema),
      current: z.array(pointSchema),
    }),
  ),
  // Absent from a project saved before spawns could be placed
  added: z
    .array(
      z.object({
        kind: z.enum(['creature', 'gameobject']),
        guid: z.number().int(),
        entry: z.number().int(),
        name: z.string(),
        map: z.number().int(),
        placement: placementSchema,
        look: z.object({
          displayId: z.number(),
          scale: z.number(),
          equipment: z.tuple([z.number(), z.number(), z.number()]),
          preset: presetSchema.nullable(),
          // Absent for an NPC, and from a project saved before an object's type was kept
          objectType: z.number().int().optional(),
        }),
        // Absent from a project saved before a placed spawn's respawn time could be set
        respawnSecs: z.number().int().optional(),
      }),
    )
    .default([]),
  // Absent from a project saved before an NPC's movement could be changed
  movements: z
    .array(
      z.object({
        guid: z.number().int(),
        entry: z.number().int(),
        name: z.string(),
        map: z.number().int(),
        addonRow: z.boolean(),
        addonSeed: z.record(z.string(), z.string().nullable()).optional(),
        originalRaw: z.object({ wander: z.number(), type: z.number() }).optional(),
        original: movementSchema,
        current: movementSchema,
      }),
    )
    .optional(),
  // Absent from a project saved before respawn times could be changed
  respawns: z
    .array(
      z.object({
        kind: z.enum(['creature', 'gameobject']),
        guid: z.number().int(),
        entry: z.number().int(),
        name: z.string(),
        map: z.number().int(),
        original: z.number().int(),
        current: z.number().int(),
      }),
    )
    .optional(),
  // Absent from a project saved before spawns could be grouped
  groups: z.array(groupSchema).optional(),
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
  world: worldSchema.optional(),
  // Absent before version 4, whose quests carry their own; checked entry by entry when read
  entities: z.unknown().optional(),
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
  const quests = f.quests.map((q) => ({
    questId: q.questId,
    isNew: q.isNew,
    aggregate: q.aggregate as unknown as QuestAggregate,
    snapshot: q.snapshot as unknown as Snapshot | null,
    fidelity: q.fidelity as unknown as FidelityReport | null,
    x: q.x,
    y: q.y,
    lastExportPath: q.lastExportPath,
  }));
  const moved = f.version < 4 ? migrateQuestEntities(quests) : null;
  return {
    name: f.name,
    idRangeStart: f.idRange.start,
    idRangeEnd: f.idRange.end,
    outputDir: f.outputDir,
    viewport: f.viewport,
    quests: moved ? moved.quests : quests,
    world: f.world ?? structuredClone(EMPTY_WORLD),
    entities: moved ? moved.entities : f.entities === undefined ? structuredClone(EMPTY_ENTITIES) : readProjectEntities(f.entities),
    ...(moved ? { migrationWarnings: moved.warnings } : {}),
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
