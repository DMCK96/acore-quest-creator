# Debug Mode and Live Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Preferences switch, "Debug mode", that records a combined main-process and renderer timeline of input, focus, window and health events, readable and probe-able through MCP tools, plus an always-available `screenshot` MCP tool.

**Architecture:** A `DebugRecorder` (ring buffer plus optional JSON-lines log) lives in the main process and is owned by a `DebugController`, which also answers the new Api methods. Main-process taps and renderer taps feed the recorder only while the flag is on. The flag is a main-store setting (`debug.enabled`) pushed to the window. MCP tools reach the controller through `ctx.call`, like every tool. The renderer answers snapshot and rectangle questions that main asks over a request/answer channel.

**Tech Stack:** Electron (main, preload, sandboxed renderer), React 19, TypeScript, zod request schemas, vitest (node and jsdom projects), Playwright for the one Electron end-to-end test, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-10-10-debug-mode-design.md`

## Global Constraints

- Debug mode is **off by default**; when off, no listener is attached, no event is recorded, no file is written.
- Buffer: **5,000 events**, oldest dropped. Renderer events are batched about every **250 ms**. Orphan keystroke window: **100 ms**. Snapshot wait: **2000 ms**. Screenshot width cap: **1600 px**.
- Log files: `<userData>/logs/debug-<start-time>.jsonl`, **5 files kept**, each stops growing at **20 MB** (one `truncated` event, then nothing).
- Privacy: record key **codes and modifiers, never the characters typed**, and never a field's value, except in `debug_type`'s before/after, which is not stored. Password fields are described as `[password]` and nothing else. Screenshots are not stored.
- Only the user can switch Debug mode on, from Preferences. **No MCP tool may call `debugSetEnabled`, `debugRecord` or `debugAnswer`.**
- MCP tools use `ctx.call`, never `ctx.api` (`tests/main/mcp-tools-surface.test.ts` enforces it).
- Gating message when Debug mode is off: exactly `Turn on Debug mode in Preferences first.` with error code `NOT_ENABLED` (the existing "feature the user has not switched on" code; the spec said `BAD_REQUEST`, this is the better fit).
- Both processes stamp events with the same epoch clock, `performance.timeOrigin + performance.now()` (milliseconds). The recorder stores `t` as milliseconds since Debug mode was switched on. (The spec described measuring a clock offset; one shared epoch clock does the same job with less machinery.)
- Run `npm run typecheck` and `npx vitest run` before every commit that touches more than tests; both must be clean. (Exception: Tasks 1 to 4 leave the node typecheck red until Task 5 adds the Api implementation; run only the web typecheck there.)

## Review Focus

- **Window and main disagree about the flag** after a renderer reload or a crash: the renderer must ask `debugStatus` on every start, not trust its last push. (Task 9 test.)
- **A field value or typed character leaks into an event**, via `input`, `beforeinput`, the orphan detector, or a `before-input-event`. (Tasks 7, 9 tests.)
- **Turning the flag off leaves something attached**: renderer listeners, the wrapped `window.confirm`, main taps. (Tasks 7, 9 tests.)
- **The renderer never answers a snapshot request** (hung page): `debug_snapshot` must still return main's view within 2 s and say the page did not respond. (Tasks 4, 5 tests.)
- **A screenshot is asked for while the window is hidden or minimised, or a selector matches nothing**: a plain message, not a crash. (Task 5 test.)
- **A hostile or huge input**: `debug_type` text is capped at 200 characters, event queries at 1,000 events, `categories` at 20 names. (Task 1 test.)

---

### Task 1: Shared contract (types, channels, request schemas)

**Files:**
- Create: `src/shared/ipc/debug.ts`
- Modify: `src/shared/ipc/api.ts` (add `DebugApi` to the `Api` extends list), `src/shared/ipc/index.ts` (export the new types), `src/shared/ipc/requests.ts` (schemas), `src/shared/api-methods.ts` (method names and channels)
- Test: `tests/main/debug-contract.test.ts`

**Interfaces:**
- Produces, in `src/shared/ipc/debug.ts` (all exported):
  - `DebugSource = 'main' | 'renderer'`
  - `DebugEvent = { t: number; source: DebugSource; category: string; name: string; data: Record<string, unknown> }`
  - `DebugEventInput = { at: number; category: string; name: string; data?: Record<string, unknown> }` (`at` is epoch ms)
  - `DebugEventQuery = { since?: number; categories?: string[]; limit?: number }`
  - `WindowState = { focused: boolean; contentsFocused: boolean; visible: boolean; minimized: boolean }`
  - `FocusSnapshot = { documentHasFocus: boolean; active: string | null; activeState: { editable: boolean; disabled: boolean; readOnly: boolean } | null; blockedBy: string[]; modals: string[]; coveredBy: string | null }`
  - `FieldState = { target: string; value: string }`
  - `Rect = { x: number; y: number; width: number; height: number }`
  - `RendererQuery = { kind: 'snapshot'; includeValue: boolean } | { kind: 'rect'; selector: string }`
  - `RendererRequest = RendererQuery & { id: number }`
  - `RendererAnswer = { focus: FocusSnapshot; field: FieldState | null } | { rect: Rect | null }`
  - `DebugStatus = { enabled: boolean; events: number; capacity: number; logFile: string | null; logFailures: number; logTruncated: boolean; window: WindowState | null }`
  - `DebugSnapshot = { main: WindowState | null; renderer: FocusSnapshot | null; rendererAnswered: boolean }`
  - `DebugTypeResult = { typed: number; before: FieldState | null; after: FieldState | null; changed: boolean; window: WindowState | null; events: DebugEvent[] }`
  - `ScreenshotOptions = { selector?: string; rect?: Rect; maxWidth?: number }`
  - `ScreenshotResult = { width: number; height: number; mimeType: 'image/png'; data: string; window: WindowState | null }` (`data` is base64)
  - `DebugApi`: `debugStatus(): Promise<Result<DebugStatus>>`, `debugSetEnabled(on: boolean): Promise<Result<DebugStatus>>`, `debugEvents(query?: DebugEventQuery): Promise<Result<DebugEvent[]>>`, `debugSnapshot(): Promise<Result<DebugSnapshot>>`, `debugType(text: string): Promise<Result<DebugTypeResult>>`, `captureScreenshot(options?: ScreenshotOptions): Promise<Result<ScreenshotResult>>`, `debugRecord(batch: DebugEventInput[]): Promise<Result<null>>`, `debugAnswer(id: number, answer: RendererAnswer): Promise<Result<null>>`
- In `src/shared/api-methods.ts`: the eight method names are added to `API_METHODS`; new constants `DEBUG_CHANGED_CHANNEL = 'app:debug-changed'` (main to window, payload `boolean`) and `DEBUG_REQUEST_CHANNEL = 'app:debug-request'` (main to window, payload `RendererRequest`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/debug-contract.test.ts
import { describe, expect, it } from 'vitest';
import { parseRequest } from '../../src/shared/ipc';
import { API_METHODS, DEBUG_CHANGED_CHANNEL, DEBUG_REQUEST_CHANNEL } from '../../src/shared/api-methods';

const ok = (method: string, args: unknown[]) => parseRequest(method as never, args).ok;

describe('the debug API contract', () => {
  it('lists every debug method for the preload bridge', () => {
    for (const m of ['debugStatus', 'debugSetEnabled', 'debugEvents', 'debugSnapshot', 'debugType', 'captureScreenshot', 'debugRecord', 'debugAnswer']) {
      expect(API_METHODS as readonly string[]).toContain(m);
    }
    expect(DEBUG_CHANGED_CHANNEL).toBe('app:debug-changed');
    expect(DEBUG_REQUEST_CHANNEL).toBe('app:debug-request');
  });

  it('debugSetEnabled takes exactly one boolean', () => {
    expect(ok('debugSetEnabled', [true])).toBe(true);
    expect(ok('debugSetEnabled', ['yes'])).toBe(false);
    expect(ok('debugSetEnabled', [])).toBe(false);
  });

  it('debugEvents bounds its query', () => {
    expect(ok('debugEvents', [])).toBe(true);
    expect(ok('debugEvents', [{ since: 10, categories: ['input'], limit: 1000 }])).toBe(true);
    expect(ok('debugEvents', [{ limit: 1001 }])).toBe(false);
    expect(ok('debugEvents', [{ limit: 0 }])).toBe(false);
    expect(ok('debugEvents', [{ categories: Array.from({ length: 21 }, (_, i) => `c${i}`) }])).toBe(false);
  });

  it('debugType caps the text at 200 characters and refuses empty text', () => {
    expect(ok('debugType', ['abc'])).toBe(true);
    expect(ok('debugType', [''])).toBe(false);
    expect(ok('debugType', ['x'.repeat(201)])).toBe(false);
  });

  it('captureScreenshot caps the width at 1600 and wants whole, positive rectangles', () => {
    expect(ok('captureScreenshot', [])).toBe(true);
    expect(ok('captureScreenshot', [{ selector: '.modal', maxWidth: 1600 }])).toBe(true);
    expect(ok('captureScreenshot', [{ maxWidth: 1601 }])).toBe(false);
    expect(ok('captureScreenshot', [{ rect: { x: 0, y: 0, width: 0, height: 10 } }])).toBe(false);
    expect(ok('captureScreenshot', [{ rect: { x: 0, y: 0, width: 100, height: 50 } }])).toBe(true);
  });

  it('debugRecord takes a bounded batch of events', () => {
    const event = { at: 1, category: 'input', name: 'keydown', data: { code: 'KeyA' } };
    expect(ok('debugRecord', [[event]])).toBe(true);
    expect(ok('debugRecord', [Array.from({ length: 501 }, () => event)])).toBe(false);
    expect(ok('debugRecord', [[{ category: 'input', name: 'x' }]])).toBe(false);
  });

  it('debugAnswer takes an id and either a focus answer or a rect answer', () => {
    const focus = { documentHasFocus: true, active: 'input#a', activeState: { editable: true, disabled: false, readOnly: false }, blockedBy: [], modals: [], coveredBy: null };
    expect(ok('debugAnswer', [1, { focus, field: null }])).toBe(true);
    expect(ok('debugAnswer', [1, { rect: null }])).toBe(true);
    expect(ok('debugAnswer', [1, { rect: { x: 1, y: 2, width: 3, height: 4 } }])).toBe(true);
    expect(ok('debugAnswer', ['1', { rect: null }])).toBe(false);
    expect(ok('debugAnswer', [1, { nothing: true }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/debug-contract.test.ts`
Expected: FAIL (methods not in `API_METHODS`, `parseRequest` has no schema).

- [ ] **Step 3: Implement**

