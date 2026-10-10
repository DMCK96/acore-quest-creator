import { join } from 'node:path';
import type { DebugSink } from './recorder';

/** The few file operations the log needs, so it is tested without a disk */
export interface LogFs {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string): Promise<void>;
  append(path: string, text: string): Promise<void>;
}

export interface DebugLog extends DebugSink {
  path: string;
  /** Resolves once every line handed over so far has been written (or has failed) */
  close(): Promise<void>;
  /** Appends that failed; a failure is counted, never thrown */
  failures(): number;
  /** The file reached its size limit and stopped growing */
  truncated(): boolean;
}

const DEBUG_FILE = /^debug-.*\.jsonl$/;
const DEFAULT_KEEP = 5;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** Log files for Debug mode: one new file each time it is switched on, a few kept, each with a size cap */
export function createLogFiles(options: { dir: string; fs: LogFs; now(): Date; keep?: number; maxBytes?: number }) {
  const { dir, fs } = options;
  const keep = options.keep ?? DEFAULT_KEEP;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return {
    async open(): Promise<DebugLog> {
      await fs.mkdir(dir);
      const old = (await fs.readdir(dir)).filter((name) => DEBUG_FILE.test(name)).sort();
      // Names sort by start time; leave room for the file about to be made
      for (const name of old.slice(0, Math.max(0, old.length - (keep - 1)))) await fs.rm(join(dir, name));

      const stamp = options.now().toISOString().replace(/\.\d+Z$/, '').replace(/[:.]/g, '-');
      const path = join(dir, `debug-${stamp}.jsonl`);
      // The file exists from the moment Debug mode goes on, even before the first event
      await fs.append(path, '');
      let chain: Promise<void> = Promise.resolve();
      let bytes = 0;
      let failed = 0;
      let full = false;

      const append = (text: string): void => {
        chain = chain.then(() => fs.append(path, text)).catch(() => {
          failed += 1;
        });
      };

      return {
        path,
        write(line) {
          if (full) return;
          const size = Buffer.byteLength(line, 'utf8') + 1;
          if (bytes + size > maxBytes) {
            full = true;
            append(`${JSON.stringify({ t: 0, source: 'main', category: 'log', name: 'truncated', data: { limit: maxBytes } })}\n`);
            return;
          }
          bytes += size;
          append(`${line}\n`);
        },
        close: () => chain,
        failures: () => failed,
        truncated: () => full,
      };
    },
  };
}
