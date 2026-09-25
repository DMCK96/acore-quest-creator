import type { ProfileRecord, ProfileSave } from '@shared/ipc';

/**
 * The connection details as the login screen and Settings edit them: text as typed, one world
 * database (with its folders) and an optional dev database. Saved profiles come in through
 * `draftFromProfiles` and go back out through `draftToSaves`.
 */

export interface DbFields {
  host: string;
  port: string;
  user: string;
  database: string;
  password: string;
}
export interface WorldDraft extends DbFields {
  id?: number;
  name?: string;
  dbcDir: string;
  clientDir: string;
}
export interface DevDraft extends DbFields {
  id?: number;
  name?: string;
}
export interface ConnectionDraft {
  world: WorldDraft;
  dev: DevDraft | null;
}
/** Keyed by input ID, e.g. 'conn-host', 'conn-dev-port'. */
export type DraftErrors = Partial<Record<string, string>>;

const emptyDb = (): DbFields => ({ host: '', port: '3306', user: '', database: '', password: '' });

export function emptyDev(): DevDraft {
  return emptyDb();
}

/** A saved profile's fields as a draft; the password is never sent back, so it starts blank. */
const dbFromProfile = (p: ProfileRecord): DbFields & { id: number; name: string } => ({
  id: p.id,
  name: p.name,
  host: p.host,
  port: String(p.port),
  user: p.user,
  database: p.database,
  password: '',
});

const newestById = (rows: ProfileRecord[]): ProfileRecord | undefined =>
  rows.reduce<ProfileRecord | undefined>((best, p) => (best === undefined || p.id > best.id ? p : best), undefined);

/**
 * The world profile `preferId` names (the one launch offers, from `.env`), else the one that
 * connected last (the newest by ID when none has), and the newest dev profile.
 */
export function draftFromProfiles(profiles: ProfileRecord[], preferId: number | null = null): ConnectionDraft {
  const worlds = profiles.filter((p) => p.role === 'world');
  const stamped = worlds.filter((p) => p.lastConnectedAt !== null);
  const preferred = worlds.find((p) => p.id === preferId);
  const world =
    preferred ??
    (stamped.length > 0
      ? stamped.reduce((best, p) => (p.lastConnectedAt! > best.lastConnectedAt! ? p : best))
      : newestById(worlds));
  const dev = newestById(profiles.filter((p) => p.role === 'dev'));
  return {
    world: world ? { ...dbFromProfile(world), dbcDir: world.dbcDir, clientDir: world.clientDir } : { ...emptyDb(), dbcDir: '', clientDir: '' },
    dev: dev ? dbFromProfile(dev) : null,
  };
}

const PORT_ERROR = 'Port must be a whole number from 1 to 65535';

function validateDb(db: DbFields, prefix: string, errors: DraftErrors): void {
  if (db.host.trim() === '') errors[`${prefix}host`] = 'Host is required';
  const port = db.port.trim();
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) errors[`${prefix}port`] = PORT_ERROR;
  if (db.user.trim() === '') errors[`${prefix}user`] = 'User is required';
  if (db.database.trim() === '') errors[`${prefix}database`] = 'Database is required';
}

/** Empty when the draft can be saved. The password is never required. */
export function validateDraft(draft: ConnectionDraft): DraftErrors {
  const errors: DraftErrors = {};
  validateDb(draft.world, 'conn-', errors);
  if (draft.dev) validateDb(draft.dev, 'conn-dev-', errors);
  return errors;
}

// Compared as saved: trimmed, and the port as a number, so a stray space is not a change. The
// password is kept as typed, since spaces can be part of it.
const sameText = (a: string, b: string): boolean => a.trim() === b.trim();
const sameDb = (a: DbFields & { id?: number }, b: DbFields & { id?: number }): boolean =>
  a.id === b.id &&
  sameText(a.host, b.host) &&
  (sameText(a.port, b.port) || Number(a.port.trim()) === Number(b.port.trim())) &&
  sameText(a.user, b.user) &&
  sameText(a.database, b.database) &&
  a.password === b.password;

export function worldChanged(draft: ConnectionDraft, original: ConnectionDraft): boolean {
  const a = draft.world;
  const b = original.world;
  return !sameDb(a, b) || !sameText(a.dbcDir, b.dbcDir) || !sameText(a.clientDir, b.clientDir);
}

export function devChanged(draft: ConnectionDraft, original: ConnectionDraft): boolean {
  if (draft.dev === null || original.dev === null) return draft.dev !== original.dev;
  return !sameDb(draft.dev, original.dev);
}

function toSave(db: DbFields & { id?: number; name?: string }, role: 'world' | 'dev'): ProfileSave {
  const save: ProfileSave = {
    ...(db.id !== undefined ? { id: db.id } : {}),
    name: db.name ?? (role === 'world' ? 'World' : 'Dev'),
    role,
    host: db.host.trim(),
    port: Number(db.port.trim()),
    user: db.user.trim(),
    database: db.database.trim(),
  };
  // A saved profile with the password left blank keeps the stored one.
  if (db.id === undefined || db.password !== '') save.password = db.password;
  return save;
}

/**
 * The draft as it stands once saved: it carries the saved rows' IDs and names, and blank passwords
 * (the saved ones are kept), so saving it again updates those rows instead of adding new ones.
 */
export function savedDraft(draft: ConnectionDraft, world: ProfileRecord, dev: ProfileRecord | null): ConnectionDraft {
  return {
    world: { ...draft.world, id: world.id, name: world.name, password: '' },
    dev: draft.dev && dev ? { ...draft.dev, id: dev.id, name: dev.name, password: '' } : null,
  };
}

/** The saves the draft needs, and the dev row to remove when the user removed or replaced it. */
export function draftToSaves(
  draft: ConnectionDraft,
  original: ConnectionDraft,
): { world: ProfileSave; dev: ProfileSave | null; removeDevId: number | null } {
  const world = { ...toSave(draft.world, 'world'), dbcDir: draft.world.dbcDir.trim(), clientDir: draft.world.clientDir.trim() };
  const dev = draft.dev ? toSave(draft.dev, 'dev') : null;
  const originalDevId = original.dev?.id;
  const removeDevId = originalDevId !== undefined && draft.dev?.id !== originalDevId ? originalDevId : null;
  return { world, dev, removeDevId };
}
