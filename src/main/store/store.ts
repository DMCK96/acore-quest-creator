import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { QuestAggregate, Snapshot } from '../../core/model/aggregate';
import type { FidelityReport } from '../../core/roundtrip/verify';
import type { ProfileInput, ProfileRecord, ProfileSave, Viewport } from '../../shared/ipc';

/** The single implicit project the store kept before project files; removed with the drafts table. */
export interface Project {
  id: number;
  name: string;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
  viewport: Viewport;
}
import { connectionProfiles, drafts, projects } from './schema';

// The records the renderer sees are the IPC types; the store is where they are kept.
export type { ProfileInput, ProfileRecord, ProfileSave, Viewport };

export interface SecretBox {
  encrypt(plain: string): Uint8Array;
  decrypt(blob: Uint8Array): string;
}

export interface DraftRecord {
  id: number;
  projectId: number;
  questId: number;
  isNew: boolean;
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  fidelity: FidelityReport | null;
  x: number;
  y: number;
  updatedAt: string;
  lastExportPath: string | null;
}

export interface DraftInput {
  projectId: number;
  questId: number;
  isNew: boolean;
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  fidelity: FidelityReport | null;
  x?: number;
  y?: number;
}

export interface Store {
  profiles: {
    /** Updating a profile (`id` given) without a password keeps the one already stored. */
    save(input: ProfileSave): ProfileRecord;
    list(): ProfileRecord[];
    getWithPassword(id: number): ProfileInput & { id: number };
    remove(id: number): void;
  };
  projects: {
    ensureDefault(outputDir: string): Project;
    get(id: number): Project;
    update(p: Project): Project;
  };
  drafts: {
    save(input: DraftInput): DraftRecord;
    get(projectId: number, questId: number): DraftRecord | undefined;
    list(projectId: number): DraftRecord[];
    remove(projectId: number, questId: number): void;
    markExported(projectId: number, questId: number, path: string): void;
    usedQuestIds(projectId: number): number[];
    setPositions(projectId: number, moves: readonly { questId: number; x: number; y: number }[]): void;
  };
  close(): void;
}

export const DEFAULT_ID_RANGE = { start: 60000, end: 99999 } as const;

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** The repo's `drizzle` directory, resolved from this module's location (src/main/store -> repo root). */
const defaultMigrationsFolder = (): string => fileURLToPath(new URL('../../../drizzle', import.meta.url));

type ProfileRow = typeof connectionProfiles.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type DraftRow = typeof drafts.$inferSelect;

const toProfile = (r: ProfileRow): ProfileRecord => ({
  id: r.id,
  name: r.name,
  role: r.role,
  host: r.host,
  port: r.port,
  user: r.user,
  database: r.database,
});

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  idRangeStart: r.idRangeStart,
  idRangeEnd: r.idRangeEnd,
  outputDir: r.outputDir,
  viewport: JSON.parse(r.viewport) as Viewport,
});

const toDraft = (r: DraftRow): DraftRecord => ({
  id: r.id,
  projectId: r.projectId,
  questId: r.questId,
  isNew: r.isNew,
  aggregate: JSON.parse(r.aggregate) as QuestAggregate,
  snapshot: r.snapshot === null ? null : (JSON.parse(r.snapshot) as Snapshot),
  fidelity: r.fidelity === null ? null : (JSON.parse(r.fidelity) as FidelityReport),
  x: r.x,
  y: r.y,
  updatedAt: r.updatedAt,
  lastExportPath: r.lastExportPath,
});

