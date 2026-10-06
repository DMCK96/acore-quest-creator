import type { Difference } from '@core/roundtrip/compare';
import type { ApiError, ExportResult } from '@shared/ipc';
import type { SliceArgs } from './types';

/** Previewing, exporting and applying the open quest and the project patch */
export interface ExportSlice {
  preview: Difference[] | null;
  exportResult: ExportResult | null;
  /** Where the project patch went when it was exported after a quest's (null until then) */
  projectPatch: { applyPath: string; revertPath: string } | null;
  exportError: ApiError | null;
  pendingApply: { sql: string } | null;
  appliedCount: number | null;
  loadPreview(): Promise<void>;
  exportQuest(): Promise<void>;
  /** Writes the project patch (its new NPCs, objects, items and world changes) that the quest needs first */
  exportProject(): Promise<void>;
  prepareApply(): Promise<void>;
  confirmApply(): Promise<void>;
  cancelApply(): void;
}

export function createExportSlice({ api, set, get }: SliceArgs): ExportSlice {
  return {
    preview: null,
    exportResult: null,
    projectPatch: null,
    exportError: null,
    pendingApply: null,
    appliedCount: null,
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
  };
}
