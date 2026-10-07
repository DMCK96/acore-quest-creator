import { open, readdir, readFile } from 'node:fs/promises';
import { openClient, type ClientFiles, type ClientFs } from '../core/client/client-files';
import type { ClientStatus } from '../shared/ipc';

export const nodeClientFs: ClientFs = {
  async list(dir) {
    try {
      return (await readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return [];
    }
  },
  async open(path) {
    const handle = await open(path, 'r');
    const { size, mtimeMs } = await handle.stat();
    return {
      size,
      modified: Math.round(mtimeMs),
      async read(offset, length) {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  },
  async readText(path) {
    try {
      return await readFile(path, 'latin1');
    } catch {
      return null;
    }
  },
};

/**
 * The game client's archives, opened on first use and kept until the folder changes. The 3D view
 * reads its files through `awe-wow://`, and the connection screen shows what was opened.
 */
export interface GameClient {
  setDir(dir: string | null): void;
  /** The client folder opened (now, if not yet): its archives and what went wrong; null without one. */
  status(): Promise<ClientStatus | null>;
  /** A file from the client's archives, by its client path (any case or slash); null without a client or when it has none. */
  file(path: string): Promise<Uint8Array | null>;
}

interface Opened {
  files: ClientFiles | null;
  problem: string | null;
  problems: string[];
}

export function createGameClient(deps: { fs: ClientFs; log?: (message: string) => void }): GameClient {
  const log = deps.log ?? (() => {});
  let dir: string | null = null;
  /** The client being opened for `dir`, with the reason when it could not be. */
  let opening: Promise<Opened> | null = null;
  const warned = new Set<string>();
  const warnOnce = (key: string, text: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    log(text);
  };

  function ensureOpen(): Promise<Opened> {
    if (!dir) return Promise.resolve({ files: null, problem: null, problems: [] });
    if (!opening) {
      const asked = dir;
      const failed = (problem: string): Opened => {
        warnOnce(`client:${asked}`, problem);
        return { files: null, problem, problems: [] };
      };
      const problems: string[] = [];
      opening = openClient(asked, deps.fs, (text) => {
        problems.push(text);
        log(text);
      }).then(
        (files) => (files ? { files, problem: null, problems } : failed('No game archives were found in this folder. Choose the folder holding Wow.exe, or its Data folder.')),
        (error: unknown) => failed(`The folder could not be opened: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    return opening;
  }

  return {
    setDir(next) {
      const normalised = next && next.trim() !== '' ? next : null;
      if (normalised === dir) return;
      const old = opening;
      opening = null;
      void old?.then(({ files }) => files?.close()).catch(() => {});
      dir = normalised;
    },
    async status() {
      const asked = dir;
      if (!asked) return null;
      const { files, problem, problems } = await ensureOpen();
      return { dir: asked, archives: files?.archives ?? [], problems: files ? problems : problem ? [problem] : [] };
    },
    async file(path) {
      try {
        return (await ensureOpen()).files?.read(path) ?? null;
      } catch (error) {
        console.warn(`Client file ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
  };
}
