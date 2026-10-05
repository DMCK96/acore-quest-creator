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
  HistoryList,
  HistoryResult,
  NodePosition,
  OpenResult,
  ProfileRecord,
  ProfileSave,
  ProjectState,
  QuestLinks,
  RecentProject,
  RecoveryEntry,
  Result,
  StepPlace,
  Viewport,
} from '@shared/ipc';
import { EMPTY_WORLD, type WorldLayer } from '@core/world/layer';
import { EMPTY_ENTITIES, newItem, newNpc, newObject, type CustomItem, type CustomNpc, type CustomObject, type ProjectEntities } from '@core/entities/model';
import { toggleRole } from '@core/modules/quest-roles';
import type { ModuleId } from '@core/modules/model';
import { resetModule } from '@core/modules/catalog';
import { draftToSaves, savedDraft, type ConnectionDraft } from '../connection/draft';

export interface AppState {
  screen: 'connect' | 'pick' | 'preview' | 'edit';
  profiles: ProfileRecord[];
  /** The profile launch puts on the login screen (seeded from `.env` in development); null when none. */
  startupProfileId: number | null;
  summary: ConnectSummary | null;
  /** Counts the connections made; the per-connection caches (names, reward tables) start again when it moves. */
  connection: number;
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
  /** Where the project patch went when it was exported after a quest's (null until then) */
  projectPatch: { applyPath: string; revertPath: string } | null;
  exportError: ApiError | null;
  hasDevProfile: boolean;
  pendingApply: { sql: string } | null;
  appliedCount: number | null;
  links: QuestLinks | null;
  /** The project's undo history, as the main process last told it */
  history: HistoryList;
  /** What the last undo or redo did, for the note; null once dismissed */
  historyNote: { text: string; where: StepPlace | null; skipped: string[] } | null;
  /** The world layer as an undo or redo left it, with a count that moves each time, for the views to take */
  worldLayer: { layer: WorldLayer; seq: number } | null;
  /** The world layer: the project's changes to the world, kept here for the tracked list */
  layer: WorldLayer;
  /** The project's new NPCs, objects and items, as edited here (sent after a pause, like quest edits) */
  entities: ProjectEntities;
  /** Moves each time the store is replaced from the main process (an undo, a load), for the views to redraw */
  entitiesSeq: number;

