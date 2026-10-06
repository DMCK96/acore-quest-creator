import type { Viewport } from './quests';
import type { Result } from './result';

/** The open project as the renderer sees it: what the title bar and the Project modal show. */
export interface ProjectState {
  name: string;
  /** The file the project was last saved to or opened from; null while it has never been saved. */
  filePath: string | null;
  /** Changes since the last save. */
  dirty: boolean;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
  viewport: Viewport;
}

/** A project file opened or saved lately; `exists` is false once the file has gone. */
export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
  exists: boolean;
}

/** New, Open and Save can each be cancelled by the user part way; `done` says whether it happened. */
export interface ProjectActionResult {
  done: boolean;
  /** What opening an older project had to say about moving its quests' NPCs into the project */
  warnings?: string[];
}

/** Unsaved work a crash left behind, offered back on the next launch. */
export interface RecoveryEntry {
  id: string;
  name: string;
  /** The file the work belonged to, or null when it had never been saved. */
  recoveredFrom: string | null;
  writtenAt: string;
  questCount: number;
  /** The file could not be read; it can only be discarded. */
  damaged: boolean;
}

/** The project file: new, open, save, rename, recent projects and recovery */
export interface ProjectApi {
  projectState(): Promise<Result<ProjectState>>;
  renameProject(name: string): Promise<Result<true>>;
  /** Asks about unsaved changes first; `done` is false when the user cancelled. */
  newProject(name: string): Promise<Result<ProjectActionResult>>;
  /** Without a path, shows the open dialog. */
  openProject(path?: string): Promise<Result<ProjectActionResult>>;
  saveProject(): Promise<Result<ProjectActionResult>>;
  saveProjectAs(): Promise<Result<ProjectActionResult>>;
  recentProjects(): Promise<Result<RecentProject[]>>;
  forgetRecent(path: string): Promise<Result<true>>;
  recoveries(): Promise<Result<RecoveryEntry[]>>;
  restoreRecovery(id: string): Promise<Result<true>>;
  discardRecovery(id: string): Promise<Result<true>>;
}
