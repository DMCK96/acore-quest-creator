import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseQuestXp, QUEST_XP_FILE } from '../core/game/dbc';
import type { ServerDataStatus } from '../shared/ipc';

/**
 * Optional server data: the folder a connection profile names as the server's `DataDir` (or its
 * `dbc` folder directly). Everything read from it only adds to what the app can show, so a folder
 * that is missing, or a file in it that is absent or unreadable, becomes a problem in the status,
 * never a failed connection.
 */

export interface ServerDataFiles {
  /** The file's bytes, found by name in any letter case; null when the folder has no such file. */
  read(dir: string, fileName: string): Promise<Uint8Array | null>;
  isDir(dir: string): Promise<boolean>;
}

export interface ServerData {
  status: ServerDataStatus;
  /** QuestXP.dbc by level, or null when it could not be read. */
  questXp: Map<number, number[]> | null;
}

/** A file of the server data folder: in its `dbc` folder (the folder is the server's `DataDir`), or in the folder itself. */
export async function readServerDataFile(dir: string, fileName: string, files: ServerDataFiles): Promise<Uint8Array | null> {
  return (await files.read(join(dir, 'dbc'), fileName)) ?? (await files.read(dir, fileName));
}

export async function loadServerData(dir: string, files: ServerDataFiles): Promise<ServerData | null> {
  if (dir.trim() === '') return null;
  const status: ServerDataStatus = { dir, loaded: [], problems: [] };
  if (!(await files.isDir(dir))) {
    status.problems.push(`The server data folder ${dir} does not exist.`);
    return { status, questXp: null };
  }

  // `DataDir` holds `dbc/`; accept the `dbc` folder itself as well.
  const read = (name: string): Promise<Uint8Array | null> => readServerDataFile(dir, name, files);

  let questXp: Map<number, number[]> | null = null;
  try {
    const bytes = await read(QUEST_XP_FILE);
    if (bytes) {
      questXp = parseQuestXp(bytes);
      status.loaded.push(QUEST_XP_FILE);
    } else {
      status.problems.push(`${QUEST_XP_FILE} is not in ${dir} or its dbc folder.`);
    }
  } catch (error) {
    status.problems.push(`${QUEST_XP_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { status, questXp };
}

export const nodeServerDataFiles: ServerDataFiles = {
  async read(dir, fileName) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    // A Linux server's files keep their case, a copy made on Windows may not.
    const match = names.find((n) => n.toLowerCase() === fileName.toLowerCase());
    return match ? new Uint8Array(await readFile(join(dir, match))) : null;
  },
  async isDir(dir) {
    try {
      return (await stat(dir)).isDirectory();
    } catch {
      return false;
    }
  },
};
