import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openMysqlDevDb } from '../core/db/mysql-dev-db';
import { openMysqlWorldDb } from '../core/db/mysql-world-db';
import { API_METHODS, channelFor, parseRequest, type Api, type ApiError } from '../shared/ipc';
import { createApi, type ApiDeps } from './api';
import { seedEnvProfiles } from './env-profiles';
import { createSecretBox } from './secret-box';
import { openStore, type Store } from './store/store';

/**
 * The Electron shell: it owns the window, the SQLite store and the IPC surface, and nothing else.
 * All behaviour lives in `createApi`, which is why this file has no logic worth testing beyond the
 * wiring below.
 */

/** The reference fork's patch directory, used when this machine has it checked out. */
const FORK_OUTPUT_DIR = 'E:\\Repositories\\azerothcore-wotlk-coa\\data\\sql\\custom\\db_world';

const STORE_FILE = 'quest-creator.sqlite';

/**
 * Test isolation. An end-to-end run points the app at a throwaway profile directory and patch
 * folder so it never touches the user's real store or writes into the fork's checkout. `setPath`
 * has to happen before the app is ready, which is why it runs at import time.
 */
const userDataOverride = process.env['ACQC_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

/**
 * An unpackaged app (`npm run dev`, or `electron out/main/index.js` as Playwright launches it) reads
 * the repo's `.env` (see `.env.example`), so the connection details need not be typed on every
 * launch. `ACQC_ENV_FILE` points at another file, or is `none` to read nothing, which is how the
 * end-to-end test keeps the connection form in front of it. Variables already set in the shell win.
 */
const envFile = process.env['ACQC_ENV_FILE'] ?? (app.isPackaged ? 'none' : join(__dirname, '..', '..', '.env'));
if (envFile !== 'none' && existsSync(envFile)) process.loadEnvFile(envFile);

const defaultOutputDir = (): string =>
  process.env['ACQC_OUTPUT_DIR'] ??
  (existsSync(FORK_OUTPUT_DIR) ? FORK_OUTPUT_DIR : join(app.getPath('documents'), 'ACORE Quest Creator', 'sql'));

/**
 * Drizzle's migration files. In development they sit in the repo, two levels above this bundle
 * (`out/main/index.js`); a packaged build carries them as an unpacked extra resource, because they
 * are read at runtime and cannot live inside the asar. This is deliberately not `app.getAppPath()`:
 * when Electron is handed a script path (`electron out/main/index.js`, which is how Playwright
 * launches it) that is the script's own directory, not the project root.
 */
const migrationsFolder = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '..', '..', 'drizzle');

const unknownError = (error: unknown): { ok: false; error: ApiError } => ({
  ok: false,
  error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
});

function buildDeps(store: Store, startupProfileId: number | null): ApiDeps {
  return {
    store,
    startupProfileId,
    openWorldDb: (p) => openMysqlWorldDb(p),
    openDevDb: (p) => openMysqlDevDb(p),
    fs: {
      writeFile: (path, text) => writeFile(path, text, 'utf8'),
      ensureDir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      listDir: (path) => readdir(path),
    },
    now: () => new Date(),
    defaultOutputDir: defaultOutputDir(),
  };
}

/**
 * One handler per API method. Arguments are validated before the API sees them and nothing is ever
 * allowed to reject: an exception crossing IPC would reach the renderer as an opaque `Error`, so
 * every failure comes back as an ordinary `Result`.
 */
function registerIpc(api: Api): void {
  for (const method of API_METHODS) {
    ipcMain.handle(channelFor(method), async (_event, ...args: unknown[]) => {
      const parsed = parseRequest(method, args);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      try {
        const call = api[method] as (...a: unknown[]) => Promise<unknown>;
        return await call.apply(api, parsed.args);
      } catch (error) {
        return unknownError(error);
      }
    });
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'ACORE Quest Creator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  // `safeStorage` is only usable once the app is ready, so the store opens here and not at import.
  const store = openStore(join(app.getPath('userData'), STORE_FILE), createSecretBox(safeStorage), migrationsFolder());
  app.on('will-quit', () => store.close());
  let startupProfileId: number | null = null;
  try {
    startupProfileId = seedEnvProfiles(store, process.env);
  } catch (error) {
    // A bad `.env` must not stop the app opening: the connection screen is still there.
    console.error('Ignoring connection settings from the environment:', error);
  }
  registerIpc(createApi(buildDeps(store, startupProfileId)));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