Create `src/shared/ipc/debug.ts` with the types and the `DebugApi` interface exactly as listed above, and make `Api` extend `DebugApi`. Export the new types from `src/shared/ipc/index.ts` the way `McpStatus` is exported. In `requests.ts` add one tuple schema per method, following the `mcp*` entries: `debugStatus` and `debugSnapshot` take `z.tuple([])`; `debugSetEnabled` takes one boolean; `debugEvents` takes an optional object with `since` (finite number), `categories` (array of strings up to 40 characters, at most 20), `limit` (integer 1 to 1000); `debugType` takes one string of 1 to 200 characters; `captureScreenshot` takes an optional object with `selector` (string up to 300), `rect` (whole numbers, `width` and `height` at least 1, all at most 20000) and `maxWidth` (integer 1 to 1600); `debugRecord` takes one array of at most 500 events, each `{ at: finite number, category: string up to 40, name: string up to 60, data: record of unknown, optional }`; `debugAnswer` takes an integer id and a union of `{ focus, field }` (focus with the exact `FocusSnapshot` fields, `field` either null or `{ target, value }` strings) and `{ rect }` (null or a rect of finite numbers). Strings inside answers are capped at 500 characters. Add the eight names to `API_METHODS` and the two channel constants beside the existing ones, with a one-line comment each.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/debug-contract.test.ts`
Expected: PASS. Do not run the full typecheck yet: `src/main/api/index.ts` cannot satisfy the enlarged `Api` until Task 5. `npx tsc -p tsconfig.web.json --noEmit` should still pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/main/debug-contract.test.ts
git commit -m "feat(debug): the shared contract for debug mode: types, channels, request schemas"
```

---

### Task 2: The recorder

**Files:**
- Create: `src/main/debug/recorder.ts`
- Test: `tests/main/debug-recorder.test.ts`

**Interfaces:**
- Consumes: `DebugEvent`, `DebugEventInput`, `DebugEventQuery`, `DebugSource` from Task 1.
- Produces:
  - `interface DebugSink { write(line: string): void }`
  - `interface DebugRecorder { enable(sink?: DebugSink): void; disable(): void; enabled(): boolean; record(source: DebugSource, input: Omit<DebugEventInput, 'at'> & { at?: number }): void; events(query?: DebugEventQuery): DebugEvent[]; count(): number; capacity: number }`
  - `createDebugRecorder(options: { now(): number; capacity?: number }): DebugRecorder` (default capacity 5000)

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/debug-recorder.test.ts
import { describe, expect, it } from 'vitest';
import { createDebugRecorder } from '../../src/main/debug/recorder';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; }, advance: (d: number) => { t += d; } };
}

