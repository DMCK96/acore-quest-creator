import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openMysqlDevDb } from '../core/db/mysql-dev-db';
import { openMysqlWorldDb } from '../core/db/mysql-world-db';
import { FLUSH_DONE_CHANNEL, FLUSH_REQUEST_CHANNEL } from '../shared/api-methods';
import { API_METHODS, channelFor, parseRequest, type Api, type ApiError } from '../shared/ipc';
import { createApi, type ApiDeps } from './api';
import { seedEnvProfiles } from './env-profiles';
import { mapDataFiles, nodeServerDataFiles } from './server-data';
import { createClientImagery, nodeClientFs } from './client-imagery';
import { createMapTiles, parseTileUrl, type MapTiles } from './map-tiles';
import { createSecretBox } from './secret-box';
import { openStore, type Store } from './store/store';
import { DEFAULT_PROJECT_NAME, PROJECT_EXTENSION, defaultProjectMeta } from './project/project-file';
import { createProjectSession, type ProjectSession } from './project/session';
import { createProjectController, type Dialogs, type ProjectController } from './project/controller';
import { createCloseGuard, windowTitle } from './project/close-guard';
import { createRecovery, type Recovery } from './project/recovery';
import { nodeProjectFs } from './project/node-fs';

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

// The quest map's relief tiles come from the main process; the scheme must be known before `ready`.
protocol.registerSchemesAsPrivileged([{ scheme: 'acqc-map', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves `acqc-map://tile/...` from the tile service; anything else is not found. */
function registerMapTiles(tiles: MapTiles): void {
  protocol.handle('acqc-map', async (request) => {
    const address = parseTileUrl(request.url);
    if (!address) return new Response(null, { status: 404 });
    const png = await tiles.tile(address.map, address.zoom, address.tx, address.ty);
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
  });
}

function buildDeps(
  store: Store,
  session: ProjectSession,
  projects: ProjectController,
  startupProfileId: number | null,
  tiles: MapTiles,
): ApiDeps {
  return {
    store,
    onServerDataDir: (dir) => tiles.setDataDir(dir),
    session,
    projects,
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
    serverDataFiles: nodeServerDataFiles,
    mapDataFiles,
    async chooseDirectory() {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = { title: 'Server data folder', properties: ['openDirectory' as const] };
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!;
    },
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

/** Recovery copies are written this often while there are unsaved changes (the e2e test shortens it). */
const recoveryIntervalMs = (): number => Number(process.env['ACQC_RECOVERY_INTERVAL_MS']) || 30000;

const PROJECT_FILTERS = [{ name: 'Quest Creator project', extensions: [PROJECT_EXTENSION] }];

/**
 * The native dialogs, parented to whichever window is focused. `dialog.*` is looked up on every
 * call rather than destructured, so the end-to-end test can answer them through `app.evaluate`.
 */
const electronDialogs: Dialogs = {
  async showSave(suggestedFileName) {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { defaultPath: join(app.getPath('documents'), suggestedFileName), filters: PROJECT_FILTERS };
    const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    return r.canceled || !r.filePath ? null : r.filePath;
  },
  async showOpen() {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { properties: ['openFile' as const], filters: PROJECT_FILTERS };
    const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!;
  },
  async confirmUnsaved(name) {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      type: 'warning' as const,
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to "${name}"?`,
      detail: "Your changes will be lost if you don't save them.",
    };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
  },
};

function createWindow(session: ProjectSession, recovery: Recovery, projects: ProjectController): void {
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

  // The title carries the project name and the unsaved marker, so the page's own <title> is ignored.
  const showTitle = (): void => win.setTitle(windowTitle(session.meta().name, session.dirty()));
  win.on('page-title-updated', (event) => event.preventDefault());
  showTitle();
  const stopTitle = session.onChange(showTitle);

  const tick = (): void => {
    recovery.tick(session).catch((error: unknown) => console.error('Could not write the recovery copy:', error));
  };
  const timer = setInterval(tick, recoveryIntervalMs());
  win.on('blur', tick);

  const flush = (): Promise<void> =>
    new Promise((resolve) => {
      ipcMain.once(FLUSH_DONE_CHANNEL, () => resolve());
      win.webContents.send(FLUSH_REQUEST_CHANNEL);
    });
  const guard = createCloseGuard({
    flush,
    projects,
    onError: (message) => dialog.showErrorBox('The project was not saved', message),
  });
  let closing = false;
  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    void guard().then((mayClose) => {
      if (!mayClose) return;
      closing = true;
      win.close();
    });
  });
  win.on('closed', () => {
    clearInterval(timer);
    stopTitle();
  });

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
  const session = createProjectSession(defaultProjectMeta(DEFAULT_PROJECT_NAME, defaultOutputDir()));
  const recovery = createRecovery({ dir: join(app.getPath('userData'), 'recovery'), fs: nodeProjectFs, now: () => new Date() });
  const projects = createProjectController({
    session,
    fs: nodeProjectFs,
    dialogs: electronDialogs,
    recovery,
    recent: store.recent,
    defaultOutputDir: defaultOutputDir(),
    now: () => new Date(),
  });
  const tiles = createMapTiles({
    files: mapDataFiles,
    cacheRoot: join(app.getPath('userData'), 'map-tiles'),
    openImagery: (dir) => createClientImagery(dir, nodeClientFs, (m) => console.warn(`Game client: ${m}`)),
    cache: {
      async read(path) {
        try {
          return new Uint8Array(await readFile(path));
        } catch {
          return null;
        }
      },
      async write(path, bytes) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      },
    },
  });
  registerMapTiles(tiles);
  registerIpc(createApi(buildDeps(store, session, projects, startupProfileId, tiles)));

  createWindow(session, recovery, projects);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(session, recovery, projects);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
