import { componentAvailability } from '../../core/links/availability';
import { CONTEXT_TABLES, readItemStarters } from '../../core/links/context';
import { registry } from '../../core/registry';
import { diffSchema, hasBlockingDrift } from '../../core/schema/diff';
import { loadSchema } from '../../core/schema/load';
import { SCRIPT_TABLES } from '../../core/scripts/context';
import { ENTITY_TABLES } from '../../core/entities/context';
import { loadServerData } from '../server-data';
import type { Api } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';
import { NO_SERVER_DATA_FILES } from './server-files';

const REGISTRY_TABLES = registry.tables.map((t) => t.table);

/** Connection profiles, and connecting to a world database */
export function createConnectionApi(s: Services): Pick<Api, 'testConnection' | 'saveProfile' | 'listProfiles' | 'deleteProfile' | 'startupProfile' | 'connect' | 'chooseServerDataDir'> {
  const { deps, conn } = s.ctx;

  return {
    testConnection: (input) =>
      run(async () => {
        const db = await deps.openWorldDb(input);
        await db.close();
        return { ok: true } as const;
      }),

    saveProfile: (input) => run(async () => deps.store.profiles.save(input)),

    listProfiles: () => run(async () => deps.store.profiles.list()),

    deleteProfile: (id) =>
      run(async () => {
        if (conn.current()?.profileId === id) throw fail('VALIDATION', 'This connection is in use. Connect with another before removing it.');
        deps.store.profiles.remove(id);
        return null;
      }),

    startupProfile: () => run(async () => deps.startupProfileId ?? null),

    connect: (profileId) =>
      run(async () => {
        const profile = deps.store.profiles.getWithPassword(profileId);
        const db = await deps.openWorldDb(profile);
        const dataDir = profile.dbcDir?.trim() || null;
        const clientDir = profile.clientDir?.trim() || null;
        const before = conn.folders();
        // Until the connect is confirmed, the old connection (and the map's folders with it) stays live.
        let reads;
        try {
          const schema = await loadSchema(db, REGISTRY_TABLES);
          const contextSchema = await loadSchema(db, CONTEXT_TABLES);
          // Where the context list and the registry share a table, the registry's reading is the one
          // the rest of the session already trusts, so it wins.
          const availability = componentAvailability({ ...contextSchema.tables, ...schema.tables });
          // Only asked of a table the schema read says this user can see, so a missing grant on
          // item_template leaves item starts empty instead of failing the whole connection.
          const itemStarters = contextSchema.tables.item_template?.some((c) => c.name === 'startquest')
            ? await readItemStarters(db)
            : [];
          const serverData = await loadServerData(profile.dbcDir ?? '', deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
          const scriptSchema = await loadSchema(db, [...new Set<string>([...SCRIPT_TABLES, ...ENTITY_TABLES])]);
          conn.setFolders({ dataDir, clientDir });
          const client = clientDir ? ((await deps.clientStatus?.()) ?? null) : null;
          reads = { schema, contextSchema, availability, itemStarters, serverData, scriptSchema, client };
        } catch (e) {
          if (conn.folders() !== before) conn.setFolders(before);
          if (conn.current()?.db !== db) await db.close().catch(() => undefined);
          throw e;
        }
        const { schema, contextSchema, availability, itemStarters, serverData, scriptSchema, client } = reads;
        const drift = diffSchema(schema, registry);
        const blocking = hasBlockingDrift(drift);
        // Swapping connections must not leave the old one open.
        const previous = conn.current();
        if (previous && previous.db !== db) await previous.db.close();
        conn.set({
          profileId,
          exportDir: profile.exportDir?.trim() || null,
          db,
          schema,
          blocking,
          blockingTables: drift.blockingTables,
          forbiddenTables: drift.forbiddenTables,
          contextTables: contextSchema.tables,
          availability,
          itemStarters,
          serverData,
          scriptSchema,
        });
        deps.store.profiles.markConnected(profileId, deps.now());
        return { profileId, schemaHash: schema.hash, drift, blocking, serverData: serverData?.status ?? null, clientDir, client };
      }),

    chooseServerDataDir: () => run(async () => (deps.chooseDirectory ? await deps.chooseDirectory() : null)),
  };
}
