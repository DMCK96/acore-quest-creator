import type { DevDb } from '../../core/db/dev-db';
import type { WorldDb } from '../../core/db/world-db';
import type { ClientStatus, ProfileInput } from '../../shared/ipc';
import type { Store } from '../store/store';
import type { ServerDataFiles } from '../server-data';
import type { ProjectSession } from '../project/session';
import type { ProjectController } from '../project/controller';

/** Every side effect the API has, given to it so tests can run the real thing against fakes */
export interface ApiDeps {
  store: Store;
  openWorldDb(p: ProfileInput): Promise<WorldDb>;
  openDevDb(p: ProfileInput): Promise<DevDb>;
  fs: {
    writeFile(path: string, text: string): Promise<void>;
    ensureDir(path: string): Promise<void>;
    listDir(path: string): Promise<string[]>;
  };
  now(): Date;
  /** The open project: every quest on the canvas lives here until the user saves it to a file. */
  session: ProjectSession;
  /** New, Open, Save and the rest of the project-file actions, which need no database. */
  projects: ProjectController;
  /** A profile to connect to on launch (seeded from `.env` in development). */
  startupProfileId?: number | null;
  /** Reads the optional server data folder; without it the folder is reported as unreadable. */
  serverDataFiles?: ServerDataFiles;
  /** The native folder picker; null when cancelled. */
  chooseDirectory?(): Promise<string | null>;
  /** The data folder for the quest map's grid and navmesh reads (listings cached); `serverDataFiles` otherwise. */
  mapDataFiles?: ServerDataFiles;
  /** Told the connection's server data folder at every connect (null when it names none), for the map tiles. */
  onServerDataDir?(dir: string | null): void;
  /** Told the connection's game client folder at every connect (null when it names none), for the map tiles. */
  onClientDir?(dir: string | null): void;
  /** What the game client folder given to `onClientDir` holds; the folder is opened now if it was not yet. */
  clientStatus?(): Promise<ClientStatus | null>;
  /** Where Export patch writes whatever the connection says (`ACQC_OUTPUT_DIR`, for tests). */
  exportDirOverride?: string | null;
  /** Where Export patch writes when the connection names no export folder. */
  defaultExportDir?: string;
}
