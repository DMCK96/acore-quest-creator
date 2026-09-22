import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { FieldValue } from '@core/registry/types';
import type { Issue } from '@core/validate/validate';
import type { QuestSummary } from '@core/db/world-db';
import type { Api, ConnectSummary, NodePosition, OpenResult, ProfileInput, ProfileRecord } from '@shared/ipc';

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

  loadProfiles(): Promise<void>;
  connect(input: ProfileInput & { id?: number }): Promise<void>;
  search(text: string): Promise<void>;
  openQuest(id: number, position?: NodePosition): Promise<void>;
  newQuest(position?: NodePosition): Promise<void>;
  setValue(fieldId: string, value: FieldValue): void;
  setActiveView(v: ActiveView): void;
  flushSave(): Promise<void>;
  backToPicker(): void;
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

    async loadProfiles() {
      const result = await api.listProfiles();
      if (result.ok) set({ profiles: result.value });
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
  }));

  return store;
}

function dedupeProfiles(profiles: ProfileRecord[], profile: ProfileRecord): ProfileRecord[] {
  const rest = profiles.filter((p) => p.id !== profile.id);
  return [...rest, profile];
}
