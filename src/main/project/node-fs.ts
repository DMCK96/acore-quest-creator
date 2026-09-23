import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { ProjectFs } from './project-file';

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** `ProjectFs` on the real disk, UTF-8 throughout. */
export const nodeProjectFs: ProjectFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, text) => writeFile(path, text, 'utf8'),
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
  async listDir(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  },
  async ensureDir(path) {
    await mkdir(path, { recursive: true });
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};
