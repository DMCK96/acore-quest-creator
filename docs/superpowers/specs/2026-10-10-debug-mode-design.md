# Debug mode and live diagnostics: design

Written for the people who build and maintain the editor, and for the AI client that reads the MCP server.

## Goal

Catch bugs that only show in a live window, first of all the intermittent "text fields ignore the keyboard" bug (issue #9), while they are happening. Today the console shows asset noise and nothing about input, focus or the window. The editor gets:

- a **Debug mode** switch in Preferences, off by default, that turns on extra recording and nothing else;
- a **timeline of events from both processes**, held in memory and written to a log file only while the switch is on;
- **MCP tools** that read the timeline and probe the live window, so an AI client can reproduce and measure a fault in the broken state instead of asking the user to paste commands;
- a general **screenshot** tool, always available, so an AI client can see the result of a change.

When Debug mode is off, no listener is attached, no event is recorded and no file is written.

## Why the input bug needs both processes

"Outline shows, no text appears" has two possible causes the console cannot tell apart: the keys never reach the page (Electron or the OS took keyboard focus away), or the page receives them and something consumes them. Electron's `before-input-event` in the main process sees a key before the page does. Put beside what the page then receives, it splits the two causes.

## Scope

In:
- Debug flag, event buffer, log file, the two recorders, five MCP tools, the Preferences row, a short guide.
- `screenshot` as a general tool, not gated by Debug mode.

Out (later, if wanted): attaching the Chrome DevTools Protocol, performance profiling, sending logs anywhere off the machine, an in-app log viewer.

## Architecture

```
renderer taps ──batched IPC──▶ main: DebugRecorder ◀── main taps
   (only when on)               ring buffer + log file      (only when on)
                                       ▲
                        Api: debugStatus / debugConfigure / debugEvents
                             debugSnapshot / debugType / screenshot
                                       ▲
                              MCP tools (through ctx.call)
```

### Units

**`src/main/debug/recorder.ts` — `DebugRecorder`.** Owns the ring buffer (5,000 events, oldest dropped) and the optional log file. Interface: `record(event)`, `events({ since, categories, limit })`, `enable()`, `disable()`, `clear()`. Depends on a clock and a file sink, both injected, so it is tested without Electron. Every event carries `t` (ms since the app started, from one monotonic clock in main), `source` (`main` or `renderer`), `category`, `name` and a small `data` object. Renderer events are re-stamped on arrival using an offset measured when debug mode is switched on, so the two sources sort into one timeline.

**`src/main/debug/main-taps.ts`.** Attaches while enabled and detaches when disabled. Records:
- `input` / `before-input-event`: key code, modifiers, type. Never the character itself (see Privacy).
- `window`: focus, blur, show, hide, minimize, restore; `webContents.isFocused()` sampled with each.
- `dialog`: the main-process dialogs in `src/main/index.ts` bracketed as open and close, with their kind.
- `health`: `render-process-gone`, `child-process-gone`, `unresponsive` / `responsive`, `did-fail-load`.

**`src/renderer/debug/taps.ts`.** Attaches window-level capture-phase listeners while enabled, and removes them when disabled:
- `keydown`, `keyup`, `beforeinput`, `input`, `focusin`, `focusout`, `blur`, `visibilitychange`, each with a short description of the target (tag, id, role, a short selector path) and `defaultPrevented`.
- **Orphan keystroke detector.** A printable `keydown` in a text field with no `beforeinput`/`input` within 100 ms becomes one `orphan-key` event with a focus snapshot attached. This is the event that marks the bug.
- Long main-thread tasks (PerformanceObserver `longtask`), `error` and `unhandledrejection`, and `window.confirm` / `alert` calls (wrapped while enabled), so a native dialog shows on the timeline.
- Events are batched and sent about every 250 ms on one one-way channel; a hidden page flushes on `visibilitychange`.

**Focus snapshot (shared helper).** `document.hasFocus()`, `document.activeElement` (described), its `isContentEditable` / `disabled` / `readOnly`, any ancestor with `inert` or `aria-hidden`, the open modal stack (`[role=dialog]`, `aria-modal`), and `document.elementFromPoint` at the field's centre, to show whether something sits over it. It is a plain function returning plain data.

**Api and tools.** A new `DebugApi` (`src/main/api/debug-api.ts`) with the methods below, listed in `API_METHODS`. Each MCP tool goes through `ctx.call`, as every tool does.

| Tool | Gated by Debug mode | What it does |
|---|---|---|
| `debug_status` | no | Whether it is on, buffer size, log file path, window focus state now. |
| `debug_events` | answers an empty list with a hint when off | Events since a time, filtered by category, newest last, capped. |
| `debug_snapshot` | yes | Asks the window for a focus snapshot now and returns it with main's view (`isFocused`, `isVisible`, which dialog is open). |
| `debug_type` | yes | Sends real key events to the window with `webContents.sendInputEvent` into whatever has focus, then reports the field's value before and after and the events they produced. This is the live test of "does typing work now". |
| `screenshot` | **no** | Captures the window with `webContents.capturePage`, optionally cropped to a rectangle or to the element matching a selector, scaled to at most 1600 px wide, returned as an image with the window's focus state alongside. |

Switching Debug mode on or off is **not** an MCP tool. Only the user can turn it on, from Preferences, so an AI client cannot start recording by itself.

**Image results.** `createMcpServer` returns JSON text only. `ToolDef` gains an optional `image(value)` that returns `{ data, mimeType }`; the server then answers with an `image` content block plus the JSON text. This is the one change to the shared MCP code.

**Setting.** The flag is stored as `debug.enabled` in the main store, next to `mcp.enabled` (`src/main/debug/settings.ts`), not in the renderer's `localStorage` preferences, because the main process must know it. The window reads it over `debugStatus` and listens on a new `DEBUG_CHANGED_CHANNEL` push from main, so a change applies at once in both processes and survives a restart. The Preferences screen gets a "Diagnostics" group with one checkbox, "Debug mode", and a line that says what it records and where the log goes.

### Log file

While on, events are appended as JSON lines to `<userData>/logs/debug-<start-time>.jsonl`. The file is created when the switch goes on and closed when it goes off. At most 5 files are kept; older ones are deleted when a new one starts. A file stops growing at 20 MB (one `truncated` event is written, then nothing more). Write failures are counted and shown in `debug_status`, never thrown into the app.

### Privacy

The recorder keeps key codes and modifiers, not the characters typed, and never the value of a field, except in `debug_type`'s before/after, which the caller asked for and which is not stored. Password fields are described as `[password]` and nothing else. Screenshots are returned to the caller and not stored. Everything stays on the machine; the MCP server is local and token-guarded already.

## Data flow for the input bug

1. User turns on Debug mode in Preferences. Main enables its taps and tells the window, which attaches its own.
2. The user works as normal. The timeline fills.
3. Typing stops working. The next keystroke in a field produces `before-input-event` in main. If the page sees it, the renderer records `keydown` then, if nothing consumed it, an `orphan-key` with its snapshot. If the page never sees it, there is a main `input` event and no renderer `keydown`.
4. The AI client calls `debug_events` and `debug_snapshot`, then `debug_type` to confirm, then `screenshot` to see the screen. The decisive facts (window focus, a recent dialog, a stray `inert`, an overlay) are all in those answers.

## Errors

- Debug mode off: `debug_snapshot` and `debug_type` fail with `BAD_REQUEST` and the message "Turn on Debug mode in Preferences first."
- No window (headless, tests): window-dependent tools fail with `UNKNOWN` and a plain message; `debug_events` still works.
- The window does not answer a snapshot within 2 s: the answer carries main's view alone and says the page did not respond. That is itself the evidence for a stalled renderer.
- A screenshot of a hidden or minimised window fails with a message saying so.

## Testing

- `DebugRecorder`: ring drops oldest, filters by time and category, clock offset merges two sources in order, file rotation and the 20 MB stop, a failing sink is counted and swallowed, disabled means `record` does nothing.
- Renderer taps (jsdom): a key in an input yields `keydown`, `beforeinput`, `input` and no orphan; a prevented `keydown` yields the orphan with `defaultPrevented`; detaching removes every listener (checked by dispatching and seeing no record); printable characters never appear in any event.
- Focus snapshot: an `inert` ancestor, an overlay at the field's centre, and a disabled field are each reported.
- Tools: through the real MCP surface test (`tests/main/mcp-tools-surface.test.ts` must list them and pass), gating messages when off, `screenshot` returns an image block.
- Settings: the flag persists, changing it reaches both processes, and the default is off.
- One Playwright/Electron end-to-end: turn Debug mode on, type into a field, read the events through the API, turn it off, and confirm nothing more is recorded and no listener remains.

## Docs

A short section in the existing MCP guide: how to turn Debug mode on, what each tool returns, the privacy rules, and a worked example for "the keyboard stopped working".

## Review focus

- The window and the main process agree on whether Debug mode is on, including at start-up and after a crash and reload.
- Nothing is attached or recorded when it is off.
- The recorder never stores typed characters or field values.
- `debug_type` cannot be used while Debug mode is off, and Debug mode cannot be switched on from MCP.
- Adding a tool to the list still follows the existing rule that tools use `ctx.call`.
