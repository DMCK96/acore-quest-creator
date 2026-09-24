import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { asc, desc, eq, notInArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { ProfileInput, ProfileRecord, ProfileSave } from '../../shared/ipc';
import { connectionProfiles, recentProjects } from './schema';

// The records the renderer sees are the IPC types; the store is where they are kept.
export type { ProfileInput, ProfileRecord, ProfileSave };

/**
 * The local store holds per-machine settings only: connection profiles (their passwords are
 * encrypted with this machine's key, so they could never travel in a project file) and the list of
 * recently used project files. Project work lives in those files, never here.
 */

export interface SecretBox {
  encrypt(plain: string): Uint8Array;
  decrypt(blob: Uint8Array): string;
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
}

export interface Store {
  profiles: {
    /** Updating a profile (`id` given) without a password keeps the one already stored. */
    save(input: ProfileSave): ProfileRecord;
    list(): ProfileRecord[];
    getWithPassword(id: number): ProfileInput & { id: number };
    remove(id: number): void;
    /** Records a successful connect; saving the profile again leaves the time alone. */
    markConnected(id: number, at: Date): void;
  };
  recent: {
    /** Records a project file as just opened or saved; an existing entry moves to the top. */
    touch(path: string, name: string, at: Date): void;
    /** Newest first. */
    list(): RecentEntry[];
    forget(path: string): void;
  };
  close(): void;
}

export const RECENT_LIMIT = 10;

/** The repo's `drizzle` directory, resolved from this module's location (src/main/store -> repo root). */
const defaultMigrationsFolder = (): string => fileURLToPath(new URL('../../../drizzle', import.meta.url));

type ProfileRow = typeof connectionProfiles.$inferSelect;

const toProfile = (r: ProfileRow): ProfileRecord => ({
  id: r.id,
  name: r.name,
  role: r.role,
  host: r.host,
  port: r.port,
  user: r.user,
  database: r.database,
  dbcDir: r.dbcDir,
  clientDir: r.clientDir,
  lastConnectedAt: r.lastConnectedAt ?? null,
});

export function openStore(path: string, secrets: SecretBox, migrationsFolder: string = defaultMigrationsFolder()): Store {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

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
      markConnected(id, at) {
        db.update(connectionProfiles).set({ lastConnectedAt: at.toISOString() }).where(eq(connectionProfiles.id, id)).run();
      },
    },
    recent: {
      touch(path, name, at) {
        sqlite.transaction(() => {
          const openedAt = at.toISOString();
          db.insert(recentProjects)
            .values({ path, name, openedAt })
            .onConflictDoUpdate({ target: recentProjects.path, set: { name, openedAt } })
            .run();
          const keep = db
            .select({ path: recentProjects.path })
            .from(recentProjects)
            .orderBy(desc(recentProjects.openedAt))
            .limit(RECENT_LIMIT)
            .all()
            .map((r) => r.path);
          db.delete(recentProjects).where(notInArray(recentProjects.path, keep)).run();
        })();
      },
      list: () => db.select().from(recentProjects).orderBy(desc(recentProjects.openedAt)).all(),
      forget(path) {
        db.delete(recentProjects).where(eq(recentProjects.path, path)).run();
      },
    },
    close: () => {
      sqlite.close();
    },
  };
}
