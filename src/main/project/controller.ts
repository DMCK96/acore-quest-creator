import type { ProjectActionResult, ProjectState, RecentProject, RecoveryEntry } from '../../shared/ipc';
import type { Store } from '../store/store';
import {
  DEFAULT_PROJECT_NAME,
  InvalidNameError,
  PROJECT_EXTENSION,
  ProjectFileError,
  SaveFailedError,
  defaultProjectMeta,
  parseProject,
  serializeProject,
  writeFileAtomic,
  type ProjectFs,
} from './project-file';
import type { Recovery } from './recovery';
import type { ProjectSession } from './session';

export type UnsavedAnswer = 'save' | 'discard' | 'cancel';

/** The native dialogs, injected so the tests can answer them. */
export interface Dialogs {
  /** Returns the chosen path, or null when cancelled. */
  showSave(suggestedFileName: string): Promise<string | null>;
  showOpen(): Promise<string | null>;
  confirmUnsaved(projectName: string): Promise<UnsavedAnswer>;
}

/**
 * Everything the user does with project files: New, Open, Save, Save As, the recent list and
 * restoring after a crash. The session is only ever replaced once the new content is in hand, so a
 * cancelled dialog or an unreadable file leaves the open project exactly as it was.
 */
export interface ProjectController {
  state(): ProjectState;
  /** Asks about unsaved changes if there are any. True when it is fine to move on. */
  settleUnsaved(): Promise<boolean>;
  newProject(name: string): Promise<ProjectActionResult>;
  open(path?: string): Promise<ProjectActionResult>;
  save(): Promise<ProjectActionResult>;
  saveAs(): Promise<ProjectActionResult>;
  rename(name: string): void;
  recent(): Promise<RecentProject[]>;
  forgetRecent(path: string): void;
  recoveries(): Promise<RecoveryEntry[]>;
  restoreRecovery(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
  /** The app is closing and the user settled any unsaved changes: nothing needs recovering. */
  discardOnQuit(): Promise<void>;
}

// Characters Windows refuses in a file name, plus control characters.
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function suggestedFileName(projectName: string): string {
  const name = projectName.trim() === '' ? DEFAULT_PROJECT_NAME : projectName.trim();
  return `${name.replace(UNSAFE_FILE_CHARS, '_')}.${PROJECT_EXTENSION}`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createProjectController(deps: {
  session: ProjectSession;
  fs: ProjectFs;
  dialogs: Dialogs;
  recovery: Recovery;
  recent: Store['recent'];
  defaultOutputDir: string;
  now(): Date;
}): ProjectController {
  const { session, fs, dialogs, recovery, recent } = deps;

  async function writeTo(path: string): Promise<ProjectActionResult> {
    try {
      await writeFileAtomic(fs, path, serializeProject(session.toDocument()));
    } catch (error) {
      throw new SaveFailedError(`Could not save the project to ${path}: ${messageOf(error)}`);
    }
    session.markSaved(path);
    await recovery.clear(session.id());
    recent.touch(path, session.meta().name, deps.now());
    return { done: true };
  }

  async function saveAs(): Promise<ProjectActionResult> {
    const path = await dialogs.showSave(suggestedFileName(session.meta().name));
    if (path === null) return { done: false };
    return writeTo(path);
  }

  async function save(): Promise<ProjectActionResult> {
    const path = session.filePath();
    return path === null ? saveAs() : writeTo(path);
  }

  async function settleUnsaved(): Promise<boolean> {
    if (!session.dirty()) return true;
    const answer = await dialogs.confirmUnsaved(session.meta().name);
    if (answer === 'cancel') return false;
    if (answer === 'discard') return true;
    return (await save()).done;
  }

  /** Swaps in new content, then drops the recovery copy of what was open before. */
  async function replaceWith(swap: () => void): Promise<void> {
    const oldId = session.id();
    swap();
    await recovery.clear(oldId);
  }

  return {
    state: () => ({ ...session.meta(), filePath: session.filePath(), dirty: session.dirty() }),
    settleUnsaved,
    async newProject(name) {
      const trimmed = name.trim();
      if (trimmed === '') throw new InvalidNameError('A project needs a name.');
      if (!(await settleUnsaved())) return { done: false };
      await replaceWith(() => session.reset(defaultProjectMeta(trimmed, deps.defaultOutputDir)));
      return { done: true };
    },
    async open(given) {
      if (!(await settleUnsaved())) return { done: false };
      const path = given ?? (await dialogs.showOpen());
      if (path === null) return { done: false };
      let text: string;
      try {
        text = await fs.readFile(path);
      } catch (error) {
        throw new ProjectFileError('unreadable', `Could not read ${path}: ${messageOf(error)}`);
      }
      const doc = parseProject(text);
      await replaceWith(() => session.load(doc, path, { dirty: false }));
      recent.touch(path, doc.name, deps.now());
      return { done: true };
    },
    save,
    saveAs,
    rename: (name) => session.rename(name),
    async recent() {
      const entries = recent.list();
      return Promise.all(entries.map(async (e) => ({ ...e, exists: await fs.exists(e.path) })));
    },
    forgetRecent: (path) => recent.forget(path),
    recoveries: () => recovery.list(),
    async restoreRecovery(id) {
      const { doc, recoveredFrom } = await recovery.read(id);
      await replaceWith(() => session.load(doc, recoveredFrom, { dirty: true }));
      await recovery.clear(id);
    },
    discardRecovery: (id) => recovery.clear(id),
    discardOnQuit: () => recovery.clear(session.id()),
  };
}
