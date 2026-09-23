import type { ProfileInput } from '../shared/ipc';
import type { Store } from './store/store';

/**
 * Connection profiles read from the environment, so a developer's `.env` can stand in for the
 * connection screen. Each role reads its own prefix:
 *
 *   ACQC_WORLD_DB_HOST, _PORT, _USER, _PASSWORD, _DATABASE   (the world database)
 *   ACQC_DEV_DB_HOST,   _PORT, _USER, _PASSWORD, _DATABASE   (optional dev database)
 *
 * A role is only configured when HOST, USER and DATABASE are all set; PORT defaults to 3306 and
 * PASSWORD to empty.
 */

type Env = Record<string, string | undefined>;

const PREFIX = { world: 'ACQC_WORLD_DB_', dev: 'ACQC_DEV_DB_' } as const;
const NAME = { world: 'World (.env)', dev: 'Dev (.env)' } as const;

export function profileFromEnv(env: Env, role: 'world' | 'dev'): ProfileInput | null {
  const read = (key: string): string => (env[PREFIX[role] + key] ?? '').trim();
  const host = read('HOST');
  const user = read('USER');
  const database = read('DATABASE');
  if (!host || !user || !database) return null;
  const port = Number(read('PORT') || '3306');
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${PREFIX[role]}PORT must be a port number, got '${read('PORT')}'`);
  }
  // The password is not trimmed: surrounding spaces could be part of it.
  return { name: NAME[role], role, host, port, user, database, password: env[PREFIX[role] + 'PASSWORD'] ?? '' };
}

/**
 * Writes the environment's profiles into the store, updating the ones seeded on an earlier launch
 * rather than adding a copy each time. Returns the world profile's ID, if the environment has one.
 */
export function seedEnvProfiles(store: Store, env: Env): number | null {
  let worldId: number | null = null;
  for (const role of ['world', 'dev'] as const) {
    const input = profileFromEnv(env, role);
    if (!input) continue;
    const existing = store.profiles.list().find((p) => p.role === role && p.name === input.name);
    const saved = store.profiles.save({ ...input, id: existing?.id });
    if (role === 'world') worldId = saved.id;
  }
  return worldId;
}
