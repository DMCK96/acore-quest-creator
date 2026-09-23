import { join } from 'node:path';
import type { RecoveryEntry } from '../../shared/ipc';
import {
  parseProject,
  ProjectFileError,
  serializeProject,
  writeFileAtomic,
  type ProjectDocument,
  type ProjectFs,
} from './project-file';
import type { ProjectSession } from './session';

export const RECOVERY_SUFFIX = '.aqc-recovery';

/**
 * Copies of unsaved work, written on a timer while the project is dirty. A clean save or quit
 * deletes the copy, so any file still here at launch was left by a crash.
 */
export interface Recovery {
  /** Writes a copy when the session has changes not yet copied. Returns whether it wrote. */
  tick(session: ProjectSession): Promise<boolean>;
  clear(sessionId: string): Promise<void>;
  list(): Promise<RecoveryEntry[]>;
  read(id: string): Promise<{ doc: ProjectDocument; recoveredFrom: string | null }>;
}

interface RecoveryFile {
  recovery: 1;
  recoveredFrom: string | null;
  writtenAt: string;
  project: unknown;
}

export function createRecovery(deps: { dir: string; fs: ProjectFs; now(): Date }): Recovery {
  const { dir, fs } = deps;
  const written = new Map<string, number>();
  const fileOf = (id: string): string => join(dir, `${id}${RECOVERY_SUFFIX}`);

  const load = async (id: string): Promise<{ doc: ProjectDocument; recoveredFrom: string | null; writtenAt: string }> => {
    try {
      const raw = JSON.parse(await fs.readFile(fileOf(id))) as RecoveryFile;
      const doc = parseProject(JSON.stringify(raw.project));
      return { doc, recoveredFrom: raw.recoveredFrom ?? null, writtenAt: String(raw.writtenAt) };
    } catch {
      throw new ProjectFileError('corrupt', 'The recovery file is damaged.');
    }
  };

  return {
    async tick(session) {
      if (!session.dirty() || written.get(session.id()) === session.revision()) return false;
      const content: RecoveryFile = {
        recovery: 1,
        recoveredFrom: session.filePath(),
        writtenAt: deps.now().toISOString(),
        project: JSON.parse(serializeProject(session.toDocument())),
      };
      await fs.ensureDir(dir);
      await writeFileAtomic(fs, fileOf(session.id()), JSON.stringify(content, null, 2));
      written.set(session.id(), session.revision());
      return true;
    },
    async clear(sessionId) {
      written.delete(sessionId);
      await fs.remove(fileOf(sessionId));
    },
    async list() {
      const names = (await fs.listDir(dir)).filter((n) => n.endsWith(RECOVERY_SUFFIX));
      const entries: RecoveryEntry[] = [];
      for (const name of names) {
        const id = name.slice(0, -RECOVERY_SUFFIX.length);
        try {
          const { doc, recoveredFrom, writtenAt } = await load(id);
          entries.push({ id, name: doc.name, recoveredFrom, writtenAt, questCount: doc.quests.length, damaged: false });
        } catch {
          entries.push({ id, name: '', recoveredFrom: null, writtenAt: '', questCount: 0, damaged: true });
        }
      }
      return entries.sort((a, b) =>
        a.damaged !== b.damaged ? (a.damaged ? 1 : -1) : b.writtenAt.localeCompare(a.writtenAt),
      );
    },
    async read(id) {
      const { doc, recoveredFrom } = await load(id);
      return { doc, recoveredFrom };
    },
  };
}