export function openStore(path: string, secrets: SecretBox, migrationsFolder: string = defaultMigrationsFolder()): Store {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  const draftKey = (projectId: number, questId: number) => and(eq(drafts.projectId, projectId), eq(drafts.questId, questId));
  const getDraft = (projectId: number, questId: number): DraftRecord | undefined => {
    const row = db.select().from(drafts).where(draftKey(projectId, questId)).get();
    return row ? toDraft(row) : undefined;
  };
  const getProject = (id: number): Project => {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new Error(`Project ${id} does not exist`);
    return toProject(row);
  };
  const getProfile = (id: number): ProfileRow => {
    const row = db.select().from(connectionProfiles).where(eq(connectionProfiles.id, id)).get();
    if (!row) throw new Error(`Connection profile ${id} does not exist`);
    return row;
  };

  return {
    profiles: {
      save({ id, password, ...rest }) {
        if (id === undefined) {
          if (password === undefined) throw new Error('A new connection profile needs a password');
          const values = { ...rest, passwordEnc: Buffer.from(secrets.encrypt(password)) };
          return toProfile(db.insert(connectionProfiles).values(values).returning().get());
        }
        const values = password === undefined ? rest : { ...rest, passwordEnc: Buffer.from(secrets.encrypt(password)) };
        const row = db.update(connectionProfiles).set(values).where(eq(connectionProfiles.id, id)).returning().get();
        if (!row) throw new Error(`Connection profile ${id} does not exist`);
        return toProfile(row);
      },
      list: () => db.select().from(connectionProfiles).orderBy(asc(connectionProfiles.id)).all().map(toProfile),
      getWithPassword(id) {
        const row = getProfile(id);
        return { ...toProfile(row), password: secrets.decrypt(row.passwordEnc) };
      },
      remove(id) {
        db.delete(connectionProfiles).where(eq(connectionProfiles.id, id)).run();
      },
    },
    projects: {
      ensureDefault(outputDir) {
        const existing = db.select().from(projects).orderBy(asc(projects.id)).limit(1).get();
        if (existing) return toProject(existing);
        return toProject(
          db
            .insert(projects)
            .values({
              name: 'Default project',
              idRangeStart: DEFAULT_ID_RANGE.start,
              idRangeEnd: DEFAULT_ID_RANGE.end,
              outputDir,
              viewport: JSON.stringify(DEFAULT_VIEWPORT),
            })
            .returning()
            .get(),
        );
      },
      get: getProject,
      update(p) {
        const row = db
          .update(projects)
          .set({
            name: p.name,
            idRangeStart: p.idRangeStart,
            idRangeEnd: p.idRangeEnd,
            outputDir: p.outputDir,
            viewport: JSON.stringify(p.viewport),
          })
          .where(eq(projects.id, p.id))
          .returning()
          .get();
        if (!row) throw new Error(`Project ${p.id} does not exist`);
        return toProject(row);
      },
    },
    drafts: {
      save(input) {
        const content = {
          isNew: input.isNew,
          aggregate: JSON.stringify(input.aggregate),
          snapshot: input.snapshot === null ? null : JSON.stringify(input.snapshot),
          fidelity: input.fidelity === null ? null : JSON.stringify(input.fidelity),
          updatedAt: new Date().toISOString(),
        };
        // A later save keeps the stored position unless x or y is given.
        const position = { ...(input.x !== undefined && { x: input.x }), ...(input.y !== undefined && { y: input.y }) };
        const row = db
          .insert(drafts)
          .values({ projectId: input.projectId, questId: input.questId, ...content, x: input.x ?? 0, y: input.y ?? 0 })
          .onConflictDoUpdate({ target: [drafts.projectId, drafts.questId], set: { ...content, ...position } })
          .returning()
          .get();
        return toDraft(row);
      },
      get: getDraft,
      list: (projectId) =>
        db.select().from(drafts).where(eq(drafts.projectId, projectId)).orderBy(asc(drafts.questId)).all().map(toDraft),
      remove(projectId, questId) {
        db.delete(drafts).where(draftKey(projectId, questId)).run();
      },
      markExported(projectId, questId, exportPath) {
        db.update(drafts).set({ lastExportPath: exportPath }).where(draftKey(projectId, questId)).run();
      },
      usedQuestIds: (projectId) =>
        db
          .select({ questId: drafts.questId })
          .from(drafts)
          .where(eq(drafts.projectId, projectId))
          .orderBy(asc(drafts.questId))
          .all()
          .map((r) => r.questId),
      setPositions(projectId, moves) {
        sqlite.transaction(() => {
          for (const m of moves) {
            db.update(drafts).set({ x: m.x, y: m.y }).where(draftKey(projectId, m.questId)).run();
          }
        })();
      },
    },
    close: () => {
      sqlite.close();
    },
  };
}
