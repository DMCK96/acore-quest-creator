import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { FieldValue } from '@core/registry/types';
import type { Issue } from '@core/validate/validate';
import type { QuestSummary } from '@core/db/world-db';
import type { Difference } from '@core/roundtrip/compare';
import type {
  Api,
  ApiError,
  CanvasNode,
  ConnectSummary,
  ExportResult,
  NodePosition,
  OpenResult,
  ProfileRecord,
  ProfileSave,
  ProjectState,
  QuestLinks,
  RecentProject,
  RecoveryEntry,
  Result,
  Viewport,
} from '@shared/ipc';
import type { ModuleId } from '@core/modules/model';
import { resetModule } from '@core/modules/catalog';
import { draftToSaves, type ConnectionDraft } from '../connection/draft';

export interface AppState {
  screen: 'connect' | 'pick' | 'preview' | 'edit';
  profiles: ProfileRecord[];
  summary: ConnectSummary | null;
  error: string | null;
  results: QuestSummary[];
  open: OpenResult | null;
  /** The module (or the changes view) open in the flow view's side panel. */
  openPanel: ModuleId | 'changes' | 'test' | 'map' | null;
  /** Optional modules added this session that have nothing in them yet, so they still show. */
  addedModules: ModuleId[];
  issues: Issue[];
  saving: boolean;
  dirty: boolean;
  nodes: CanvasNode[];
  viewport: Viewport;
  project: ProjectState;
  /** Goes up by one each time a different project is loaded (New, Open, Restore). */
  projectEpoch: number;
  recent: RecentProject[];
  recoveries: RecoveryEntry[];
  preview: Difference[] | null;
  exportResult: ExportResult | null;
  exportError: ApiError | null;
  hasDevProfile: boolean;
  pendingApply: { sql: string } | null;
  appliedCount: number | null;
  links: QuestLinks | null;

