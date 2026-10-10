import type { DebugEvent, DebugEventInput, DebugEventQuery, DebugSource } from '@shared/ipc';

/** Where a recorder also writes each event, as one JSON line */
export interface DebugSink {
  write(line: string): void;
}

/**
 * The debug timeline: a bounded, time-ordered buffer of events from both processes. It records only
 * while enabled; each enabling starts a fresh timeline, and a disabled recorder keeps what it had
 * so it can still be read.
 */
export interface DebugRecorder {
  enable(sink?: DebugSink): void;
  disable(): void;
  enabled(): boolean;
  record(source: DebugSource, input: Omit<DebugEventInput, 'at'> & { at?: number }): void;
  events(query?: DebugEventQuery): DebugEvent[];
  count(): number;
  capacity: number;
}

const DEFAULT_CAPACITY = 5000;

export function createDebugRecorder(options: { now(): number; capacity?: number }): DebugRecorder {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  let on = false;
  let startedAt = 0;
  let sink: DebugSink | undefined;
  let buffer: DebugEvent[] = [];

  return {
    capacity,
    enabled: () => on,
    count: () => buffer.length,
    enable(next) {
      buffer = [];
      sink = next;
      startedAt = options.now();
      on = true;
    },
    disable() {
      on = false;
      sink = undefined;
    },
    record(source, input) {
      if (!on) return;
      const event: DebugEvent = { t: (input.at ?? options.now()) - startedAt, source, category: input.category, name: input.name, data: input.data ?? {} };
      buffer.push(event);
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
      try {
        sink?.write(JSON.stringify(event));
      } catch {
        // a failing log file must never reach the app
      }
    },
    events(query = {}) {
      const { since, categories, limit } = query;
      // Array.prototype.sort is stable, so arrival order breaks ties
      let found = [...buffer].sort((a, b) => a.t - b.t);
      if (since !== undefined) found = found.filter((e) => e.t > since);
      if (categories) found = found.filter((e) => categories.includes(e.category));
      return limit !== undefined ? found.slice(-limit) : found;
    },
  };
}
