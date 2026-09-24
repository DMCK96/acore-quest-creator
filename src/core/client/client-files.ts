import { openMpq, type ByteSource, type MpqArchive } from './mpq';

/**
 * A game client's files, read through its MPQ archives in the order the client loads them: the
 * base archives, the locale's, then the patches by name and the locale's patches last, so a file
 * comes from the highest-priority archive that has it, as in game. Patches in folders below
 * `Data` (Ascension and CoA ship some there) sort among the others by name.
 */

export interface ClientFs {
  /** A folder's entries; empty when it cannot be read. */
  list(dir: string): Promise<{ name: string; isDir: boolean }[]>;
  /** Throws when the file cannot be opened. */
  open(path: string): Promise<ByteSource>;
  readText(path: string): Promise<string | null>;
}

export interface ClientFiles {
  dataDir: string;
  locale: string;
  /** The archives that opened, relative to `dataDir`, lowest priority first. */
  archives: string[];
  /** The archives' names, sizes and times: another value means the client was patched. */
  fingerprint: string;
  read(path: string): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

const BASE = ['common', 'common-2', 'expansion', 'lichking'];
const LOCALE_BASE = ['backup', 'base', 'locale', 'speech', 'expansion-locale', 'expansion-speech', 'lichking-locale', 'lichking-speech'];
const LOCALE_FOLDER = /^[a-z]{2}[A-Z]{2}$/;

interface Ranked {
  path: string;
  group: number;
  /** Within the group: a known name's place, or a patch suffix. */
  key: string | number;
  sub: number;
}

/** The archives the client loads, lowest priority first; `paths` are relative to `Data`, with '/'. */
export function archiveOrder(paths: string[], locale: string): string[] {
  const loc = locale.toLowerCase();
  const ranked: Ranked[] = [];
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length > 2) continue;
    const folder = parts.length === 2 ? parts[0]! : '';
    const lower = parts.at(-1)!.toLowerCase();
    if (!lower.endsWith('.mpq')) continue;
    const stem = lower.slice(0, -4);
    if (folder === '') {
      if (stem === 'patch') ranked.push({ path, group: 2, key: '', sub: 0 });
      else if (stem.startsWith('patch-')) ranked.push({ path, group: 2, key: stem.slice(6).toUpperCase(), sub: 0 });
      else ranked.push({ path, group: 0, key: BASE.indexOf(stem), sub: 0 });
    } else if (folder.toLowerCase() === loc) {
      if (stem === `patch-${loc}`) ranked.push({ path, group: 3, key: '', sub: 0 });
      else if (stem.startsWith(`patch-${loc}-`)) ranked.push({ path, group: 3, key: stem.slice(`patch-${loc}-`.length).toUpperCase(), sub: 0 });
      else if (!stem.startsWith('patch')) ranked.push({ path, group: 1, key: LOCALE_BASE.indexOf(stem.endsWith(`-${loc}`) ? stem.slice(0, -loc.length - 1) : stem), sub: 0 });
    } else if (!LOCALE_FOLDER.test(folder) && (stem === 'patch' || stem.startsWith('patch-'))) {
      ranked.push({ path, group: 2, key: stem === 'patch' ? '' : stem.slice(6).toUpperCase(), sub: 1 });
    }
  }
  const compare = (a: Ranked, b: Ranked): number => {
    if (a.group !== b.group) return a.group - b.group;
    if (typeof a.key === 'number' && typeof b.key === 'number') {
      // Unknown names (-1) come first, by name.
      if (a.key !== b.key) return a.key - b.key;
    } else if (a.key !== b.key) {
      return String(a.key) < String(b.key) ? -1 : 1;
    }
    if (a.sub !== b.sub) return a.sub - b.sub;
    return a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0;
  };
  return ranked.sort(compare).map((r) => r.path);
}

const isMpq = (name: string): boolean => name.toLowerCase().endsWith('.mpq');
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function openClient(dir: string, fs: ClientFs, onProblem?: (message: string) => void): Promise<ClientFiles | null> {
  const root = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  let dataDir: string;
  let clientDir: string;
  if ((await fs.list(`${root}/Data`)).length > 0) {
    dataDir = `${root}/Data`;
    clientDir = root;
  } else if ((await fs.list(root)).some((e) => !e.isDir && isMpq(e.name))) {
    dataDir = root;
    clientDir = root.slice(0, Math.max(0, root.lastIndexOf('/')));
  } else {
    return null;
  }

  const config = await fs.readText(`${clientDir}/WTF/Config.wtf`);
  const locale = /SET\s+locale\s+"([A-Za-z]{4})"/i.exec(config ?? '')?.[1] ?? 'enUS';

  const found: string[] = [];
  for (const entry of await fs.list(dataDir)) {
    if (!entry.isDir) {
      if (isMpq(entry.name)) found.push(entry.name);
      continue;
    }
    for (const inner of await fs.list(`${dataDir}/${entry.name}`)) if (!inner.isDir && isMpq(inner.name)) found.push(`${entry.name}/${inner.name}`);
  }

  const opened: { path: string; mpq: MpqArchive; stamp: string }[] = [];
  for (const path of archiveOrder(found, locale)) {
    let source: ByteSource | null = null;
    try {
      source = await fs.open(`${dataDir}/${path}`);
      opened.push({ path, mpq: await openMpq(source, path), stamp: `${path}:${source.size}:${source.modified ?? 0}` });
    } catch (error) {
      await source?.close?.().catch(() => {});
      onProblem?.(`${path} could not be opened: ${message(error)}`);
    }
  }
  if (opened.length === 0) return null;

  // Highest priority first, for lookups.
  const byPriority = [...opened].reverse();
  const reported = new Set<string>();
  return {
    dataDir,
    locale,
    archives: opened.map((o) => o.path),
    fingerprint: opened.map((o) => o.stamp).join('|'),
    async read(path) {
      for (const { path: archive, mpq } of byPriority) {
        const entry = mpq.find(path);
        if (entry === 'deleted') return null;
        if (!entry) continue;
        try {
          return await mpq.read(entry, path);
        } catch (error) {
          const key = path.toLowerCase();
          if (!reported.has(key)) {
            reported.add(key);
            onProblem?.(`${path} in ${archive} could not be read: ${message(error)}`);
          }
          return null;
        }
      }
      return null;
    },
    async close() {
      await Promise.all(opened.map((o) => o.mpq.close()));
    },
  };
}