  loadProfiles(): Promise<void>;
  /** Launch: lists the saved profiles and which one to offer. Connecting is always the user's click. */
  start(): Promise<void>;
  connect(input: ProfileSave): Promise<void>;
  /** Connects with a saved profile and its stored password. */
  connectProfile(profileId: number): Promise<void>;
  /**
   * Saves the draft's rows (world, then dev, then removes a dev row the user removed) and reloads the
   * profiles. A failure part way still returns what was saved (`saved`/`original`, null when
   * nothing was), so a retry updates those rows.
   */
  saveConnection(
    draft: ConnectionDraft,
    original: ConnectionDraft,
  ): Promise<
    | { ok: true; worldId: number; saved: ConnectionDraft }
    | { ok: false; error: string; saved: ConnectionDraft | null; original: ConnectionDraft | null }
  >;
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
  /** Replaces the project's NPCs, objects and items here at once, and sends them after the pause */
  setEntities(next: ProjectEntities): void;
  /** Sends the project's NPCs, objects and items now if an edit is waiting */
  flushEntities(): Promise<void>;
  /** Reads the project's NPCs, objects and items from the main process */
  loadEntities(): Promise<void>;
  /** Reads the world layer from the main process */
  loadLayer(): Promise<void>;
  /** Keeps a layer the 3D view or a revert produced */
  setLayer(layer: WorldLayer): void;
  /**
   * Deletes one of the project's NPCs, objects or items, emptying every giver card that named it, as one
   * undo step; the open quest shows the cards as they now are. Returns the error to show, or null.
   */
  deleteEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<string | null>;
  /**
   * Makes a new NPC, object or item with a fresh ID, attached to no quest (a quest uses it by naming
   * it), and sends it at once so it is its own undo step before an editor opens on it
   */
  createEntity(kind: 'npc' | 'object' | 'item', preset: Partial<CustomNpc> | Partial<CustomObject> | Partial<CustomItem>): Promise<{ entry: number } | { error: string }>;
  /**
   * Brings an NPC, object or item the database already has into the store, read as the database has it,
   * and sends it at once as its own undo step; one the store has already is left as it is
   */
  adoptEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<{ entry: number } | { error: string }>;
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
  /** Writes the project patch (its new NPCs, objects, items and world changes) that the quest needs first */
  exportProject(): Promise<void>;
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
  /** Sends what is pending, then puts the last change anywhere in the project back */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Undoes or redoes to stand just after a step of the history (0: before every step) */
  jumpTo(stepId: number): Promise<void>;
  /** Runs `work` as one step of the history: everything it changes, and the quest edit it leaves pending, is undone together */
  historyStep(work: () => Promise<void>, label?: string, where?: StepPlace): Promise<void>;
  /**
   * Starts a new quest given and taken back by an NPC, after `previous` in its chain when that is set,
   * as one step of the history
   */
  newQuestFrom(giver: { entry: number; name: string }, previous: number | null): Promise<void>;
  setHistory(list: HistoryList): void;
  /**
   * Holds undo back while a change is on its way to the project (a 3D gesture waiting for the floor):
   * an undo waits for it, so it takes that change back and not the one before. Returns the release
   */
  holdHistory(): () => void;
  dismissHistoryNote(): void;
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
  // An edit to the project's NPCs waiting to be sent
  let entitiesTimer: ReturnType<typeof setTimeout> | null = null;
  let entitiesPending = false;
  let entitiesSeq = 0;
  // Guards against an older, slower `search`/`openQuest` response landing after a newer one.
  let searchToken = 0;
  let openToken = 0;
  let nodesToken = 0;
  // Each read of the project state is numbered when it is asked for; only the newest is kept, so a
  // read waiting on the graph cannot put back an unsaved marker a later read has cleared
  let projectToken = 0;
  const readProject = async (): Promise<{ token: number; result: Result<ProjectState> }> => {
    const token = ++projectToken;
    return { token, result: await api.projectState() };
  };
  // StrictMode runs effects twice in development; launch must still connect only once.
  let started = false;
  // The world layers an undo hands the views are counted, never from zero again, so a view that saw
  // one count in an earlier project still sees the next
  let layerSeq = 0;
  // Changes on their way to the project, which an undo waits for
  const holds = new Set<Promise<void>>();
  // Steps run one after another, so two that overlap (a paste during a drag) stay two steps
  let stepChain: Promise<void> = Promise.resolve();
  // Edits to the open quest made while an undo is on its way: kept on top of what the undo hands back
  let lateEdits: Map<string, FieldValue> | null = null;
  const hold = (): (() => void) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    holds.add(held);
    return () => {
      holds.delete(held);
      release();
    };
  };
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
    startupProfileId: null,
    summary: null,
    connection: 0,
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
    projectPatch: null,
    exportError: null,
    hasDevProfile: false,
    pendingApply: null,
    appliedCount: null,
    links: null,
    history: { steps: [], current: 0, saved: 0 },
    historyNote: null,
    worldLayer: null,
    layer: EMPTY_WORLD,
    entities: structuredClone(EMPTY_ENTITIES),
    entitiesSeq: 0,

    async loadProfiles() {
      const result = await api.listProfiles();
      if (result.ok) {
        set({ profiles: result.value, hasDevProfile: result.value.some((p) => p.role === 'dev') });
      }
    },

    async start() {
      if (started) return;
      started = true;
      // Before the profiles, so the login screen fills in with the right one the first time.
      const startup = await api.startupProfile();
      if (startup.ok) set({ startupProfileId: startup.value });
      await get().loadProfiles();
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
      set((s) => ({ summary, error: null, screen: 'pick', connection: s.connection + 1 }));
      await loadHistory();
      await get().loadEntities();
      await get().loadLayer();
    },

    async saveConnection(draft, original) {
      const saves = draftToSaves(draft, original);
      const world = await api.saveProfile(saves.world);
      if (!world.ok) return { ok: false, error: world.error.message, saved: null, original: null };
      // From here on the world row is saved: a later failure says so, and hands back the draft with
      // the saved IDs, keeping the original dev row so a retry still removes a replaced one.
      const partly = async (error: string, devRecord: ProfileRecord | null) => {
        const saved = savedDraft(draft, world.value, devRecord);
        const kept = devRecord ? saved.dev : draft.dev;
        await get().loadProfiles();
        return {
          ok: false as const,
          error,
          saved: { world: saved.world, dev: kept },
          original: { world: saved.world, dev: original.dev },
        };
      };
      let devRecord: ProfileRecord | null = null;
      if (saves.dev) {
        const dev = await api.saveProfile(saves.dev);
        if (!dev.ok) return await partly(`The world database was saved, but the dev database was not: ${dev.error.message}`, null);
        devRecord = dev.value;
      }
      if (saves.removeDevId !== null) {
        const removed = await api.deleteProfile(saves.removeDevId);
        if (!removed.ok) {
          return await partly(`The connection was saved, but the old dev database could not be removed: ${removed.error.message}`, devRecord);
        }
      }
      await get().loadProfiles();
      return { ok: true, worldId: world.value.id, saved: savedDraft(draft, world.value, devRecord) };
    },

    async reconnect(profileId) {
      // Pending edits are written first, so switching databases cannot lose one.
      await get().flushAll();
      // An edit that could not be saved would be lost when the quest closes: stay, and say why.
      if (get().dirty) return get().error ?? 'Your last edit could not be saved, so the connection was not changed.';
      const connected = await api.connect(profileId);
      if (!connected.ok) return connected.error.message;
      const summary = connected.value;
      // Nothing read from the old database may outlive it: the open quest and all that came with it.
      const closed = {
        open: null,
        dirty: false,
        links: null,
        openPanel: null,
        issues: [],
        results: [],
        preview: null,
        exportResult: null,
        projectPatch: null,
        exportError: null,
        pendingApply: null,
        appliedCount: null,
      };
      // The session has already switched, so a blocked database leaves the editor for the login screen.
      if (summary.blocking) {
        set({ ...blockedBy(summary), ...closed });
        return null;
      }
      set((s) => ({ summary, error: null, screen: 'pick', connection: s.connection + 1, ...closed }));
      // The canvas's links, starts and issue counts are read from the database just connected.
      await get().loadNodes();
      await loadHistory();
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
      lateEdits?.set(fieldId, value);
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

    setEntities(next) {
      set({ entities: next });
      entitiesPending = true;
      if (entitiesTimer) clearTimeout(entitiesTimer);
      entitiesTimer = setTimeout(() => {
        entitiesTimer = null;
        void get().flushEntities();
      }, saveDelayMs);
    },

    async flushEntities() {
      if (entitiesTimer) clearTimeout(entitiesTimer);
      entitiesTimer = null;
      if (!entitiesPending) return;
      entitiesPending = false;
      const sent = await api.putProjectEntities(get().entities);
      if (!sent.ok) {
        set({ error: sent.error.message });
        // What the main process holds is the truth: the edit it refused is not kept here
        await get().loadEntities();
        await get().loadLayer();
        return;
      }
      // A spawn taken off an NPC or object left its spawn group
      await get().loadLayer();
      await get().loadProjectState();
    },

    async loadLayer() {
      const read = await api.worldLayer();
      if (read.ok) set({ layer: read.value });
    },

    setLayer(layer) {
      set({ layer });
    },

    async loadEntities() {
      const read = await api.projectEntities();
      if (read.ok) set({ entities: read.value, entitiesSeq: ++entitiesSeq });
    },

    async deleteEntity(kind, entry) {
      await get().flushAll();
      const result = await api.deleteEntity(kind, entry);
      if (!result.ok) {
        set({ error: result.error.message });
        return result.error.message;
      }
      set({ entities: result.value.entities, entitiesSeq: ++entitiesSeq });
      // Its spawns left their spawn groups in the same step
      await get().loadLayer();
      const open = get().open;
      const mine = open ? result.value.quests.find((q) => q.questId === open.questId) : undefined;
      if (open && mine) set({ open: { ...open, aggregate: mine.aggregate }, dirty: false });
      if (result.value.quests.length > 0) await get().loadNodes();
      else await get().loadProjectState();
      return null;
    },

    async createEntity(kind, preset) {
      await get().flushEntities();
      const allocated = await api.allocateIds(kind === 'npc' ? 'creature' : kind === 'object' ? 'gameobject' : 'item', 1);
      if (!allocated.ok) return { error: allocated.error.message };
      const entry = allocated.value[0];
      if (entry === undefined) return { error: 'No free ID could be found.' };
      const now = get().entities;
      const next: ProjectEntities =
        kind === 'npc'
          ? { ...now, npcs: [...now.npcs, { ...newNpc(entry), ...(preset as Partial<CustomNpc>), entry }] }
          : kind === 'object'
            ? { ...now, objects: [...now.objects, { ...newObject(entry), ...(preset as Partial<CustomObject>), entry }] }
            : { ...now, items: [...now.items, { ...newItem(entry), ...(preset as Partial<CustomItem>), entry }] };
      set({ entities: next });
      const sent = await api.putProjectEntities(next);
      if (!sent.ok) {
        await get().loadEntities();
      await get().loadLayer();
        return { error: sent.error.message };
      }
      await get().loadProjectState();
      return { entry };
    },

    async adoptEntity(kind, entry) {
      await get().flushEntities();
      const listOf = (e: ProjectEntities) => (kind === 'npc' ? e.npcs : kind === 'object' ? e.objects : e.items);
      if (listOf(get().entities).some((x) => x.entry === entry)) return { entry };
      const read = await api.readExistingEntity(kind, entry);
      if (!read.ok) return { error: read.error.message };
      const now = get().entities;
      // Read while it was waiting: another adopt may have brought it in meanwhile
      if (listOf(now).some((x) => x.entry === entry)) return { entry };
      const next: ProjectEntities =
        kind === 'npc'
          ? { ...now, npcs: [...now.npcs, read.value as CustomNpc] }
          : kind === 'object'
            ? { ...now, objects: [...now.objects, read.value as CustomObject] }
            : { ...now, items: [...now.items, read.value as CustomItem] };
      set({ entities: next });
      const sent = await api.putProjectEntities(next);
      if (!sent.ok) {
        await get().loadEntities();
        await get().loadLayer();
        return { error: sent.error.message };
      }
      await get().loadProjectState();
      return { entry };
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
      const [nodesResult, read] = await Promise.all([api.listNodes(), readProject()]);
      if (token !== nodesToken) return;
      if (nodesResult.ok) set({ nodes: nodesResult.value });
      const projectResult = read.result;
      if (projectResult.ok && read.token === projectToken) {
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
      set({ exportError: null, projectPatch: null });
      const result = await api.exportQuest(open.questId);
      if (result.ok) set({ exportResult: result.value, exportError: null });
      else set({ exportResult: null, exportError: result.error });
      // Marking a quest exported is a change to the project.
      if (result.ok) await get().loadProjectState();
    },

    async exportProject() {
      await get().flushSave();
      const result = await api.exportProject();
      if (result.ok) set({ projectPatch: { applyPath: result.value.applyPath, revertPath: result.value.revertPath }, exportError: null });
      else set({ projectPatch: null, exportError: result.error });
    },

    async prepareApply() {
      const { open } = get();
      if (!open) return;
      await get().flushSave();
      set({ exportError: null });
      const result = await api.exportQuest(open.questId);
      if (result.ok) {
        const { projectSql, sql } = result.value;
        set({ exportResult: result.value, exportError: null, pendingApply: { sql: projectSql ? `${projectSql}\n${sql}` : sql } });
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
      const { token, result } = await readProject();
      if (result.ok && token === projectToken) set({ project: result.value });
    },

    async flushAll() {
      await get().flushSave();
      await get().flushEntities();
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
      // An older project's quest NPCs were moved into the project; what that had to say is shown
      if (result.value.warnings && result.value.warnings.length > 0) set({ error: result.value.warnings.join(' ') });
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

    undo: () => travel(() => api.historyUndo()),
    redo: () => travel(() => api.historyRedo()),
    jumpTo: (stepId) => travel(() => api.historyJump(stepId)),

    async historyStep(work, label, where) {
      const release = hold();
      const step = async (): Promise<void> => {
        // A quest edit typed before the step began is a step of its own
        await get().flushSave();
        await get().flushEntities();
        const begun = await api.historyBegin(label, where);
        if (!begun.ok) {
          await work();
          return;
        }
        try {
          await work();
          // A quest edit the work made is still on the debounce: it belongs to this step
          await get().flushSave();
          await get().flushEntities();
        } finally {
          await api.historyEnd(begun.value);
        }
      };
      const mine = stepChain.then(step, step);
      stepChain = mine.catch(() => undefined);
      try {
        await mine;
      } finally {
        release();
      }
    },

    holdHistory: () => hold(),

    async newQuestFrom(giver, previous) {
      const label = `${previous === null ? 'New' : 'Next'} quest from ${giver.name}`;
      await get().historyStep(async () => {
        const was = get().open?.questId;
        await get().newQuest();
        const made = get().open;
        // No new quest (it failed, or another open overtook it): the open one is not to be touched
        if (!made || made.questId === was) return;
        const target = { kind: 'creature' as const, id: giver.entry };
        for (const role of ['giver', 'ender'] as const) {
          const edits = toggleRole(get().open!.aggregate.values, role, target, true) ?? {};
          for (const [fieldId, value] of Object.entries(edits)) get().setValue(fieldId, value);
        }
        if (previous !== null) get().setValue('quest_template_addon.PrevQuestID', previous);
      }, label);
    },

    setHistory(list) {
      set({ history: list });
      // A step closed after its changes (a gesture's end) can be what leaves the project unsaved
      void get().loadProjectState();
    },

    dismissHistoryNote() {
      set({ historyNote: null });
    },
  }));

  async function loadHistory(): Promise<void> {
    const list = await api.historyList();
    if (list.ok) store.setState({ history: list.value });
  }

  /**
   * An undo, redo or jump. What is pending goes first, so the undo takes back the newest change and
   * not the one before it; if that could not be saved, nothing is undone.
   */
  async function travel(call: () => Promise<Result<HistoryResult>>): Promise<void> {
    while (holds.size > 0) await Promise.all([...holds]);
    await store.getState().flushAll();
    if (store.getState().dirty) return;
    lateEdits = new Map();
    try {
      const result = await call();
      if (!result.ok) {
        store.setState({ error: result.error.message });
        return;
      }
      await applyHistory(result.value);
    } finally {
      // An undo that did not touch the open quest leaves its late edits where they are, already sent
      lateEdits = null;
    }
  }

  /** Shows the project as the undo left it: the open quest, the graph, the world layer, the name */
  async function applyHistory(result: HistoryResult): Promise<void> {
    const state = store.getState();
    store.setState({ history: result.history });
    const open = state.open;
    const mine = open ? result.quests.find((q) => q.questId === open.questId) : undefined;
    if (open && mine) {
      if (mine.aggregate === null) {
        store.setState({ screen: 'pick', open: null, dirty: false, links: null, openPanel: null });
      } else {
        const late = lateEdits;
        lateEdits = null;
        store.setState({ open: { ...open, aggregate: mine.aggregate }, dirty: false, exportResult: null });
        // An edit made while the undo was on its way goes on top, and is sent as a change of its own
        if (late) for (const [fieldId, value] of late) store.getState().setValue(fieldId, value);
        // The Changes panel compares the quest as it was; it is read again for the quest as it now is
        if (store.getState().preview !== null) await store.getState().loadPreview();
        const issues = await api.validate(open.questId);
        if (issues.ok) store.setState({ issues: issues.value });
        await store.getState().loadLinks();
      }
    }
    if (result.world) {
      const world = result.world;
      store.setState({ worldLayer: { layer: world, seq: ++layerSeq }, layer: world });
    }
    if (result.entities) store.setState({ entities: result.entities, entitiesSeq: ++entitiesSeq });
    if (result.step) {
      // A quest the undo took out of the project cannot be shown: opening it would put it back
      const where = result.step.where;
      const gone = where && 'questId' in where && result.quests.some((q) => q.questId === where.questId && q.aggregate === null);
      store.setState({
        historyNote: { text: `${result.direction === 'undo' ? 'Undid' : 'Redid'}: ${result.step.label}`, where: gone ? null : where, skipped: result.skipped },
      });
    }
    if (result.positions || result.quests.length > 0) await store.getState().loadNodes();
    else await store.getState().loadProjectState();
  }

  /**
   * A different project is open: nothing the editor or the canvas holds belongs to it any more.
   * Queued moves and viewport changes were for the old canvas, so they are dropped, not sent.
   */
  async function switchedProject(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (entitiesTimer) {
      clearTimeout(entitiesTimer);
      entitiesTimer = null;
    }
    entitiesPending = false;
    pendingMoves.clear();
    pendingViewport = null;
    store.setState({
      open: null,
      screen: 'pick',
      links: null,
      dirty: false,
      preview: null,
      exportResult: null,
      projectPatch: null,
      exportError: null,
      historyNote: null,
      worldLayer: null,
      layer: EMPTY_WORLD,
    });
    await store.getState().loadNodes();
    await store.getState().loadEntities();
    await store.getState().loadLayer();
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
