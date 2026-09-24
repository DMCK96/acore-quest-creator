import type { ClientFs } from '../../src/core/client/client-files';
import { bytesSource } from './mpq-file';

/** A client folder in memory: paths use '/', and folders exist wherever a file sits below them. */
export function memClient(
  files: Record<string, Uint8Array | string>,
  modified: Record<string, number> = {},
): ClientFs & { opened: string[]; closed: string[] } {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const all = new Map(Object.entries(files).map(([k, v]) => [norm(k), typeof v === 'string' ? new TextEncoder().encode(v) : v]));
  const opened: string[] = [];
  const closed: string[] = [];
  return {
    opened,
    closed,
    async list(dir) {
      const prefix = norm(dir) + '/';
      const out = new Map<string, boolean>();
      for (const path of all.keys()) {
        if (!path.startsWith(prefix)) continue;
        const [head, ...rest] = path.slice(prefix.length).split('/');
        out.set(head!, rest.length > 0 || out.get(head!) === true);
      }
      return [...out].map(([name, isDir]) => ({ name, isDir }));
    },
    async open(path) {
      const bytes = all.get(norm(path));
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      opened.push(norm(path));
      return { ...bytesSource(bytes), modified: modified[norm(path)] ?? 0, close: async () => void closed.push(norm(path)) };
    },
    async readText(path) {
      const bytes = all.get(norm(path));
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
  };
}
