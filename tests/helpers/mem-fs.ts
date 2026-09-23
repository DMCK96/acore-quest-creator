import type { ProjectFs } from '../../src/main/project/project-file';

type Op = 'read' | 'write' | 'rename';
export interface MemFs extends ProjectFs {
  files: Map<string, string>;
  /** The next call of that kind throws this error, once. */
  failNext: Partial<Record<Op, Error>>;
}

export function memFs(initial: Record<string, string> = {}): MemFs {
  const files = new Map(Object.entries(initial));
  const failNext: MemFs['failNext'] = {};
  const take = (op: Op): void => {
    const e = failNext[op];
    delete failNext[op];
    if (e) throw e;
  };
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
  const base = (p: string) => p.split(/[\\/]/).pop()!;
  return {
    files,
    failNext,
    async readFile(p) { take('read'); const t = files.get(p); if (t === undefined) throw enoent(p); return t; },
    async writeFile(p, t) { take('write'); files.set(p, t); },
    async rename(a, b) { take('rename'); const t = files.get(a); if (t === undefined) throw enoent(a); files.delete(a); files.set(b, t); },
    async remove(p) { files.delete(p); },
    async listDir(d) { return [...files.keys()].filter((k) => dirOf(k) === d).map(base); },
    async ensureDir() {},
    async exists(p) { return files.has(p); },
  };
}
