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
  ProfileInput,
  ProfileRecord,
  Viewport,
} from '@shared/ipc';

/** The eight groups a quest is edited through, plus the two read-only side panels. */
export type EditorGroup =
  | 'identity'
  | 'story'
  | 'objectives'
  | 'rewards'
  | 'availability'
  | 'map';

export type ActiveView = EditorGroup | 'unmodelled' | 'changes';

export interface AppState {
  screen: 'connect' | 'pick' | 'edit';
  profiles: ProfileRecord[];
  summary: ConnectSummary | null;
  error: string | null;
  results: QuestSummary[];
  open: OpenResult | null;
  activeView: ActiveView;
  issues: Issue[];
  saving: boolean;
  dirty: boolean;
  nodes: CanvasNode[];
  viewport: Viewport;
  preview: Difference[] | null;
  exportResult: ExportResult | null;
  exportError: ApiError | null;
  hasDevProfile: boolean;
  pendingApply: { sql: string } | null;
  appliedCount: number | null;

  loadProfiles(): Promise<void>;
  connect(input: ProfileInput & { id?: number }): Promise<void>;
  search(text: string): Promise<void>;
  openQuest(id: number, position?: NodePosition): Promise<void>;
  newQuest(position?: NodePosition): Promise<void>;
  setValue(fieldId: string, value: FieldValue): void;
  setActiveView(v: ActiveView): void;
  flushSave(): Promise<void>;
  backToPicker(): void;
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
}

export type AppStore = UseBoundStore<StoreApi<AppState>>;

const missingTablesMessage = (tables: string[]): string =>
  `This database is missing required tables: ${tables.join(', ')}`;

/**
 * The whole renderer's state, built once per `<App>` around one `Api`.
 *
 * `opts.saveDelayMs` (default 400) is the debounce before an edit is written as a draft; `0` in
 * tests still defers to a timer (via `setTimeout`), so `flushSave` is what tests call to force it.
 */
export function createAppStore(api: Api, opts: { saveDelayMs?: number } = {}): AppStore {
  const saveDelayMs = opts.saveDelayMs ?? 400;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Guards against an older, slower `search`/`openQuest` response landing after a newer one.
  let searchToken = 0;
  let openToken = 0;
  let nodesToken = 0;
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
    activeView: 'identity',
    issues: [],
    saving: false,
    dirty: false,
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    preview: null,
    exportResult: null,
    exportError: null,
    hasDevProfile: false,
    pendingApply: null,
    appliedCount: null,

    async loadProfiles() {
      const result = await api.listProfiles();
      if (result.ok) {
        set({ profiles: result.value, hasDevProfile: result.value.some((p) => p.role === 'dev') });
      }
    },

    async connect(input) {
      const saved = await api.saveProfile(input);
      if (!saved.ok) {
        set({ error: saved.error.message, screen: 'connect' });
        return;
      }
      const profile = saved.value;
      set((s) => ({ profiles: dedupeProfiles(s.profiles, profile) }));
      const connected = await api.connect(profile.id);
      if (!connected.ok) {
        set({ error: connected.error.message, screen: 'connect' });
        return;
      }
      const summary = connected.value;
      if (summary.blocking) {
        set({ error: missingTablesMessage(summary.drift.missingTables), screen: 'connect', summary });
        return;
      }
      set({ summary, error: null, screen: 'pick' });
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
      if (token !== openToken) return;
      if (!result.ok) {
        set({ error: result.error.message, screen: 'pick' });
        return;
      }
      set({
        open: result.value,
        issues: result.value.issues,
        activeView: 'identity',
        screen: 'edit',
        error: null,
        dirty: false,
      });
      await get().loadNodes();
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
        activeView: 'identity',
        screen: 'edit',
        error: null,
        dirty: false,
      });
      await get().loadNodes();
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

    setActiveView(v) {
      set({ activeView: v });
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { open } = get();
      if (!open) return;
      set({ saving: true });
      const saved = await api.saveDraft(open.aggregate);
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
    },

    backToPicker() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      set({ screen: 'pick', open: null, error: null, dirty: false });
    },

    async loadNodes() {
      const token = ++nodesToken;
      const [nodesResult, projectResult] = await Promise.all([api.listNodes(), api.getProject()]);
      if (token !== nodesToken) return;
      if (nodesResult.ok) set({ nodes: nodesResult.value });
      if (projectResult.ok) {
        lastSavedViewport = projectResult.value.viewport;
        set({ viewport: projectResult.value.viewport });
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

      const tasks: Promise<unknown>[] = [];
      if (moves.length > 0) tasks.push(api.moveNodes(moves));
      if (viewportToSave) {
        lastSavedViewport = viewportToSave;
        tasks.push(api.saveViewport(viewportToSave));
      }
      await Promise.all(tasks);
    },

    async removeNode(questId) {
      const result = await api.removeNode(questId);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ nodes: s.nodes.filter((n) => n.questId !== questId) }));
    },

    async closeEditor() {
      await get().flushSave();
      set({ screen: 'pick', open: null, error: null, dirty: false });
      await get().loadNodes();
    },

    async loadPreview() {
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
  }));

  return store;
}

function dedupeProfiles(profiles: ProfileRecord[], profile: ProfileRecord): ProfileRecord[] {
  const rest = profiles.filter((p) => p.id !== profile.id);
  return [...rest, profile];
}
