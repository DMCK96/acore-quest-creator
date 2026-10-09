import type { FieldValue } from '@core/registry/types';
import type { Issue } from '@core/validate/validate';
import type { NodePosition, OpenResult, QuestLinks } from '@shared/ipc';
import { toggleRole } from '@core/modules/quest-roles';
import type { ModuleId } from '@core/modules/model';
import { resetModule } from '@core/modules/catalog';
import type { SliceArgs } from './types';

/** The open quest and its editor: opening and making quests, editing fields and saving them */
export interface QuestSlice {
  open: OpenResult | null;
  /** The module (or the changes view) open in the flow view's side panel. */
  openPanel: ModuleId | 'changes' | 'test' | null;
  /** Optional modules added this session that have nothing in them yet, so they still show. */
  addedModules: ModuleId[];
  issues: Issue[];
  saving: boolean;
  dirty: boolean;
  links: QuestLinks | null;
  /**
   * Loads a quest into the preview and focuses it; false when it failed or a newer open replaced it.
   * `working` opens it only to work on it: the focus (and so the World) stays where it was, and a
   * failed open leaves the screen as it was, on the quest still open.
   */
  openQuest(id: number, position?: NodePosition, options?: { working?: boolean }): Promise<boolean>;
  /** Adds the quest and every quest chained to it to the canvas, then opens the one picked. */
  addQuestChain(id: number, position?: NodePosition): Promise<void>;
  newQuest(position?: NodePosition): Promise<void>;
  setValue(fieldId: string, value: FieldValue): void;
  /** Switches the previewed quest into the module editor. */
  editQuest(): void;
  /** Leaves the editor for the chain canvas, sending any pending edit first; the quest stays previewed. */
  backToChain(): Promise<void>;
  setOpenPanel(p: ModuleId | 'changes' | 'test' | null): void;
  addModule(id: ModuleId): void;
  /** Clears every writable field the module owns and hides it again. */
  removeModule(id: ModuleId): void;
  flushSave(): Promise<void>;
  backToPicker(): Promise<void>;
  closeEditor(): Promise<void>;
  loadLinks(): Promise<void>;
  /**
   * Starts a new quest given and taken back by an NPC, after `previous` in its chain when that is set,
   * as one step of the history
   */
  newQuestFrom(giver: { entry: number; name: string }, previous: number | null): Promise<void>;
}

export function createQuestSlice({ api, kit, set, get }: SliceArgs): QuestSlice {
  return {
    open: null,
    openPanel: null,
    addedModules: [],
    issues: [],
    saving: false,
    dirty: false,
    links: null,
    async openQuest(id, position, options) {
      const token = ++kit.openToken;
      const asked = ++kit.clock;
      const result = position === undefined ? await api.openQuest(id) : await api.openQuest(id, position);
      if (token !== kit.openToken) return false;
      if (!result.ok) {
        set(options?.working ? { error: result.error.message } : { error: result.error.message, screen: 'pick' });
        return false;
      }
      set({
        open: result.value,
        issues: result.value.issues,
        openPanel: null,
        screen: 'preview',
        questsAsked: asked,
        error: null,
        dirty: false,
      });
      if (!options?.working) get().setFocus(id);
      await get().loadNodes();
      await get().loadLinks();
      return true;
    },
    async addQuestChain(id, position) {
      const token = ++kit.openToken;
      const asked = ++kit.clock;
      const result = position === undefined ? await api.addQuestChain(id) : await api.addQuestChain(id, position);
      if (token !== kit.openToken) return;
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
        questsAsked: asked,
        // A chain cut short is still a chain on the canvas, but the user has to know it is not all of it.
        error: truncated ? `Only the first ${questIds.length} quests of this chain were added.` : null,
        dirty: false,
      });
      // The quest picked from the chain is the open one, so the World goes to it as on any open
      get().setFocus(open.questId);
      await get().loadNodes();
      await get().loadLinks();
    },
    async newQuest(position) {
      const token = ++kit.openToken;
      const asked = ++kit.clock;
      const result = position === undefined ? await api.newQuest() : await api.newQuest(position);
      if (token !== kit.openToken) return;
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
        questsAsked: asked,
        error: null,
        dirty: false,
      });
      // The World goes to it as on any open (a quest with nothing placed yet says so)
      get().setFocus(result.value.questId);
      await get().loadNodes();
      await get().loadLinks();
    },
    setValue(fieldId, value) {
      const { open } = get();
      if (!open) return;
      kit.lateEdits?.set(fieldId, value);
      set({
        open: { ...open, aggregate: { ...open.aggregate, values: { ...open.aggregate.values, [fieldId]: value } } },
        dirty: true,
      });
      if (kit.saveTimer) clearTimeout(kit.saveTimer);
      kit.saveTimer = setTimeout(() => {
        kit.saveTimer = null;
        void get().flushSave();
      }, kit.saveDelayMs);
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
      if (kit.saveTimer) {
        clearTimeout(kit.saveTimer);
        kit.saveTimer = null;
        void get().flushSave();
      }
    },
    addModule(id) {
      const { addedModules } = get();
      set({ addedModules: addedModules.includes(id) ? addedModules : [...addedModules, id], openPanel: id });
    },
    removeModule(id) {
      const { open } = get();
      // Advanced kit.holds every rare column of an imported quest; clearing it wholesale is never wanted.
      if (!open || id === 'advanced') return;
      const edits = resetModule(id, open.aggregate.values, open.aggregate.readOnly.map((r) => r.fieldId));
      for (const [fieldId, value] of Object.entries(edits)) get().setValue(fieldId, value);
      set((s) => ({
        addedModules: s.addedModules.filter((m) => m !== id),
        openPanel: s.openPanel === id ? null : s.openPanel,
      }));
    },
    async flushSave() {
      // An AI client's write is on its way: what is pending is sent when it is over
      if (kit.held) return;
      // Only an edit is sent: a quest merely looked at must not mark the project unsaved.
      const pending = kit.saveTimer !== null || get().dirty;
      if (kit.saveTimer) {
        clearTimeout(kit.saveTimer);
        kit.saveTimer = null;
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
        // An edit made while this save was on its way is not in it, and is still to send
        dirty: get().open === open ? false : get().dirty,
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
      get().setFocus(null);
    },
    // A failed save is the one thing that must survive closing: clearing `error` first drops a
    // stale message, and `flushSave` puts a fresh one back if the edit did not reach the project.
    async closeEditor() {
      set({ error: null });
      await get().flushSave();
      set({ screen: 'pick', open: null, dirty: false, links: null });
      get().setFocus(null);
      await get().loadNodes();
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
  };
}