  loadProfiles(): Promise<void>;
  /** Launch: lists the saved profiles, then connects straight away if one is set up for it. */
  start(): Promise<void>;
  connect(input: ProfileSave): Promise<void>;
  /** Connects with a saved profile and its stored password. */
  connectProfile(profileId: number): Promise<void>;
  /** Saves the draft's rows (world, then dev, then removes a dev row the user removed) and reloads the profiles. */
  saveConnection(draft: ConnectionDraft, original: ConnectionDraft): Promise<{ ok: true; worldId: number } | { ok: false; error: string }>;
  /**
   * Connects with a saved profile from inside the app. Returns the error to show, or null. A failed
   * connect leaves everything as it was; a database with blocking drift goes to the login screen.
   */
  reconnect(profileId: number): Promise<string | null>;
  /** Asks for the server data folder with the native picker; null when cancelled or it failed. */
  chooseServerDataDir(): Promise<string | null>;
  search(text: string): Promise<void>;
  /** Loads a quest into the preview; false when it failed or a newer open replaced it. */
  openQuest(id: number, position?: NodePosition): Promise<boolean>;
  /** Adds the quest and every quest chained to it to the canvas, then opens the one picked. */
  addQuestChain(id: number, position?: NodePosition): Promise<void>;
  newQuest(position?: NodePosition): Promise<void>;
  setValue(fieldId: string, value: FieldValue): void;
  /** Switches the previewed quest into the module editor. */
  editQuest(): void;
  /** Leaves the editor for the chain canvas, sending any pending edit first; the quest stays previewed. */
  backToChain(): Promise<void>;
  setOpenPanel(p: ModuleId | 'changes' | 'test' | 'map' | null): void;
  addModule(id: ModuleId): void;
  /** Clears every writable field the module owns and hides it again. */
  removeModule(id: ModuleId): void;
  flushSave(): Promise<void>;
  dismissError(): void;
  backToPicker(): Promise<void>;
  loadNodes(): Promise<void>;
  moveNode(questId: number, x: number, y: number): void;
  setViewport(v: Viewport): void;
  flushMoves(): Promise<void>;
  removeNode(questId: number): Promise<void>;
  closeEditor(): Promise<void>;
  loadPreview(): Promise<void>;
  exportQuest(): Promise<void>;
  prepareApply(): Promise<void>;
  confirmApply(): Promise<void>;
  cancelApply(): void;
  loadLinks(): Promise<void>;
  loadProjectState(): Promise<void>;
  /** Sends the debounced edit and any queued moves now, so nothing typed is left behind. */
  flushAll(): Promise<void>;
  newProject(name: string): Promise<void>;
  openProject(path?: string): Promise<void>;
  saveProject(): Promise<void>;
  saveProjectAs(): Promise<void>;
  renameProject(name: string): Promise<void>;
  loadRecent(): Promise<void>;
  forgetRecent(path: string): Promise<void>;
  loadRecoveries(): Promise<void>;
  /** Restores one crash copy and discards every other one listed: only one project can be open. */
  restoreRecovery(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
}

export type AppStore = UseBoundStore<StoreApi<AppState>>;

/**
 * A table this user may not read is not a table the fork lacks: one is fixed with a `GRANT`, the
 * other by pointing at a different database, so the two are never reported with the same sentence.
 */
const missingTablesMessage = (tables: string[], forbidden: string[] = []): string => {
  const hidden = tables.filter((t) => forbidden.includes(t));
  const absent = tables.filter((t) => !forbidden.includes(t));
  const parts: string[] = [];
  if (absent.length > 0) parts.push(`This database is missing required tables: ${absent.join(', ')}`);
  if (hidden.length > 0) {
    parts.push(`This database user has no permission to read: ${hidden.join(', ')} (ask for SELECT on them)`);
  }
  return parts.join('. ');
};

/**
 * The whole renderer's state, built once per `<App>` around one `Api`.
 *
 * `opts.saveDelayMs` (default 400) is the debounce before an edit is sent to the open project; `0` in
 * tests still defers to a timer (via `setTimeout`), so `flushSave` is what tests call to force it.
 */
export function createAppStore(api: Api, opts: { saveDelayMs?: number } = {}): AppStore {
  const saveDelayMs = opts.saveDelayMs ?? 400;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Guards against an older, slower `search`/`openQuest` response landing after a newer one.
  let searchToken = 0;
  let openToken = 0;
  let nodesToken = 0;
  // StrictMode runs effects twice in development; launch must still connect only once.
  let started = false;
  // The latest position per quest queued by a drag, and the latest queued viewport, cleared once
  // `flushMoves` has sent them. `lastSavedViewport` is what the API last saw, so an unchanged
  // viewport (e.g. a pan back to where it started) does not trigger a redundant save.
  const pendingMoves = new Map<number, NodePosition>();
  let pendingViewport: Viewport | null = null;
  let lastSavedViewport: Viewport = { x: 0, y: 0, zoom: 1 };
  const viewportsEqual = (a: Viewport, b: Viewport): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

  const store = create<AppState>((set, get) => ({
    screen: 'connect',
    profiles: [],
    summary: null,
    error: null,
    results: [],
    open: null,
    openPanel: null,
    addedModules: [],
    issues: [],
    saving: false,
    dirty: false,
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    project: { name: '', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: '', viewport: { x: 0, y: 0, zoom: 1 } },
    projectEpoch: 0,
    recent: [],
    recoveries: [],
    preview: null,
    exportResult: null,
    exportError: null,
    hasDevProfile: false,
    pendingApply: null,
    appliedCount: null,
    links: null,

    async loadProfiles() {
      const result = await api.listProfiles();
      if (result.ok) {
        set({ profiles: result.value, hasDevProfile: result.value.some((p) => p.role === 'dev') });
      }
    },

    async start() {
      if (started) return;
      started = true;
      await get().loadProfiles();
      const startup = await api.startupProfile();
      if (startup.ok && startup.value !== null) await get().connectProfile(startup.value);
    },

    async connect(input) {
      const saved = await api.saveProfile(input);
      if (!saved.ok) {
        set({ error: saved.error.message, screen: 'connect' });
        return;
      }
      const profile = saved.value;
      set((s) => ({ profiles: dedupeProfiles(s.profiles, profile) }));
      await get().connectProfile(profile.id);
    },

    async chooseServerDataDir() {
      const chosen = await api.chooseServerDataDir();
      return chosen.ok ? chosen.value : null;
    },

    async connectProfile(profileId) {
      const connected = await api.connect(profileId);
      if (!connected.ok) {
        set({ error: connected.error.message, screen: 'connect' });
        return;
      }
      const summary = connected.value;
      if (summary.blocking) {
        set(blockedBy(summary));
        return;
      }
      set({ summary, error: null, screen: 'pick' });
    },

    async saveConnection(draft, original) {
      const saves = draftToSaves(draft, original);
      const world = await api.saveProfile(saves.world);
      if (!world.ok) return { ok: false, error: world.error.message };
      if (saves.dev) {
        const dev = await api.saveProfile(saves.dev);
        if (!dev.ok) return { ok: false, error: dev.error.message };
      }
      if (saves.removeDevId !== null) {
        const removed = await api.deleteProfile(saves.removeDevId);
        if (!removed.ok) return { ok: false, error: removed.error.message };
      }
      await get().loadProfiles();
      return { ok: true, worldId: world.value.id };
    },

    async reconnect(profileId) {
      // Pending edits are written first, so switching databases cannot lose one.
      await get().flushAll();
      const connected = await api.connect(profileId);
      if (!connected.ok) return connected.error.message;
      const summary = connected.value;
      const closed = { open: null, dirty: false, links: null, openPanel: null };
      // The session has already switched, so a blocked database leaves the editor for the login screen.
      set(summary.blocking ? { ...blockedBy(summary), ...closed } : { summary, error: null, screen: 'pick', ...closed });
      return null;
    },

    async search(text) {
      if (text.trim() === '') {
        set({ results: [] });
        return;
      }
      const token = ++searchToken;
      const result = await api.searchQuests(text);
      if (token !== searchToken) return;
      if (result.ok) set({ results: result.value });
      else set({ error: result.error.message });
    },

    async openQuest(id, position) {
      const token = ++openToken;
      const result = position === undefined ? await api.openQuest(id) : await api.openQuest(id, position);
      if (token !== openToken) return false;
      if (!result.ok) {
        set({ error: result.error.message, screen: 'pick' });
        return false;
      }
      set({
        open: result.value,
        issues: result.value.issues,
        openPanel: null,
        screen: 'preview',
        error: null,
        dirty: false,
      });
      await get().loadNodes();
      await get().loadLinks();
      return true;
    },

    async addQuestChain(id, position) {
      const token = ++openToken;
      const result = position === undefined ? await api.addQuestChain(id) : await api.addQuestChain(id, position);
      if (token !== openToken) return;
      if (!result.ok) {
        set({ error: result.error.message });
        await get().loadNodes();
        return;
      }
      const { open, questIds, truncated } = result.value;
      set({
        open,
        issues: open.issues,
        openPanel: null,
        screen: 'preview',
        // A chain cut short is still a chain on the canvas, but the user has to know it is not all of it.
        error: truncated ? `Only the first ${questIds.length} quests of this chain were added.` : null,
        dirty: false,
      });
      await get().loadNodes();
      await get().loadLinks();
    },

    async newQuest(position) {
      const token = ++openToken;
      const result = position === undefined ? await api.newQuest() : await api.newQuest(position);
      if (token !== openToken) return;
      if (!result.ok) {
        set({ error: result.error.message, screen: 'pick' });
        return;
      }
      set({
        open: result.value,
        issues: result.value.issues,
        openPanel: null,
        addedModules: [],
        screen: 'edit',
        error: null,
        dirty: false,
      });
      await get().loadNodes();
      await get().loadLinks();
    },

    setValue(fieldId, value) {
      const { open } = get();
      if (!open) return;
      set({
        open: { ...open, aggregate: { ...open.aggregate, values: { ...open.aggregate.values, [fieldId]: value } } },
        dirty: true,
      });
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void get().flushSave();
      }, saveDelayMs);
    },

    editQuest() {
      if (!get().open) return;
      set({ screen: 'edit', openPanel: null, addedModules: [] });
    },

    async backToChain() {
      await get().flushSave();
      set({ screen: 'preview', openPanel: null });
      await get().loadNodes();
    },

    setOpenPanel(p) {
      set({ openPanel: p });
      // What one panel just changed can matter to the next (a new NPC picked as a giver), and the
      // main process only answers from what it has been sent: send a pending edit now.
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void get().flushSave();
      }
    },

    addModule(id) {
      const { addedModules } = get();
      set({ addedModules: addedModules.includes(id) ? addedModules : [...addedModules, id], openPanel: id });
    },

    removeModule(id) {
      const { open } = get();
      // Advanced holds every rare column of an imported quest; clearing it wholesale is never wanted.
      if (!open || id === 'advanced') return;
      const edits = resetModule(id, open.aggregate.values, open.aggregate.readOnly.map((r) => r.fieldId));
      for (const [fieldId, value] of Object.entries(edits)) get().setValue(fieldId, value);
      set((s) => ({
        addedModules: s.addedModules.filter((m) => m !== id),
        openPanel: s.openPanel === id ? null : s.openPanel,
      }));
    },

    dismissError() {
      set({ error: null });
    },

    async flushSave() {
      // Only an edit is sent: a quest merely looked at must not mark the project unsaved.
      const pending = saveTimer !== null || get().dirty;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { open } = get();
      if (!open || !pending) return;
      set({ saving: true });
      const saved = await api.updateQuest(open.aggregate);
      if (!saved.ok) {
        set({ saving: false, error: saved.error.message });
        return;
      }
      const issues = await api.validate(open.questId);
      set({
        saving: false,
        dirty: false,
        issues: issues.ok ? issues.value : get().issues,
        error: issues.ok ? get().error : issues.error.message,
      });
      // The canvas stays visible behind the editor and draws the edited links, so an edit to a
      // chain column must redraw it now rather than when the editor closes.
      await Promise.all([get().loadLinks(), get().loadNodes()]);
    },

    // Leaving the editor is a close: the debounced edit still in flight is written first, exactly
    // as `closeEditor` does, so clicking Back inside the debounce window cannot lose it.
    async backToPicker() {
      set({ error: null });
      await get().flushSave();
      set({ screen: 'pick', open: null, dirty: false, links: null });
    },

    async loadNodes() {
      const token = ++nodesToken;
      const [nodesResult, projectResult] = await Promise.all([api.listNodes(), api.projectState()]);
      if (token !== nodesToken) return;
      if (nodesResult.ok) set({ nodes: nodesResult.value });
      if (projectResult.ok) {
        lastSavedViewport = projectResult.value.viewport;
        set({ viewport: projectResult.value.viewport, project: projectResult.value });
      }
    },

    moveNode(questId, x, y) {
      pendingMoves.set(questId, { x, y });
      set((s) => ({
        nodes: s.nodes.map((n) => (n.questId === questId ? { ...n, x, y } : n)),
      }));
    },

    setViewport(v) {
      if (!viewportsEqual(lastSavedViewport, v)) pendingViewport = v;
      set({ viewport: v });
    },

    async flushMoves() {
      const moves = Array.from(pendingMoves.entries()).map(([questId, pos]) => ({ questId, ...pos }));
      pendingMoves.clear();
      const viewportToSave = pendingViewport;
      pendingViewport = null;

      const tasks: Promise<Result<unknown>>[] = [];
      if (moves.length > 0) tasks.push(api.moveNodes(moves));
      if (viewportToSave) {
        lastSavedViewport = viewportToSave;
        tasks.push(api.saveViewport(viewportToSave));
      }
      // A dropped layout save used to vanish: the results were awaited and then thrown away.
      const failed = (await Promise.all(tasks)).find((r) => !r.ok);
      if (failed && !failed.ok) set({ error: failed.error.message });
      if (tasks.length > 0) await get().loadProjectState();
    },

    async removeNode(questId) {
      const result = await api.removeNode(questId);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ nodes: s.nodes.filter((n) => n.questId !== questId) }));
      await get().loadProjectState();
    },

    // A failed save is the one thing that must survive closing: clearing `error` first drops a
    // stale message, and `flushSave` puts a fresh one back if the edit did not reach the project.
    async closeEditor() {
      set({ error: null });
      await get().flushSave();
      set({ screen: 'pick', open: null, dirty: false, links: null });
      await get().loadNodes();
    },

    // The comparison reads the saved quest, so an edit still on the debounce is sent first.
    async loadPreview() {
      await get().flushSave();
      const { open } = get();
      if (!open) return;
      const result = await api.previewChanges(open.questId);
      if (result.ok) set({ preview: result.value });
      else set({ error: result.error.message });
    },

    async exportQuest() {
      const { open } = get();
      if (!open) return;
      await get().flushSave();
      set({ exportError: null });
      const result = await api.exportQuest(open.questId);
      if (result.ok) set({ exportResult: result.value, exportError: null });
      else set({ exportResult: null, exportError: result.error });
      // Marking a quest exported is a change to the project.
      if (result.ok) await get().loadProjectState();
    },

    async prepareApply() {
      const { open } = get();
      if (!open) return;
      await get().flushSave();
      set({ exportError: null });
      const result = await api.exportQuest(open.questId);
      if (result.ok) {
        set({ exportResult: result.value, exportError: null, pendingApply: { sql: result.value.sql } });
      } else {
        set({ exportResult: null, exportError: result.error });
      }
    },

    async confirmApply() {
      const { open } = get();
      if (!open) return;
      set({ pendingApply: null });
      const result = await api.applyToDev(open.questId, true);
      if (result.ok) set({ appliedCount: result.value.statements, exportError: null });
      else set({ appliedCount: null, exportError: result.error });
    },

    cancelApply() {
      set({ pendingApply: null });
    },

    // The Availability tab reads from `links`, so every point that changes which quest is open
    // (or edits it) refreshes it. A response is dropped if the open quest has since moved on, since
    // otherwise a slow answer for quest A could land after quest B is already open.
    async loadLinks() {
      const { open } = get();
      if (!open) return;
      const questId = open.questId;
      const result = await api.questLinks([questId]);
      if (get().open?.questId !== questId) return;
      if (result.ok) set({ links: result.value });
      else set({ error: result.error.message });
    },

    async loadProjectState() {
      const result = await api.projectState();
      if (result.ok) set({ project: result.value });
    },

    async flushAll() {
      await get().flushSave();
      await get().flushMoves();
    },

    async newProject(name) {
      await get().flushAll();
      const result = await api.newProject(name);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      if (result.value.done) await switchedProject();
    },

    async openProject(path) {
      await get().flushAll();
      const result = path === undefined ? await api.openProject() : await api.openProject(path);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      if (result.value.done) await switchedProject();
    },

    async saveProject() {
      await get().flushAll();
      const result = await api.saveProject();
      if (!result.ok) set({ error: result.error.message });
      await Promise.all([get().loadProjectState(), get().loadRecent()]);
    },

    async saveProjectAs() {
      await get().flushAll();
      const result = await api.saveProjectAs();
      if (!result.ok) set({ error: result.error.message });
      await Promise.all([get().loadProjectState(), get().loadRecent()]);
    },

    async renameProject(name) {
      await get().flushAll();
      const result = await api.renameProject(name);
      if (!result.ok) set({ error: result.error.message });
      await get().loadProjectState();
    },

    async loadRecent() {
      const result = await api.recentProjects();
      if (result.ok) set({ recent: result.value });
    },

    async forgetRecent(path) {
      const result = await api.forgetRecent(path);
      if (!result.ok) set({ error: result.error.message });
      await get().loadRecent();
    },

    async loadRecoveries() {
      const result = await api.recoveries();
      if (result.ok) set({ recoveries: result.value });
    },

    async restoreRecovery(id) {
      await get().flushAll();
      const result = await api.restoreRecovery(id);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      const others = get().recoveries.filter((r) => r.id !== id);
      await Promise.all(others.map((r) => api.discardRecovery(r.id)));
      set({ recoveries: [] });
      await switchedProject();
    },

    async discardRecovery(id) {
      const result = await api.discardRecovery(id);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ recoveries: s.recoveries.filter((r) => r.id !== id) }));
    },
  }));

  /**
   * A different project is open: nothing the editor or the canvas holds belongs to it any more.
   * Queued moves and viewport changes were for the old canvas, so they are dropped, not sent.
   */
  async function switchedProject(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    pendingMoves.clear();
    pendingViewport = null;
    store.setState({
      open: null,
      screen: 'pick',
      links: null,
      dirty: false,
      preview: null,
      exportResult: null,
      exportError: null,
    });
    await store.getState().loadNodes();
    // Last, so the canvas applies the new project's viewport rather than the old one's.
    store.setState((s) => ({ projectEpoch: s.projectEpoch + 1 }));
  }

  return store;
}

/** What a connect to a database with blocking drift shows: the login screen and why. */
function blockedBy(summary: ConnectSummary): Pick<AppState, 'error' | 'screen' | 'summary'> {
  return {
    error: missingTablesMessage(summary.drift.missingTables, summary.drift.forbiddenTables ?? []),
    screen: 'connect',
    summary,
  };
}

function dedupeProfiles(profiles: ProfileRecord[], profile: ProfileRecord): ProfileRecord[] {
  const rest = profiles.filter((p) => p.id !== profile.id);
  return [...rest, profile];
}
