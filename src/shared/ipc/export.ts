import type { PatchWarning } from '@core/export/build-patch';
import type { Difference } from '@core/roundtrip/compare';
import type { TestCommands } from '@core/testing/gm';
import type { Issue } from '@core/validate/validate';
import type { Result } from './result';

export interface ExportResult {
  path: string;
  sql: string;
  warnings: PatchWarning[];
  issues: Issue[];
  /** How many of the project's new NPCs, objects and items the quest uses: they are in the project patch */
  usesProject: number;
  /** The project patch Apply to dev runs before the quest; null when the project has nothing of its own */
  projectSql: string | null;
}

/** Exporting: the quest and project patches, previewing them, test commands, and applying to the dev database */
export interface ExportApi {
  previewChanges(questId: number): Promise<Result<Difference[]>>;
  /** Writes the project patch (new NPCs, objects, items and world changes) and its revert. */
  exportProject(): Promise<Result<{ applyPath: string; revertPath: string; sql: string; warnings: string[] }>>;
  /** The GM commands to try the quest in game after applying it: reloads, restarts, travel and quest commands. */
  testCommands(questId: number): Promise<Result<TestCommands>>;
  exportQuest(questId: number): Promise<Result<ExportResult>>;
  applyToDev(questId: number, confirm: boolean): Promise<Result<{ statements: number }>>;
}
