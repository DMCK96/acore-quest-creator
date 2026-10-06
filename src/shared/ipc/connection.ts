import type { SchemaDiff } from '@core/schema/diff';
import type { Result } from './result';

/** Connection profiles. `password` only ever travels towards the main process. */
export interface ProfileInput {
  name: string;
  role: 'world' | 'dev';
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
  /** The server's data folder (`DataDir`, holding `dbc/`), optional; '' or absent for none. */
  dbcDir?: string;
  /** The game client folder (holding Wow.exe and Data/), optional; '' or absent for none. */
  clientDir?: string;
  /** Where Export patch writes SQL files, optional; '' or absent for the default folder. */
  exportDir?: string;
}

/** Saving a profile: an update (`id` given) may leave `password` out to keep the stored one. */
export type ProfileSave = Omit<ProfileInput, 'password'> & { id?: number; password?: string };

export interface ProfileRecord {
  id: number;
  name: string;
  role: 'world' | 'dev';
  host: string;
  port: number;
  user: string;
  database: string;
  /** '' when the profile names no server data folder. */
  dbcDir: string;
  /** '' when the profile names no game client folder. */
  clientDir: string;
  /** '' when the profile names no export folder. */
  exportDir: string;
  /** When this profile last connected (ISO 8601); null before its first connect. */
  lastConnectedAt: string | null;
}

export interface ConnectSummary {
  profileId: number;
  schemaHash: string;
  drift: SchemaDiff;
  /** True when a table every quest needs is missing: the fork cannot be worked with as it is. */
  blocking: boolean;
  /** What was read from the profile's server data folder; null when it names none. */
  serverData: ServerDataStatus | null;
  /** The profile's game client folder, trimmed; null when it names none. */
  clientDir: string | null;
  /** What was read from the game client folder; null when the profile names none. */
  client: ClientStatus | null;
}

/** The optional game client folder: the archives read from it and what went wrong. */
export interface ClientStatus {
  dir: string;
  archives: string[];
  problems: string[];
}

/** The optional server data folder: the files read from it and what went wrong with the rest. */
export interface ServerDataStatus {
  dir: string;
  loaded: string[];
  problems: string[];
}

/** Connection profiles, and connecting to a world database */
export interface ConnectionApi {
  testConnection(i: ProfileInput): Promise<Result<{ ok: true }>>;
  saveProfile(i: ProfileSave): Promise<Result<ProfileRecord>>;
  listProfiles(): Promise<Result<ProfileRecord[]>>;
  /** Removes a saved profile; refused for the one the session is connected with. */
  deleteProfile(id: number): Promise<Result<null>>;
  /** The profile to connect to without asking, seeded from `.env` in development; else null. */
  startupProfile(): Promise<Result<number | null>>;
  connect(profileId: number): Promise<Result<ConnectSummary>>;
  /** Shows a folder picker for the server data folder; null when cancelled. */
  chooseServerDataDir(): Promise<Result<string | null>>;
}