describe('the debug recorder', () => {
  it('records nothing until it is enabled, and nothing after it is disabled', () => {
    const c = clock();
    const r = createDebugRecorder({ now: c.now });
    r.record('main', { category: 'window', name: 'focus' });
    expect(r.count()).toBe(0);
    r.enable();
    r.record('main', { category: 'window', name: 'focus' });
    expect(r.count()).toBe(1);
    r.disable();
    r.record('main', { category: 'window', name: 'blur' });
    expect(r.count()).toBe(1);
    expect(r.enabled()).toBe(false);
  });

  it('starts a fresh timeline each time it is enabled', () => {
    const c = clock();
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    r.record('main', { category: 'a', name: 'one' });
    r.disable();
    r.enable();
    expect(r.count()).toBe(0);
  });

  it('stamps t as milliseconds since it was enabled, from now() or from the event\'s own time', () => {
    const c = clock(1_000);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    c.advance(250);
    r.record('main', { category: 'a', name: 'now' });
    r.record('renderer', { category: 'a', name: 'earlier', at: 1_100 });
    const byName = Object.fromEntries(r.events().map((e) => [e.name, e]));
    expect(byName['now']).toMatchObject({ t: 250, source: 'main', data: {} });
    expect(byName['earlier']).toMatchObject({ t: 100, source: 'renderer' });
  });

  it('returns events in time order even when a late batch arrives', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    c.set(500);
    r.record('main', { category: 'a', name: 'second' });
    r.record('renderer', { category: 'a', name: 'first', at: 200 });
    expect(r.events().map((e) => e.name)).toEqual(['first', 'second']);
  });

  it('drops the oldest events past its capacity', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now, capacity: 3 });
    r.enable();
    for (const name of ['a', 'b', 'c', 'd', 'e']) { c.advance(1); r.record('main', { category: 'x', name }); }
    expect(r.count()).toBe(3);
    expect(r.events().map((e) => e.name)).toEqual(['c', 'd', 'e']);
    expect(r.capacity).toBe(3);
  });

  it('defaults to a capacity of 5000', () => {
    expect(createDebugRecorder({ now: () => 0 }).capacity).toBe(5000);
  });

  it('filters by since (strictly later), by category, and keeps the newest events up to a limit', () => {
    const c = clock(0);
    const r = createDebugRecorder({ now: c.now });
    r.enable();
    for (const [i, category] of ['input', 'window', 'input', 'input'].entries()) { c.set((i + 1) * 10); r.record('main', { category, name: `e${i}` }); }
    expect(r.events({ since: 20 }).map((e) => e.name)).toEqual(['e2', 'e3']);
    expect(r.events({ categories: ['window'] }).map((e) => e.name)).toEqual(['e1']);
    expect(r.events({ categories: ['input'], limit: 2 }).map((e) => e.name)).toEqual(['e2', 'e3']);
  });

  it('writes each event to the sink as one JSON line, and survives a sink that throws', () => {
    const c = clock(0);
    const lines: string[] = [];
    const r = createDebugRecorder({ now: c.now });
    r.enable({ write: (l) => { lines.push(l); } });
    r.record('main', { category: 'a', name: 'one', data: { n: 1 } });
    expect(JSON.parse(lines[0]!)).toEqual({ t: 0, source: 'main', category: 'a', name: 'one', data: { n: 1 } });
    r.disable();
    r.enable({ write: () => { throw new Error('disk full'); } });
    expect(() => r.record('main', { category: 'a', name: 'two' })).not.toThrow();
    expect(r.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/debug-recorder.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`createDebugRecorder` keeps an array used as a ring (or a plain array trimmed from the front, whichever is simpler; capacity is small). `enable(sink?)` clears the buffer, remembers `startedAt = now()` and the sink, and turns recording on; `disable()` turns it off but keeps the buffer so it can still be read until the next `enable()`. `record` returns at once when disabled; otherwise builds the event with `t = (input.at ?? now()) - startedAt`, `data` defaulting to `{}`, appends it, drops the oldest past capacity, and writes `JSON.stringify(event)` to the sink inside try/catch (a throwing sink is swallowed). `events(query)` returns a copy sorted by `t` (stable, so arrival order breaks ties), applies `since` as `t > since`, `categories` as membership, and `limit` by keeping the newest `limit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/debug-recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/debug/recorder.ts tests/main/debug-recorder.test.ts
git commit -m "feat(debug): a bounded, time-ordered event recorder"
```

---

### Task 3: The setting and the log file

**Files:**
- Create: `src/main/debug/settings.ts`, `src/main/debug/log-file.ts`
- Test: `tests/main/debug-settings.test.ts`, `tests/main/debug-log-file.test.ts`

**Interfaces:**
- Consumes: `Store` from `src/main/store/store.ts` (`store.settings.get/set`); `DebugSink` from Task 2.
- Produces:
  - `interface DebugSettings { enabled(): boolean; setEnabled(on: boolean): void }` and `createDebugSettings(store: Store): DebugSettings`, key `debug.enabled`, stored as `'1'` or `'0'`, default false.
  - `interface LogFs { mkdir(path: string): Promise<void>; readdir(path: string): Promise<string[]>; rm(path: string): Promise<void>; append(path: string, text: string): Promise<void> }`
  - `interface DebugLog extends DebugSink { path: string; close(): Promise<void>; failures(): number; truncated(): boolean }`
  - `createLogFiles(options: { dir: string; fs: LogFs; now(): Date; keep?: number; maxBytes?: number }): { open(): Promise<DebugLog> }` (defaults 5 and 20 MiB)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/debug-settings.test.ts
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/main/store/store';
import { createDebugSettings } from '../../src/main/debug/settings';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

describe('the Debug mode setting', () => {
  it('is off by default', () => {
    expect(createDebugSettings(openStore(':memory:', box)).enabled()).toBe(false);
  });
  it('is remembered in the store', () => {
    const store = openStore(':memory:', box);
    createDebugSettings(store).setEnabled(true);
    expect(createDebugSettings(store).enabled()).toBe(true);
    expect(store.settings.get('debug.enabled')).toBe('1');
    createDebugSettings(store).setEnabled(false);
    expect(createDebugSettings(store).enabled()).toBe(false);
  });
});
```

```ts
// tests/main/debug-log-file.test.ts
import { describe, expect, it } from 'vitest';
import { createLogFiles, type LogFs } from '../../src/main/debug/log-file';

const base = (p: string) => p.split(/[\\/]/).pop()!;

function fakeFs(initial: string[] = []) {
  const files = new Map<string, string>(initial.map((n) => [n, '']));
  let failAppend = false;
  const fs: LogFs = {
    mkdir: async () => {},
    readdir: async () => [...files.keys()],
    rm: async (p) => { files.delete(base(p)); },
    append: async (p, text) => {
      if (failAppend) throw new Error('disk full');
      files.set(base(p), (files.get(base(p)) ?? '') + text);
    },
  };
  return { files, fs, failAppends: () => { failAppend = true; } };
}

const at = new Date('2026-10-10T12:30:45.000Z');

describe('the debug log file', () => {
  it('opens debug-<start-time>.jsonl and writes one line per call', async () => {
    const { fs, files } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    expect(base(log.path)).toBe('debug-2026-10-10T12-30-45.jsonl');
    log.write('{"a":1}');
    log.write('{"b":2}');
    await log.close();
    expect(files.get('debug-2026-10-10T12-30-45.jsonl')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('keeps at most 5 debug files, deleting the oldest, and leaves other files alone', async () => {
    const old = ['debug-2026-10-01T00-00-00.jsonl', 'debug-2026-10-02T00-00-00.jsonl', 'debug-2026-10-03T00-00-00.jsonl', 'debug-2026-10-04T00-00-00.jsonl', 'debug-2026-10-05T00-00-00.jsonl', 'debug-2026-10-06T00-00-00.jsonl'];
    const { fs, files } = fakeFs([...old, 'notes.txt']);
    await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    const debugFiles = [...files.keys()].filter((n) => n.startsWith('debug-'));
    expect(debugFiles).toHaveLength(5);
    expect(debugFiles).not.toContain('debug-2026-10-01T00-00-00.jsonl');
    expect(debugFiles).not.toContain('debug-2026-10-02T00-00-00.jsonl');
    expect(debugFiles).not.toContain('debug-2026-10-03T00-00-00.jsonl');
    expect(files.has('notes.txt')).toBe(true);
  });

  it('stops at its size limit with one truncated marker, then drops everything', async () => {
    const { fs, files } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at, maxBytes: 40 }).open();
    log.write('x'.repeat(30));
    expect(log.truncated()).toBe(false);
    log.write('y'.repeat(30));
    log.write('z'.repeat(30));
    await log.close();
    expect(log.truncated()).toBe(true);
    const lines = files.get('debug-2026-10-10T12-30-45.jsonl')!.trim().split('\n');
    expect(lines[0]).toBe('x'.repeat(30));
    expect(JSON.parse(lines[1]!)).toMatchObject({ category: 'log', name: 'truncated' });
    expect(lines).toHaveLength(2);
  });

  it('counts a failed write and never throws', async () => {
    const { fs, failAppends } = fakeFs();
    const log = await createLogFiles({ dir: 'logs', fs, now: () => at }).open();
    failAppends();
    expect(() => log.write('{"a":1}')).not.toThrow();
    await log.close();
    expect(log.failures()).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/debug-settings.test.ts tests/main/debug-log-file.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`settings.ts` mirrors `createMcpSettings`: `enabled()` is `store.settings.get('debug.enabled') === '1'`; `setEnabled` stores `'1'`/`'0'`. `log-file.ts`: `open()` creates the directory, lists it, and among names matching `^debug-.*\.jsonl$` deletes the oldest (by name, which sorts by time) until `keep - 1` remain; then returns a `DebugLog` whose path is `join(dir, 'debug-<ISO time with ":" and "." replaced by "-", milliseconds dropped>.jsonl')`. `write(line)` is synchronous for the caller: it adds `line + '\n'` to a promise chain that appends to the file. It tracks bytes itself (UTF-8 length plus the newline); the write that would pass `maxBytes` is replaced by one marker line `{"t":0,"source":"main","category":"log","name":"truncated","data":{"limit":<maxBytes>}}`, `truncated()` becomes true, and every later write is dropped. A rejected append adds one to `failures()` and is otherwise ignored. `close()` awaits the chain.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/debug-settings.test.ts tests/main/debug-log-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/debug tests/main/debug-settings.test.ts tests/main/debug-log-file.test.ts
git commit -m "feat(debug): the Debug mode setting and a rotating, size-capped log file"
```

---

### Task 4: The renderer link (ask the window, wait at most 2 s)

**Files:**
- Create: `src/main/debug/renderer-link.ts`
- Test: `tests/main/debug-renderer-link.test.ts`

**Interfaces:**
- Consumes: `RendererQuery`, `RendererRequest`, `RendererAnswer` from Task 1.
- Produces: `interface RendererLink { ask(query: RendererQuery): Promise<RendererAnswer | null>; answer(id: number, answer: RendererAnswer): void }` and `createRendererLink(options: { send(request: RendererRequest): boolean; timeoutMs?: number }): RendererLink` (default timeout 2000). `send` returns false when there is no window to ask.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/debug-renderer-link.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererLink } from '../../src/main/debug/renderer-link';
import type { RendererRequest } from '../../src/shared/ipc';

afterEach(() => { vi.useRealTimers(); });

describe('the renderer link', () => {
  it('sends a numbered request and resolves with the matching answer', async () => {
    const sent: RendererRequest[] = [];
    const link = createRendererLink({ send: (r) => { sent.push(r); return true; } });
    const first = link.ask({ kind: 'rect', selector: '.a' });
    const second = link.ask({ kind: 'rect', selector: '.b' });
    expect(sent.map((r) => r.id)).toEqual([1, 2]);
    link.answer(2, { rect: { x: 1, y: 2, width: 3, height: 4 } });
    link.answer(1, { rect: null });
    expect(await first).toEqual({ rect: null });
    expect(await second).toEqual({ rect: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it('resolves null when the window does not answer in time', async () => {
    vi.useFakeTimers();
    const link = createRendererLink({ send: () => true, timeoutMs: 2000 });
    const pending = link.ask({ kind: 'snapshot', includeValue: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeNull();
  });

  it('resolves null at once when there is no window to ask', async () => {
    const link = createRendererLink({ send: () => false });
    expect(await link.ask({ kind: 'snapshot', includeValue: false })).toBeNull();
  });

  it('ignores an answer for a request it does not know, or one that already timed out', async () => {
    vi.useFakeTimers();
    const link = createRendererLink({ send: () => true, timeoutMs: 100 });
    const pending = link.ask({ kind: 'rect', selector: '.a' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    expect(() => link.answer(1, { rect: null })).not.toThrow();
    expect(() => link.answer(99, { rect: null })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/debug-renderer-link.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Keep a counter starting at 1 and a map from id to `{ resolve, timer }`. `ask` builds the request with the next id, registers it, calls `send`; if `send` returns false it resolves null and clears the entry. A timer resolves null and deletes the entry after `timeoutMs`. `answer` looks the id up, clears its timer, deletes it and resolves; an unknown id does nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/debug-renderer-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/debug/renderer-link.ts tests/main/debug-renderer-link.test.ts
git commit -m "feat(debug): ask the window a question and wait at most two seconds"
```

---

### Task 5: The controller and the debug API

**Files:**
- Create: `src/main/debug/controller.ts`, `src/main/api/debug-api.ts`
- Modify: `src/main/api/deps.ts` (optional `debug?: DebugController`), `src/main/api/index.ts` (include `createDebugApi`)
- Test: `tests/main/debug-controller.test.ts`, `tests/main/api-debug.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4 (`DebugRecorder`, `DebugSettings`, `DebugLog`, `RendererLink`, shared types), `fail` from `src/main/api/errors.ts`.
- Produces:
  - `interface DebugWindowPort { state(): WindowState | null; capture(o: { rect?: Rect; maxWidth: number }): Promise<{ data: string; width: number; height: number } | null>; sendText(text: string): Promise<void>; announce(enabled: boolean): void }`
  - `interface DebugController { start(): Promise<void>; stop(): Promise<void>; status(): DebugStatus; setEnabled(on: boolean): Promise<DebugStatus>; events(query?: DebugEventQuery): DebugEvent[]; snapshot(): Promise<DebugSnapshot>; type(text: string): Promise<DebugTypeResult>; screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>; ingest(batch: DebugEventInput[]): void; answer(id: number, answer: RendererAnswer): void; note(category: string, name: string, data?: Record<string, unknown>): void; onChange(listener: (enabled: boolean) => void): () => void }`
  - `createDebugController(options: { settings: DebugSettings; recorder: DebugRecorder; logs: { open(): Promise<DebugLog> }; window: DebugWindowPort; link: RendererLink; settleMs?: number }): DebugController` (`settleMs` default 150: the pause after typing before the second look)
  - `createDebugApi(deps: ApiDeps): DebugApi`; with no `deps.debug` every method answers `UNKNOWN` "Debug mode is not available in this build."

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/debug-controller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createDebugController, type DebugWindowPort } from '../../src/main/debug/controller';
import { createDebugRecorder } from '../../src/main/debug/recorder';
import type { RendererAnswer, RendererQuery, WindowState } from '../../src/shared/ipc';

const open: WindowState = { focused: true, contentsFocused: true, visible: true, minimized: false };
const focus = { documentHasFocus: true, active: 'input#npc-search', activeState: { editable: true, disabled: false, readOnly: false }, blockedBy: [], modals: ['div.modal'], coveredBy: null };

function rig(over: { enabled?: boolean; state?: WindowState | null; answers?: (RendererAnswer | null)[]; capture?: DebugWindowPort['capture'] } = {}) {
  let flag = over.enabled ?? false;
  const asked: RendererQuery[] = [];
  const answers = [...(over.answers ?? [])];
  const typed: string[] = [];
  const announced: boolean[] = [];
  const written: string[] = [];
  let closed = 0;
  let clock = 1_000;
  const recorder = createDebugRecorder({ now: () => clock });
  const controller = createDebugController({
    settings: { enabled: () => flag, setEnabled: (on) => { flag = on; } },
    recorder,
    logs: { open: async () => ({ path: 'logs/debug-x.jsonl', write: (l) => { written.push(l); }, close: async () => { closed += 1; }, failures: () => 0, truncated: () => false }) },
    window: {
      state: () => (over.state === undefined ? open : over.state),
      capture: over.capture ?? (async () => ({ data: 'AAAA', width: 800, height: 600 })),
      sendText: async (t) => { typed.push(t); },
      announce: (e) => { announced.push(e); },
    },
    link: { ask: async (q) => { asked.push(q); return answers.shift() ?? null; }, answer: () => {} },
    settleMs: 0,
  });
  return { controller, recorder, asked, typed, announced, written, closed: () => closed, tick: (ms: number) => { clock += ms; } };
}

const gated = { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' };

describe('the debug controller', () => {
  it('is off by default and says so', () => {
    const { controller } = rig();
    expect(controller.status()).toMatchObject({ enabled: false, events: 0, capacity: 5000, logFile: null, window: open });
  });

  it('switching on persists, starts recording and the log, and tells the window; off undoes all three', async () => {
    const { controller, recorder, announced, closed } = rig();
    const seen: boolean[] = [];
    controller.onChange((e) => seen.push(e));
    expect((await controller.setEnabled(true)).logFile).toBe('logs/debug-x.jsonl');
    expect(recorder.enabled()).toBe(true);
    expect(announced).toEqual([true]);
    await controller.setEnabled(false);
    expect(recorder.enabled()).toBe(false);
    expect(closed()).toBe(1);
    expect(announced).toEqual([true, false]);
    expect(seen).toEqual([true, false]);
    expect(controller.status().logFile).toBeNull();
  });

  it('start() applies the saved setting at launch', async () => {
    const { controller, recorder } = rig({ enabled: true });
    await controller.start();
    expect(recorder.enabled()).toBe(true);
    expect(controller.status().enabled).toBe(true);
  });

  it('notes and renderer batches are recorded only while on, with the right source', async () => {
    const { controller } = rig();
    controller.note('window', 'focus');
    controller.ingest([{ at: 1_000, category: 'input', name: 'keydown' }]);
    expect(controller.events()).toEqual([]);
    await controller.setEnabled(true);
    controller.note('window', 'focus', { contentsFocused: true });
    controller.ingest([{ at: 1_000, category: 'input', name: 'keydown', data: { code: 'KeyA' } }]);
    expect(controller.events().map((e) => [e.source, e.name])).toEqual([['renderer', 'keydown'], ['main', 'focus']]);
  });

  it('snapshot and type are refused while off, with the exact message', async () => {
    const { controller } = rig();
    await expect(controller.snapshot()).rejects.toMatchObject({ error: gated });
    await expect(controller.type('abc')).rejects.toMatchObject({ error: gated });
  });

  it('snapshot returns main\'s view and the page\'s answer', async () => {
    const { controller } = rig({ enabled: true, answers: [{ focus, field: null }] });
    await controller.start();
    expect(await controller.snapshot()).toEqual({ main: open, renderer: focus, rendererAnswered: true });
  });

  it('snapshot still answers, and says so, when the page does not', async () => {
    const { controller } = rig({ enabled: true, answers: [null] });
    await controller.start();
    expect(await controller.snapshot()).toEqual({ main: open, renderer: null, rendererAnswered: false });
  });

  it('type looks, types, looks again, and reports whether the field changed', async () => {
    const { controller, asked, typed } = rig({
      enabled: true,
      answers: [
        { focus, field: { target: 'input#npc-search', value: '' } },
        { focus, field: { target: 'input#npc-search', value: 'abc' } },
      ],
    });
    await controller.start();
    const out = await controller.type('abc');
    expect(typed).toEqual(['abc']);
    expect(asked).toEqual([{ kind: 'snapshot', includeValue: true }, { kind: 'snapshot', includeValue: true }]);
    expect(out).toMatchObject({ typed: 3, changed: true, window: open });
    expect(out.before?.value).toBe('');
    expect(out.after?.value).toBe('abc');
    expect(controller.events().some((e) => e.category === 'probe' && e.name === 'type')).toBe(true);
  });

  it('type reports changed=false when the value did not move', async () => {
    const same = { focus, field: { target: 'input#npc-search', value: 'x' } };
    const { controller } = rig({ enabled: true, answers: [same, same] });
    await controller.start();
    expect((await controller.type('abc')).changed).toBe(false);
  });

  it('screenshot works with Debug mode off, defaults to 1600 wide and carries the window state', async () => {
    const capture = vi.fn(async () => ({ data: 'AAAA', width: 800, height: 600 }));
    const { controller } = rig({ capture });
    expect(await controller.screenshot()).toEqual({ width: 800, height: 600, mimeType: 'image/png', data: 'AAAA', window: open });
    expect(capture).toHaveBeenCalledWith({ maxWidth: 1600 });
  });

  it('screenshot of a selector asks the page for its rectangle first', async () => {
    const capture = vi.fn(async () => ({ data: 'AAAA', width: 400, height: 300 }));
    const { controller, asked } = rig({ capture, answers: [{ rect: { x: 10, y: 20, width: 400, height: 300 } }] });
    await controller.screenshot({ selector: '.modal', maxWidth: 500 });
    expect(asked).toEqual([{ kind: 'rect', selector: '.modal' }]);
    expect(capture).toHaveBeenCalledWith({ rect: { x: 10, y: 20, width: 400, height: 300 }, maxWidth: 500 });
  });

  it('screenshot says plainly when the selector matches nothing or the window cannot be captured', async () => {
    const none = rig({ answers: [{ rect: null }] });
    await expect(none.controller.screenshot({ selector: '.nope' })).rejects.toMatchObject({ error: { code: 'BAD_REQUEST', message: 'Nothing on screen matches that selector.' } });
    const hidden = rig({ capture: async () => null });
    await expect(hidden.controller.screenshot()).rejects.toMatchObject({ error: { code: 'BAD_REQUEST', message: 'The window is hidden or minimised, so there is nothing to capture.' } });
  });
});
```

```ts
// tests/main/api-debug.test.ts
import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const deps = (debug?: any) => ({
  store: openStore(':memory:', box), openWorldDb: async () => { throw new Error('x'); }, openDevDb: async () => { throw new Error('x'); },
  fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
  session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController, debug,
});

describe('the debug API', () => {
  it('forwards each call to the controller and wraps the answer', async () => {
    const calls: string[] = [];
    const controller = {
      status: () => ({ enabled: true }),
      setEnabled: async (on: boolean) => { calls.push(`set ${on}`); return { enabled: on }; },
      events: () => [{ name: 'e' }],
      snapshot: async () => ({ rendererAnswered: false }),
      type: async (t: string) => ({ typed: t.length }),
      screenshot: async () => ({ width: 1 }),
      ingest: (b: unknown[]) => { calls.push(`ingest ${b.length}`); },
      answer: (id: number) => { calls.push(`answer ${id}`); },
    };
    const api = createApi(deps(controller));
    expect(await api.debugStatus()).toEqual({ ok: true, value: { enabled: true } });
    expect(await api.debugSetEnabled(true)).toEqual({ ok: true, value: { enabled: true } });
    expect(await api.debugEvents()).toEqual({ ok: true, value: [{ name: 'e' }] });
    expect(await api.debugType('ab')).toEqual({ ok: true, value: { typed: 2 } });
    expect(await api.debugRecord([{ at: 1, category: 'a', name: 'b' }])).toEqual({ ok: true, value: null });
    expect(await api.debugAnswer(7, { rect: null })).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['set true', 'ingest 1', 'answer 7']);
  });

  it('turns a controller failure into the error the window is sent', async () => {
    const { fail } = await import('../../src/main/api/errors');
    const api = createApi(deps({ snapshot: async () => { throw fail('NOT_ENABLED', 'Turn on Debug mode in Preferences first.'); } }));
    expect(await api.debugSnapshot()).toEqual({ ok: false, error: { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' } });
  });

  it('answers a plain error where the app has no debug controller', async () => {
    const out: any = await createApi(deps()).debugStatus();
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('Debug mode is not available in this build.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/debug-controller.test.ts tests/main/api-debug.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`createDebugController`:
- **State.** `log: DebugLog | null`, a `Set` of change listeners.
- **`start()`** applies `settings.enabled()`: if true, run the same enable path as `setEnabled(true)` without writing the setting again.
- **`setEnabled(on)`** is serialised (queue like `McpController`). On: persist, `log = await logs.open()` (if opening fails, carry on with no log), `recorder.enable(log ?? undefined)`, `window.announce(true)`, notify listeners. Off: persist, `recorder.disable()`, close and null the log, `announce(false)`, notify. Turning on when already on, or off when already off, changes nothing and notifies no one. Returns `status()`.
- **`status()`**: `enabled` from the recorder, `events` its count, `capacity` its capacity, `logFile` the open log's path or null, `logFailures` and `logTruncated` from the log or 0 and false, `window` from the port.
- **`note`** and **`ingest`**: do nothing when disabled. `note` records with source `main`. `ingest` records each event with source `renderer`, passing its `at`.
- **`events`**: `recorder.events(query)` (an empty list when nothing was ever recorded; works when off).
- **Gate:** `snapshot` and `type` first call a private `requireOn()` that throws `fail('NOT_ENABLED', 'Turn on Debug mode in Preferences first.')`.
- **`snapshot`**: asks `{ kind: 'snapshot', includeValue: false }`; `renderer` is the answer's `focus` or null, and `rendererAnswered` says whether an answer with a `focus` arrived.
- **`type(text)`**: ask for a snapshot with `includeValue: true` (`before` = its `field`), record a `probe`/`type` note with the length only (not the text), `await window.sendText(text)`, wait `settleMs`, ask again (`after`). `changed` is true when both fields exist and their values differ, or when only one exists. `events` are those recorded since the call began. `typed` is `text.length`.
- **`screenshot(options)`**: not gated. `maxWidth` defaults to 1600. If `options.selector` is given, ask `{ kind: 'rect', selector }`; a null or missing rect fails with `fail('BAD_REQUEST', 'Nothing on screen matches that selector.')`; otherwise the rect is used. An explicit `options.rect` is used if there is no selector. The port is called with `{ rect, maxWidth }`, omitting `rect` when there is none. A null capture fails with `fail('BAD_REQUEST', 'The window is hidden or minimised, so there is nothing to capture.')`. The result carries `mimeType: 'image/png'` and `window: window.state()`.
- **`answer(id, a)`** forwards to `link.answer`. **`stop()`** closes any open log.

`debug-api.ts` mirrors `mcp-api.ts`: a `controller()` helper that throws `fail('UNKNOWN', 'Debug mode is not available in this build.')` when `deps.debug` is absent; each method is `run(async () => ...)`. `debugRecord` calls `ingest` and returns `null`; `debugAnswer` calls `answer` and returns `null`; `debugSetEnabled` awaits `setEnabled`. Add `debug?: DebugController` to `ApiDeps` with a doc comment like `mcp?`, and spread `createDebugApi(deps)` into `createApi`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/debug-controller.test.ts tests/main/api-debug.test.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main tests/main/debug-controller.test.ts tests/main/api-debug.test.ts
git commit -m "feat(debug): the controller and the debug API"
```

---

### Task 6: MCP image results and the debug tools

**Files:**
- Modify: `src/main/mcp/tool.ts` (optional `image`), `src/main/mcp/server.ts` (image content block), `src/main/mcp/tools/index.ts` (register), `tests/helpers/mcp-fixture.ts` (pass a `debug` controller through), `tests/main/mcp-tools-surface.test.ts` (forbidden list)
- Create: `src/main/mcp/tools/debug.ts`
- Test: `tests/main/mcp-server.test.ts` (add a case), `tests/main/mcp-tools-debug.test.ts`

**Interfaces:**
- Consumes: Task 5 API methods.
- Produces:
  - `ToolDef.image?(value: any): { data: string; mimeType: string } | null`: when present and non-null, the server answers `content: [ <text block with the shown JSON>, <image block> ]`.
  - `debugTools: readonly ToolDef[]` with the names `debug_status`, `debug_events`, `debug_snapshot`, `debug_type`, `screenshot`; all `write: false`.
  - `McpFixtureOptions.debug?: unknown` passed to `createApi` as `debug`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/mcp-server.test.ts` (reuse its imports; add one tool beside `echo`):

```ts
const picture = defineTool({
  name: 'picture', title: 'Picture', description: 'Returns an image.', input: {}, write: false,
  run: async () => ({ ok: true, value: { width: 2, height: 1, data: 'QUJD' } }),
  present: ({ data: _data, ...rest }: { data: string }) => rest,
  image: (v: { data: string }) => ({ data: v.data, mimeType: 'image/png' }),
});

describe('an MCP tool that returns an image', () => {
  it('answers the shown JSON first and the image second, and keeps the base64 out of the JSON', async () => {
    const { client } = await mcpFixture([picture]);
    const r: any = await client.callTool({ name: 'picture', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toEqual({ width: 2, height: 1 });
    expect(r.content[1]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
  });
});
```

```ts
// tests/main/mcp-tools-debug.test.ts
import { describe, expect, it } from 'vitest';
import { debugTools } from '../../src/main/mcp/tools/debug';
import { mcpFixture } from '../helpers/mcp-fixture';
import { fail } from '../../src/main/api/errors';

const open = { focused: true, contentsFocused: true, visible: true, minimized: false };
const controller = (over: Record<string, unknown> = {}) => ({
  status: () => ({ enabled: true, events: 2, capacity: 5000, logFile: 'logs/x.jsonl', logFailures: 0, logTruncated: false, window: open }),
  events: (q: unknown) => [{ t: 5, source: 'main', category: 'input', name: 'before-input', data: { code: 'KeyA', q } }],
  snapshot: async () => ({ main: open, renderer: null, rendererAnswered: false }),
  type: async (t: string) => ({ typed: t.length, before: null, after: null, changed: false, window: open, events: [] }),
  screenshot: async () => ({ width: 8, height: 4, mimeType: 'image/png', data: 'QUJD', window: open }),
  ...over,
});

describe('the debug MCP tools', () => {
  it('offers exactly these five, all read-only', async () => {
    const { client } = await mcpFixture(debugTools, { debug: controller() });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['debug_events', 'debug_snapshot', 'debug_status', 'debug_type', 'screenshot']);
  });

  it('debug_status and debug_events pass their arguments through', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_status')).value).toMatchObject({ enabled: true, logFile: 'logs/x.jsonl' });
    const events = (await call('debug_events', { since: 3, categories: ['input'], limit: 10 })).value;
    expect(events).toHaveLength(1);
    expect(events[0].data.q).toEqual({ since: 3, categories: ['input'], limit: 10 });
  });

  it('debug_snapshot reports that the page did not answer', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_snapshot')).value).toMatchObject({ rendererAnswered: false, renderer: null });
  });

  it('debug_type answers the gate message when Debug mode is off', async () => {
    const off = controller({ type: async () => { throw fail('NOT_ENABLED', 'Turn on Debug mode in Preferences first.'); } });
    const { call } = await mcpFixture(debugTools, { debug: off });
    const out = await call('debug_type', { text: 'abc' });
    expect(out.isError).toBe(true);
    expect(out.value).toMatchObject({ code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' });
  });

  it('debug_type refuses empty or over-long text before reaching the controller', async () => {
    const { call } = await mcpFixture(debugTools, { debug: controller() });
    expect((await call('debug_type', { text: '' })).isError).toBe(true);
    expect((await call('debug_type', { text: 'x'.repeat(201) })).isError).toBe(true);
  });

  it('screenshot returns the window state as JSON and the picture as an image block', async () => {
    const { client } = await mcpFixture(debugTools, { debug: controller() });
    const r: any = await client.callTool({ name: 'screenshot', arguments: { selector: '.modal' } });
    expect(JSON.parse(r.content[0].text)).toEqual({ width: 8, height: 4, window: open });
    expect(r.content[1]).toMatchObject({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
  });
});
```

In `tests/main/mcp-tools-surface.test.ts` add `'debugSetEnabled'`, `'debugRecord'` and `'debugAnswer'` to the `FORBIDDEN` array, and add one assertion that the tool sources do call `debugStatus`, `debugEvents`, `debugSnapshot`, `debugType` and `captureScreenshot` (so the list cannot silently shrink):

```ts
  it('the debug tools reach the controller only through the five read and probe methods', () => {
    for (const m of ['debugStatus', 'debugEvents', 'debugSnapshot', 'debugType', 'captureScreenshot']) expect(called).toContain(m);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/mcp-server.test.ts tests/main/mcp-tools-debug.test.ts tests/main/mcp-tools-surface.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tool.ts`: add the optional `image` member with a doc comment. `server.ts`: after computing `shown` and the size checks, if `tool.image` returns a non-null value, answer `{ content: [textBlock, { type: 'image', data, mimeType }], isError: false }`. The size cap still applies to the text block only. `tests/helpers/mcp-fixture.ts`: add `debug?: unknown` to `McpFixtureOptions` and spread `...(opts.debug ? { debug: opts.debug as never } : {})` into the `createApi` call.

`tools/debug.ts`: five `defineTool` entries. `debug_status` calls `ctx.call('debugStatus')`. `debug_events` takes `since` (number, optional), `categories` (array of strings, at most 20, optional) and `limit` (integer 1 to 1000, optional) and calls `debugEvents` with only the arguments given. `debug_snapshot` calls `debugSnapshot`. `debug_type` takes `text` (string, 1 to 200) and calls `debugType`. `screenshot` takes optional `selector`, `x`, `y`, `width`, `height` (all four rect numbers together or none; if only some are given answer `BAD_REQUEST` "Give x, y, width and height together.") and `maxWidth`, calls `captureScreenshot`, `present` drops `data` and `mimeType`, and `image` returns `{ data, mimeType }`. Descriptions say what each returns, that `debug_snapshot` and `debug_type` need Debug mode on in Preferences, and that `screenshot` needs no setting. Register `debugTools` in `tools/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main` then `npm run typecheck`
Expected: PASS, typecheck clean. (This also runs the existing MCP tests, so a broken `server.ts` shows up here.)

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp tests
git commit -m "feat(mcp): image results, the debug tools and a general screenshot tool"
```

---

### Task 7: Main-process taps

**Files:**
- Create: `src/main/debug/main-taps.ts`
- Test: `tests/main/debug-main-taps.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the `note` signature.
- Produces: `createMainTaps(options: { note(category: string, name: string, data?: Record<string, unknown>): void; win: Emitter; contents: Emitter & { isFocused(): boolean }; app: Emitter }): { attach(): void; detach(): void }` where `Emitter = { on(event: string, listener: (...args: any[]) => void): unknown; off(event: string, listener: (...args: any[]) => void): unknown }`. Also `dialogNote(note, kind: string, work: () => Promise<T>): Promise<T>`: records `dialog`/`open` with `{ kind }` before and `dialog`/`close` after (also when `work` rejects).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/debug-main-taps.test.ts
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createMainTaps, dialogNote } from '../../src/main/debug/main-taps';

function rig() {
  const notes: [string, string, Record<string, unknown> | undefined][] = [];
  const win = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), { isFocused: () => true });
  const app = new EventEmitter();
  const taps = createMainTaps({ note: (c, n, d) => { notes.push([c, n, d]); }, win, contents, app });
  return { notes, win, contents, app, taps };
}

describe('the main-process taps', () => {
  it('records nothing until attached', () => {
    const { notes, win } = rig();
    win.emit('focus');
    expect(notes).toEqual([]);
  });

  it('records window events with whether the page has the keyboard', () => {
    const { notes, win, taps } = rig();
    taps.attach();
    for (const e of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.emit(e);
    expect(notes.map((n) => [n[0], n[1]])).toEqual(['focus', 'blur', 'show', 'hide', 'minimize', 'restore'].map((n) => ['window', n]));
    expect(notes[0]![2]).toEqual({ contentsFocused: true });
  });

  it('records a key before the page sees it: its code and modifiers, never the character', () => {
    const { notes, contents, taps } = rig();
    taps.attach();
    contents.emit('before-input-event', {}, { type: 'keyDown', key: 'q', code: 'KeyQ', control: true, shift: false, alt: false, meta: false, isAutoRepeat: false });
    expect(notes).toHaveLength(1);
    expect(notes[0]![0]).toBe('input');
    expect(notes[0]![1]).toBe('before-input');
    expect(notes[0]![2]).toEqual({ type: 'keyDown', code: 'KeyQ', ctrl: true, shift: false, alt: false, meta: false, repeat: false });
    expect(JSON.stringify(notes)).not.toContain('"q"');
  });

  it('records crashes, hangs, load failures and child-process exits as health events', () => {
    const { notes, contents, app, taps } = rig();
    taps.attach();
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
    contents.emit('unresponsive');
    contents.emit('responsive');
    contents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED');
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
    expect(notes.map((n) => [n[0], n[1]])).toEqual([['health', 'render-process-gone'], ['health', 'unresponsive'], ['health', 'responsive'], ['health', 'did-fail-load'], ['health', 'child-process-gone']]);
    expect(notes[0]![2]).toEqual({ reason: 'crashed', exitCode: 9 });
    expect(notes[4]![2]).toEqual({ type: 'GPU', reason: 'crashed', exitCode: 1 });
  });

  it('detaches every listener', () => {
    const { notes, win, contents, app, taps } = rig();
    taps.attach();
    taps.detach();
    win.emit('focus');
    contents.emit('before-input-event', {}, { type: 'keyDown', code: 'KeyA' });
    contents.emit('unresponsive');
    app.emit('child-process-gone', {}, {});
    expect(notes).toEqual([]);
    expect(win.listenerCount('focus') + contents.listenerCount('before-input-event') + app.listenerCount('child-process-gone')).toBe(0);
  });

  it('attaching twice does not double the events', () => {
    const { notes, win, taps } = rig();
    taps.attach();
    taps.attach();
    win.emit('blur');
    expect(notes).toHaveLength(1);
  });
});

describe('dialogNote', () => {
  it('brackets a dialog with open and close, and closes when the dialog throws', async () => {
    const notes: string[] = [];
    const note = (c: string, n: string, d?: Record<string, unknown>) => { notes.push(`${c}/${n}/${JSON.stringify(d)}`); };
    expect(await dialogNote(note, 'open-file', async () => 42)).toBe(42);
    await expect(dialogNote(note, 'save', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(notes).toEqual(['dialog/open/{"kind":"open-file"}', 'dialog/close/{"kind":"open-file"}', 'dialog/open/{"kind":"save"}', 'dialog/close/{"kind":"save"}']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/debug-main-taps.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`attach()` is idempotent (a flag); it registers named listeners on `win` (`focus`, `blur`, `show`, `hide`, `minimize`, `restore`, each noting `window`/`<event>` with `{ contentsFocused: contents.isFocused() }`), on `contents` (`before-input-event` noting `input`/`before-input` with exactly `{ type, code, ctrl: input.control, shift, alt, meta, repeat: input.isAutoRepeat }`; `render-process-gone` noting its `reason` and `exitCode`; `unresponsive`; `responsive`; `did-fail-load` noting `{ code, description }` from its third and fourth arguments) and on `app` (`child-process-gone` noting `{ type, reason, exitCode }`). `detach()` removes every listener it added with `off`. `dialogNote` notes `dialog`/`open` with `{ kind }`, awaits the work in try/finally, and notes `dialog`/`close` with the same data.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/debug-main-taps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/debug/main-taps.ts tests/main/debug-main-taps.test.ts
git commit -m "feat(debug): record keys, window focus, dialogs and process health in the main process"
```

---

### Task 8: Wire the main process (Electron glue)

This task connects pieces that already have tests. It has no unit test of its own: the checks are the typecheck, the full suite, and the end-to-end test in Task 11.

**Files:**
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/env.d.ts`

**Interfaces:**
- Consumes: Tasks 2 to 7; `DEBUG_CHANGED_CHANNEL`, `DEBUG_REQUEST_CHANNEL`.
- Produces: in `src/preload/index.ts`, `appEvents.onDebugChanged(handler: (enabled: boolean) => void)` and `appEvents.onDebugRequest(handler: (request: RendererRequest) => void)`; the same two optional members in `Window['appEvents']` in `env.d.ts`.

- [ ] **Step 1: Write the wiring**

In `src/main/index.ts`, inside `app.whenReady()` before `buildDeps`:
1. Create the recorder (`createDebugRecorder({ now: () => performance.timeOrigin + performance.now() })`), the settings (`createDebugSettings(store)`), the log files (`createLogFiles({ dir: join(app.getPath('userData'), 'logs'), fs: <node:fs/promises mkdir with recursive, readdir, rm, appendFile>, now: () => new Date() })`).
2. A helper `liveWindow()` returning the first non-destroyed `BrowserWindow` or null.
3. The renderer link: `createRendererLink({ send: (request) => { const w = liveWindow(); if (!w) return false; w.webContents.send(DEBUG_REQUEST_CHANNEL, request); return true; } })`.
4. The window port: `state()` from `liveWindow()` (`isFocused`, `webContents.isFocused()`, `isVisible`, `isMinimized`; null with no window); `capture({ rect, maxWidth })` returns null when the window is not visible or is minimised, otherwise `webContents.capturePage(rect)`, shrinks it with `image.resize({ width: maxWidth })` only when wider than `maxWidth`, and returns `{ data: image.toPNG().toString('base64'), width, height }` of the resulting image; `sendText(text)` sends, for each character, `sendInputEvent` of type `keyDown`, `char` and `keyUp` with that `keyCode`; `announce(enabled)` sends `DEBUG_CHANGED_CHANNEL` to every window.
5. `const debug = createDebugController({ settings, recorder, logs, window: port, link })`; pass `debug` into `buildDeps` (add a parameter and a `debug` property).
6. Create the taps once a window exists. In `createWindow`, build `createMainTaps({ note: debug.note, win, contents: win.webContents, app })` and subscribe: `const off = debug.onChange((on) => (on ? taps.attach() : taps.detach()))`; if `debug.status().enabled` is already true, call `taps.attach()` now. On `win.on('closed')`, call `taps.detach()` and `off()`. `createWindow` receives `debug` as a new parameter, and both call sites pass it.
7. Wrap the three dialog call sites in `index.ts` (open dialog at the top `chooseDirectory` area, `showSaveDialog`, `showOpenDialog`, `showMessageBox`, around lines 133 to 182) with `dialogNote(debug.note, '<kind>', () => ...)`. Because those functions are defined outside `whenReady`, give the module a small mutable holder (`let debugNote: (c: string, n: string, d?: Record<string, unknown>) => void = () => {}`) assigned once the controller exists, and pass `(c, n, d) => debugNote(c, n, d)` to `dialogNote`.
8. After `registerIpc(api)`, call `void debug.start()` (log any error as the MCP start does) and add `app.on('will-quit', () => void debug.stop())`.

In `src/preload/index.ts` import the two channel constants and add `onDebugChanged` and `onDebugRequest` to the `appEvents` object, each registering an `ipcRenderer.on` handler like `onHoldEdits`. In `env.d.ts` add the two optional members, typed with `RendererRequest` imported from `@shared/ipc`.

- [ ] **Step 2: Typecheck and run the whole suite**

Run: `npm run typecheck` then `npx vitest run`
Expected: both clean. Fix any signature drift the compiler reports; do not loosen types.

- [ ] **Step 3: Launch and check by hand**

Run: `npm run dev`. In the window's DevTools (F12) run `await window.api.debugStatus()`. Expected: `ok: true`, `enabled: false`. Run `await window.api.debugSetEnabled(true)`; then `await window.api.debugEvents()` after clicking around and switching to another app and back. Expected: `window` focus/blur events and `input` `before-input` events with codes, no characters. Then `await window.api.debugSetEnabled(false)` and confirm `debugStatus().logFile` is null and `<userData>/logs/` holds one `.jsonl` file.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(debug): wire the controller, window port, taps and dialogs into the app"
```

---

### Task 9: Renderer: describe, focus snapshot, taps, bridge

**Files:**
- Create: `src/renderer/debug/describe.ts`, `src/renderer/debug/focus-snapshot.ts`, `src/renderer/debug/taps.ts`, `src/renderer/debug/bridge.ts`
- Modify: `src/renderer/App.tsx` (start the bridge in the existing `useEffect`)
- Test: `tests/renderer/debug-focus-snapshot.test.ts`, `tests/renderer/debug-taps.test.ts`, `tests/renderer/debug-bridge.test.ts`

**Interfaces:**
- Consumes: shared types from Task 1; `window.api.debugStatus/debugRecord/debugAnswer`; `window.appEvents.onDebugChanged/onDebugRequest` from Task 8.
- Produces:
  - `describeElement(el: Element | null): string | null`: `tag#id.firstClass[role=…]`, no other attributes, never a value; `input[type=password]` becomes exactly `[password]`.
  - `focusSnapshot(doc: Document): FocusSnapshot`; `fieldState(doc: Document, includeValue: boolean): FieldState | null` (value is `''` when `includeValue` is false; `null` when the active element is not a text field; `[password]` for a password field in both cases); `rectOf(doc: Document, selector: string): Rect | null`.
  - `attachTaps(options: { win: Window; report(event: DebugEventInput): void; now(): number; orphanMs?: number }): () => void` (default `orphanMs` 100).
  - `startDebugBridge(options: { api: Pick<Api, 'debugStatus' | 'debugRecord' | 'debugAnswer'>; events: { onDebugChanged?(h: (on: boolean) => void): void; onDebugRequest?(h: (r: RendererRequest) => void): void }; win: Window; flushMs?: number }): () => void` (default `flushMs` 250).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/renderer/debug-focus-snapshot.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { describeElement } from '../../src/renderer/debug/describe';
import { fieldState, focusSnapshot, rectOf } from '../../src/renderer/debug/focus-snapshot';

afterEach(() => { document.body.innerHTML = ''; });

describe('describing elements', () => {
  it('names tag, id, first class and role, and nothing else', () => {
    document.body.innerHTML = '<input id="npc-search" class="field wide" role="combobox" value="secret" placeholder="Find">';
    const text = describeElement(document.querySelector('input'))!;
    expect(text).toBe('input#npc-search.field[role=combobox]');
    expect(text).not.toContain('secret');
  });
  it('hides everything about a password field', () => {
    document.body.innerHTML = '<input id="pw" type="password" value="hunter2">';
    expect(describeElement(document.querySelector('input'))).toBe('[password]');
  });
  it('gives null for no element', () => {
    expect(describeElement(null)).toBeNull();
  });
});

describe('the focus snapshot', () => {
  it('describes the active field and whether it can take text', () => {
    document.body.innerHTML = '<input id="a"><input id="b" disabled><input id="c" readonly>';
    (document.getElementById('a') as HTMLInputElement).focus();
    expect(focusSnapshot(document)).toMatchObject({ active: 'input#a', activeState: { editable: true, disabled: false, readOnly: false }, blockedBy: [], coveredBy: null });
    document.getElementById('c')!.focus();
    expect(focusSnapshot(document).activeState).toEqual({ editable: false, disabled: false, readOnly: true });
  });

  it('reports ancestors that are inert or aria-hidden', () => {
    document.body.innerHTML = '<div id="outer" inert><div id="inner" aria-hidden="true"><input id="a"></div></div>';
    (document.getElementById('a') as HTMLInputElement).focus();
    expect(focusSnapshot(document).blockedBy).toEqual(['div#inner', 'div#outer']);
  });

  it('lists the open modals', () => {
    document.body.innerHTML = '<div id="m1" role="dialog" aria-modal="true"></div><div id="m2" class="modal" role="dialog"></div>';
    expect(focusSnapshot(document).modals).toEqual(['div#m1', 'div#m2.modal']);
  });

  it('reports what sits over the field when something else is at its centre', () => {
    document.body.innerHTML = '<input id="a"><div id="veil" class="overlay"></div>';
    const input = document.getElementById('a') as HTMLInputElement;
    input.focus();
    (document as any).elementFromPoint = () => document.getElementById('veil');
    expect(focusSnapshot(document).coveredBy).toBe('div#veil.overlay');
    (document as any).elementFromPoint = () => input;
    expect(focusSnapshot(document).coveredBy).toBeNull();
    delete (document as any).elementFromPoint;
  });

  it('survives a document with nothing focused', () => {
    const s = focusSnapshot(document);
    expect(s.active === null || s.active === 'body').toBe(true);
    expect(s.activeState).toBeNull();
  });
});

describe('field state and rectangles', () => {
  it('returns the value only when asked, and never a password', () => {
    document.body.innerHTML = '<input id="a" value="hello"><input id="pw" type="password" value="hunter2">';
    document.getElementById('a')!.focus();
    expect(fieldState(document, true)).toEqual({ target: 'input#a', value: 'hello' });
    expect(fieldState(document, false)).toEqual({ target: 'input#a', value: '' });
    document.getElementById('pw')!.focus();
    expect(fieldState(document, true)).toEqual({ target: '[password]', value: '[password]' });
  });
  it('is null when focus is not in a text field', () => {
    document.body.innerHTML = '<button id="b">x</button>';
    document.getElementById('b')!.focus();
    expect(fieldState(document, true)).toBeNull();
  });
  it('finds a selector\'s rectangle, or null', () => {
    document.body.innerHTML = '<div class="modal"></div>';
    const el = document.querySelector('.modal')!;
    (el as any).getBoundingClientRect = () => ({ x: 5.4, y: 6.6, width: 100.2, height: 50.5 });
    expect(rectOf(document, '.modal')).toEqual({ x: 5, y: 7, width: 100, height: 51 });
    expect(rectOf(document, '.nope')).toBeNull();
    expect(rectOf(document, '[[bad')).toBeNull();
  });
});
```

```ts
// tests/renderer/debug-taps.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachTaps } from '../../src/renderer/debug/taps';
import type { DebugEventInput } from '../../src/shared/ipc';

let events: DebugEventInput[];
let detach: () => void;
const input = () => document.getElementById('a') as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  document.body.innerHTML = '<input id="a" value="secret"><button id="b">go</button>';
  detach = attachTaps({ win: window, report: (e) => events.push(e), now: () => Date.now() });
});
afterEach(() => { detach(); vi.useRealTimers(); document.body.innerHTML = ''; });

const key = (target: Element, type: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));

describe('the renderer taps', () => {
  it('records keydown and keyup with code and modifiers but not the character', () => {
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA', ctrlKey: true });
    key(input(), 'keyup', { key: 'a', code: 'KeyA' });
    expect(events.map((e) => [e.category, e.name])).toEqual([['input', 'keydown'], ['input', 'keyup']]);
    expect(events[0]!.data).toMatchObject({ code: 'KeyA', ctrl: true, shift: false, alt: false, meta: false, target: 'input#a', defaultPrevented: false });
    expect(JSON.stringify(events)).not.toContain('"key"');
    expect(JSON.stringify(events)).not.toContain('"a"');
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('records beforeinput and input by type only, never their data', () => {
    input().focus();
    input().dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'a', inputType: 'insertText' }));
    input().dispatchEvent(new InputEvent('input', { bubbles: true, data: 'a', inputType: 'insertText' }));
    expect(events.map((e) => e.name)).toEqual(['beforeinput', 'input']);
    expect(events[1]!.data).toMatchObject({ inputType: 'insertText', target: 'input#a' });
    expect(JSON.stringify(events)).not.toContain('"data":"a"');
  });

  it('records focus changes and visibility', () => {
    input().focus();
    document.getElementById('b')!.focus();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(events.filter((e) => e.category === 'focus').map((e) => e.name)).toEqual(['focusin', 'focusout', 'focusin']);
    expect(events.some((e) => e.name === 'visibilitychange')).toBe(true);
  });

  it('is quiet about a typed key that produced its input', () => {
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA' });
    input().dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }));
    input().dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    vi.advanceTimersByTime(500);
    expect(events.some((e) => e.name === 'orphan-key')).toBe(false);
  });

  it('flags a printable key in a text field that produced nothing, with a focus snapshot', () => {
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA' });
    vi.advanceTimersByTime(100);
    const orphan = events.find((e) => e.name === 'orphan-key')!;
    expect(orphan.category).toBe('input');
    expect(orphan.data).toMatchObject({ code: 'KeyA', target: 'input#a', defaultPrevented: false });
    expect((orphan.data as any).focus).toMatchObject({ active: 'input#a' });
    expect(JSON.stringify(orphan)).not.toContain('secret');
  });

  it('says when a handler cancelled the key', () => {
    input().focus();
    input().addEventListener('keydown', (e) => e.preventDefault());
    key(input(), 'keydown', { key: 'a', code: 'KeyA' });
    vi.advanceTimersByTime(100);
    expect(events.find((e) => e.name === 'orphan-key')!.data).toMatchObject({ defaultPrevented: true });
  });

  it('does not flag shortcuts, non-printing keys, buttons or read-only fields', () => {
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA', ctrlKey: true });
    key(input(), 'keydown', { key: 'Enter', code: 'Enter' });
    key(input(), 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft' });
    document.getElementById('b')!.focus();
    key(document.getElementById('b')!, 'keydown', { key: 'a', code: 'KeyA' });
    input().readOnly = true;
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA' });
    vi.advanceTimersByTime(500);
    expect(events.some((e) => e.name === 'orphan-key')).toBe(false);
  });

  it('records window.confirm and alert around the native dialog, and restores them on detach', () => {
    const original = vi.fn(() => true);
    window.confirm = original as never;
    detach();
    detach = attachTaps({ win: window, report: (e) => events.push(e), now: () => Date.now() });
    expect(window.confirm('Sure?')).toBe(true);
    expect(events.filter((e) => e.category === 'dialog').map((e) => e.name)).toEqual(['confirm-open', 'confirm-close']);
    expect(JSON.stringify(events)).not.toContain('Sure?');
    detach();
    expect(window.confirm).toBe(original);
  });

  it('records errors and unhandled rejections', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'a.ts', lineno: 3 }));
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
    rejection.reason = new Error('nope');
    window.dispatchEvent(rejection);
    expect(events.filter((e) => e.category === 'error').map((e) => e.name)).toEqual(['error', 'unhandledrejection']);
  });

  it('detaches every listener', () => {
    detach();
    events.length = 0;
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA' });
    window.dispatchEvent(new ErrorEvent('error', { message: 'x' }));
    vi.advanceTimersByTime(500);
    expect(events).toEqual([]);
  });
});
```

```ts
// tests/renderer/debug-bridge.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDebugBridge } from '../../src/renderer/debug/bridge';
import type { RendererRequest } from '../../src/shared/ipc';

const ok = <T,>(value: T) => ({ ok: true as const, value });

function rig(enabled: boolean) {
  const record = vi.fn(async () => ok(null));
  const answer = vi.fn(async () => ok(null));
  const handlers: { changed?: (on: boolean) => void; request?: (r: RendererRequest) => void } = {};
  const stop = startDebugBridge({
    api: { debugStatus: async () => ok({ enabled } as never), debugRecord: record as never, debugAnswer: answer as never },
    events: { onDebugChanged: (h) => { handlers.changed = h; }, onDebugRequest: (h) => { handlers.request = h; } },
    win: window,
    flushMs: 250,
  });
  return { record, answer, handlers, stop };
}
const press = (el: Element) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<input id="a" value="hello">'; });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the debug bridge', () => {
  it('asks the main process whether Debug mode is on at start, and records nothing when it is off', async () => {
    const { record, stop } = rig(false);
    await settle();
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).not.toHaveBeenCalled();
    stop();
  });

  it('attaches the taps when it starts on and sends what they record in one batch about every 250 ms', async () => {
    const { record, stop } = rig(true);
    await settle();
    document.getElementById('a')!.focus();
    press(document.getElementById('a')!);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(record).toHaveBeenCalledTimes(1);
    const batch = (record.mock.calls[0] as unknown[])[0] as { name: string }[];
    expect(batch.map((e) => e.name)).toContain('keydown');
    stop();
  });

  it('follows the pushed flag: on attaches, off detaches and flushes nothing more', async () => {
    const { record, handlers, stop } = rig(false);
    await settle();
    handlers.changed!(true);
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(250);
    expect(record).toHaveBeenCalledTimes(1);
    handlers.changed!(false);
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).toHaveBeenCalledTimes(1);
    stop();
  });

  it('answers a snapshot request with the focus state, with the value only when asked', async () => {
    const { answer, handlers, stop } = rig(true);
    await settle();
    document.getElementById('a')!.focus();
    handlers.request!({ id: 5, kind: 'snapshot', includeValue: true });
    handlers.request!({ id: 6, kind: 'snapshot', includeValue: false });
    expect((answer.mock.calls[0] as unknown[])[0]).toBe(5);
    expect((answer.mock.calls[0] as any)[1]).toMatchObject({ focus: { active: 'input#a' }, field: { target: 'input#a', value: 'hello' } });
    expect((answer.mock.calls[1] as any)[1].field.value).toBe('');
    stop();
  });

  it('answers a rect request for a selector', async () => {
    const { answer, handlers, stop } = rig(true);
    await settle();
    (document.getElementById('a') as any).getBoundingClientRect = () => ({ x: 1, y: 2, width: 3, height: 4 });
    handlers.request!({ id: 9, kind: 'rect', selector: '#a' });
    expect(answer).toHaveBeenCalledWith(9, { rect: { x: 1, y: 2, width: 3, height: 4 } });
    stop();
  });

  it('answers requests even when Debug mode is off, so a probe never hangs on a quiet window', async () => {
    const { answer, handlers, stop } = rig(false);
    await settle();
    handlers.request!({ id: 1, kind: 'rect', selector: '.nope' });
    expect(answer).toHaveBeenCalledWith(1, { rect: null });
    stop();
  });

  it('stop() removes the taps and the timer', async () => {
    const { record, stop } = rig(true);
    await settle();
    stop();
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/debug-focus-snapshot.test.ts tests/renderer/debug-taps.test.ts tests/renderer/debug-bridge.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`describe.ts`: password inputs (`type=password`) give exactly `[password]`; otherwise `tag`, then `#id` if present, then `.` plus the first class if present, then `[role=…]` if present. Nothing else, and never an attribute value other than id, first class and role.

`focus-snapshot.ts`: `focusSnapshot` reads `doc.hasFocus()`, `doc.activeElement` (null active and null `activeState` when it is `body` or absent; `active` described otherwise); `activeState` gives `editable` (an enabled, not read-only `input` of a text-like type, a `textarea`, or `isContentEditable`), `disabled`, `readOnly`; `blockedBy` walks the active element's ancestors (not itself) collecting those that have the `inert` attribute or `aria-hidden="true"`, innermost first, described; `modals` lists `[role=dialog]` and `[aria-modal=true]` elements in document order, described; `coveredBy` is only computed when `doc.elementFromPoint` is a function and the active element has a bounding rectangle: take its centre, ask `elementFromPoint`, and if the answer is neither the active element nor a descendant or ancestor of it, describe the answer, otherwise null. `fieldState` returns null unless the active element is a text-like field; value is `''` when `includeValue` is false, `[password]` for passwords either way. `rectOf` uses `querySelector` inside try/catch (an invalid selector gives null) and rounds the four numbers of `getBoundingClientRect()` to whole numbers.

`taps.ts`: all listeners are on `win` or `win.document` in the capture phase. Record, via `report({ at: now(), category, name, data })`: `keydown`/`keyup` (`input` category; data `code`, `ctrl`, `shift`, `alt`, `meta`, `repeat`, `target`, `defaultPrevented`), `beforeinput`/`input` (data `inputType`, `target`, never `data`), `focusin`/`focusout` (`focus` category; `target`), `blur` and `focus` of the window (`window` category), `visibilitychange` (`window` category; `state`), `error` and `unhandledrejection` (`error` category; message strings only, truncated to 300 characters). The orphan detector: on `keydown` where `key.length === 1`, no ctrl or meta, the target is an enabled, not read-only text field, start a timer of `orphanMs`; a `beforeinput` or `input` from the same target before it fires cancels it; when it fires, report `input`/`orphan-key` with `code`, `target`, the keydown event's `defaultPrevented` read at that moment, and `focus: focusSnapshot(doc)`. `window.confirm` and `window.alert` are replaced with wrappers that report `dialog`/`<kind>-open`, call the original, report `<kind>-close` (in `finally`), never recording the message; `detach` restores the exact originals, removes every listener, and clears any pending orphan timer. `attachTaps` returns `detach`.

`bridge.ts`: on start, call `api.debugStatus()` and, if enabled, attach the taps; register `events.onDebugChanged` to attach or detach (attach is idempotent; detach also flushes nothing and stops the timer); register `events.onDebugRequest` to answer every request whether or not Debug mode is on: for `snapshot` call `api.debugAnswer(id, { focus: focusSnapshot(doc), field: fieldState(doc, includeValue) })`, for `rect` call `api.debugAnswer(id, { rect: rectOf(doc, selector) })`. While attached, collect reported events in an array and flush it with `api.debugRecord(batch)` every `flushMs` (skip empty batches), and flush once more when the page becomes hidden. The returned function detaches the taps and clears the timer. Failures from the API calls are swallowed.

`App.tsx`: in the existing effect that registers `window.appEvents` handlers, call `startDebugBridge({ api: window.api, events: window.appEvents ?? {}, win: window })` and return its stop function from the effect's cleanup (add a cleanup if there is none).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/debug-focus-snapshot.test.ts tests/renderer/debug-taps.test.ts tests/renderer/debug-bridge.test.ts` then `npx vitest run tests/renderer` then `npm run typecheck`
Expected: PASS; no existing renderer test regresses (some mount `App` without `window.api.debugStatus`; if one fails because of the bridge, make the bridge a no-op when `api.debugStatus` is not a function, and say so in a comment).

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat(debug): the window's recorder: input, focus and dialog taps, an orphan-key detector and the request/answer bridge"
```

---

### Task 10: The Preferences switch

**Files:**
- Modify: `src/renderer/views/settings/PreferencesSection.tsx`, the stylesheet that holds `.settings-prefs` rules (find it with `grep -rn "settings-prefs" src/renderer --include=*.css`)
- Test: `tests/renderer/settings-debug.test.tsx`

**Interfaces:**
- Consumes: `window.api.debugStatus`, `window.api.debugSetEnabled` (Task 1).
- Produces: a "Diagnostics" group in the Preferences tab with a checkbox labelled exactly `Debug mode`, and a status line.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/renderer/settings-debug.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreferencesSection } from '../../src/renderer/views/settings/PreferencesSection';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv } from './mock-api';

afterEach(() => { cleanup(); delete (window as any).api; });

const status = (over: Record<string, unknown> = {}) => ({ enabled: false, events: 0, capacity: 5000, logFile: null, logFailures: 0, logTruncated: false, window: null, ...over });

function mount(initial = status(), over: Record<string, any> = {}) {
  const calls: boolean[] = [];
  const api = makeMockApi({
    debugStatus: async () => okv(initial),
    debugSetEnabled: async (on: boolean) => { calls.push(on); return okv(status({ enabled: on, logFile: on ? 'C:/logs/debug-1.jsonl' : null })); },
    ...over,
  });
  Object.defineProperty(window, 'api', { value: api, configurable: true });
  render(<PreferencesSection store={createAppStore(api, { saveDelayMs: 0 })} onClose={() => {}} setBusy={() => {}} />);
  return calls;
}

describe('the Debug mode switch in Preferences', () => {
  it('is off by default and shows no log path', async () => {
    mount();
    expect(await screen.findByRole('checkbox', { name: 'Debug mode' })).not.toBeChecked();
    expect(screen.queryByText(/debug-1\.jsonl/)).toBeNull();
  });

  it('reflects a saved on state and names the log file', async () => {
    mount(status({ enabled: true, logFile: 'C:/logs/debug-1.jsonl' }));
    expect(await screen.findByRole('checkbox', { name: 'Debug mode' })).toBeChecked();
    expect(screen.getByText(/C:\/logs\/debug-1\.jsonl/)).toBeInTheDocument();
  });

  it('turning it on calls the API once and then shows the log path', async () => {
    const calls = mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Debug mode' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Debug mode' })).toBeChecked());
    expect(calls).toEqual([true]);
    expect(await screen.findByText(/debug-1\.jsonl/)).toBeInTheDocument();
  });

  it('says what it records and what it does not', async () => {
    mount();
    expect(await screen.findByText(/key codes and focus changes/i)).toBeInTheDocument();
    expect(screen.getByText(/never the characters you type/i)).toBeInTheDocument();
  });

  it('shows the error when the main process refuses', async () => {
    mount(status(), { debugSetEnabled: async () => ({ ok: false, error: { code: 'UNKNOWN', message: 'Debug mode is not available in this build.' } }) });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Debug mode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Debug mode is not available in this build.');
    expect(screen.getByRole('checkbox', { name: 'Debug mode' })).not.toBeChecked();
  });

  it('keeps the existing layout choices', async () => {
    mount();
    expect(await screen.findByRole('radio', { name: 'Under the world' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/settings-debug.test.tsx`
Expected: FAIL (no checkbox).

- [ ] **Step 3: Implement**

In `PreferencesSection`, keep the Layout group untouched. Add a `Diagnostics` heading and a group with one checkbox whose accessible name is exactly `Debug mode` (a `<label>` wrapping the input). On mount it calls `window.api.debugStatus()` and stores the value in component state; changing the checkbox calls `window.api.debugSetEnabled(next)`, replaces the state with the returned status on success, and on failure shows the error message in a `role="alert"` paragraph and leaves the checkbox as it was. Below the checkbox, a paragraph: "Records key codes and focus changes, window and dialog events, and errors, so a problem like text fields that stop typing can be traced. It never records the characters you type or what is in a field." When the status has a `logFile`, add a line "Log file: <path>". Style with the same classes and tokens as the Layout group.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/settings-debug.test.tsx tests/renderer/settings-mcp.test.tsx` then `npx vitest run tests/renderer`
Expected: PASS, including every existing Settings test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/renderer/settings-debug.test.tsx
git commit -m "feat(settings): a Debug mode switch in Preferences"
```

---

### Task 11: End to end, and the guide

**Files:**
- Create: `tests/e2e/debug.e2e.ts`
- Modify: `site/src/content/docs/guides/ai-mcp.md`, `site/src/content/docs/reference/settings.md`, `site/src/content/docs/reference/troubleshooting.md`

**Interfaces:**
- Consumes: the whole feature through a real Electron window and a real MCP client, the way `tests/e2e/mcp.e2e.ts` does.

- [ ] **Step 1: Write the end-to-end test**

```ts
// tests/e2e/debug.e2e.ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0])));

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  await running?.close();
  running = undefined;
});

test('Debug mode records nothing until switched on, reads back through MCP, and stops when switched off', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'acqc-ud-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: userData, ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();
  const api = <T,>(call: string, ...args: unknown[]) => page.evaluate(([c, a]) => (globalThis as any).api[c as string](...(a as unknown[])), [call, args] as const) as Promise<{ ok: boolean; value: T; error?: { code: string; message: string } }>;

  const off: any = await api('debugStatus');
  expect(off.value).toMatchObject({ enabled: false, events: 0, logFile: null });
  const gated: any = await api('debugSnapshot');
  expect(gated).toMatchObject({ ok: false, error: { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' } });

  const port = await freePort();
  const mcp: any = (await api('mcpConfigure', { enabled: true, port })).value;
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { authorization: `Bearer ${mcp.token}` } } }));
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['debug_status', 'debug_events', 'debug_snapshot', 'debug_type', 'screenshot']));

  // The screenshot needs no setting
  const shot: any = await client.callTool({ name: 'screenshot', arguments: { maxWidth: 400 } });
  expect(shot.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(shot.content[1].data.length).toBeGreaterThan(100);

  // Nothing is recorded while off
  await page.keyboard.press('KeyA');
  expect(JSON.parse(((await client.callTool({ name: 'debug_events', arguments: {} })) as any).content[0].text)).toEqual([]);

  // On: the window and the main process both record
  const on: any = await api('debugSetEnabled', true);
  expect(on.value.enabled).toBe(true);
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<input id="probe" aria-label="probe">'); (document.getElementById('probe') as HTMLInputElement).focus(); });
  await page.keyboard.type('hi');
  await page.waitForTimeout(600);
  const events = JSON.parse(((await client.callTool({ name: 'debug_events', arguments: {} })) as any).content[0].text) as { source: string; category: string; name: string; data: Record<string, unknown> }[];
  expect(events.some((e) => e.source === 'main' && e.name === 'before-input')).toBe(true);
  expect(events.some((e) => e.source === 'renderer' && e.name === 'keydown' && e.data['code'] === 'KeyH')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('"hi"');

  // The live probe: typing works, and the report says so
  const typed = JSON.parse(((await client.callTool({ name: 'debug_type', arguments: { text: 'ok' } })) as any).content[0].text);
  expect(typed).toMatchObject({ typed: 2, changed: true, after: { value: 'hiok' } });
  const snapshot = JSON.parse(((await client.callTool({ name: 'debug_snapshot', arguments: {} })) as any).content[0].text);
  expect(snapshot).toMatchObject({ rendererAnswered: true, renderer: { active: 'input#probe' } });

  // Off: recording stops and the log is closed with a file in place
  const status: any = (await api('debugSetEnabled', false)).value;
  expect(status).toMatchObject({ enabled: false, logFile: null });
  const before = (await api<unknown[]>('debugEvents')).value.length;
  await page.keyboard.type('zz');
  await page.waitForTimeout(600);
  expect((await api<unknown[]>('debugEvents')).value.length).toBe(before);
  expect(readdirSync(join(userData, 'logs')).filter((f) => /^debug-.*\.jsonl$/.test(f))).toHaveLength(1);
  await client.close();
});
```

- [ ] **Step 2: Run it to see it fail, then pass**

Run: `npm run test:e2e -- tests/e2e/debug.e2e.ts`
Expected: with Tasks 1 to 10 done it should PASS. A failure here is real information: read the failing line, fix the cause in the owning task's code, and rerun. Do not weaken an assertion to get a pass.

- [ ] **Step 3: Write the guide**

In `site/src/content/docs/guides/ai-mcp.md` add a section "Debug mode and the screenshot tool" covering: where the switch is (Settings, Preferences, Diagnostics), what is recorded and what never is, where the log goes and how many files are kept, the five tools with one line each (which need the switch and which do not), and a worked example, "The keyboard stopped working": turn Debug mode on, reproduce, then ask the assistant to read `debug_events` for `orphan-key` and `before-input`, run `debug_snapshot`, run `debug_type`, and take a `screenshot`, with how to read each result (main sees keys but the page does not: the window lost the keyboard; the page sees keys and an `orphan-key` with `defaultPrevented: true`: something cancelled them; a `blockedBy` or `coveredBy` entry: something sits over or disables the field). In `reference/settings.md` add the Debug mode row to the Preferences table. In `reference/troubleshooting.md` add a short entry "Text fields ignore the keyboard" pointing to the guide section.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck` then `npx vitest run` then `npm run docs:build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/debug.e2e.ts site/src/content/docs
git commit -m "docs: debug mode and screenshot, with an end-to-end test"
```
