type Listener = (...args: any[]) => void;

/** The part of an Electron emitter the taps use, so they are tested without Electron */
export interface Emitter {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
}

type Note = (category: string, name: string, data?: Record<string, unknown>) => void;

/**
 * What the main process sees that the page cannot: a key before the page gets it, the window gaining and
 * losing focus, and the page or a helper process dying or hanging. Attached only while Debug mode is on.
 * A key is recorded by code and modifiers, never the character.
 */
export function createMainTaps(options: { note: Note; win: Emitter; contents: Emitter & { isFocused(): boolean }; app: Emitter }): { attach(): void; detach(): void } {
  const { note, win, contents, app } = options;
  let attached: { target: Emitter; event: string; listener: Listener }[] | null = null;

  const build = () => {
    const taps: { target: Emitter; event: string; listener: Listener }[] = [];
    const tap = (target: Emitter, event: string, listener: Listener) => taps.push({ target, event, listener });

    for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) {
      tap(win, event, () => note('window', event, { contentsFocused: contents.isFocused() }));
    }
    tap(contents, 'before-input-event', (_event, input) =>
      note('input', 'before-input', { type: input.type, code: input.code, ctrl: input.control, shift: input.shift, alt: input.alt, meta: input.meta, repeat: input.isAutoRepeat }),
    );
    tap(contents, 'render-process-gone', (_event, details) => note('health', 'render-process-gone', { reason: details.reason, exitCode: details.exitCode }));
    tap(contents, 'unresponsive', () => note('health', 'unresponsive'));
    tap(contents, 'responsive', () => note('health', 'responsive'));
    tap(contents, 'did-fail-load', (_event, code, description) => note('health', 'did-fail-load', { code, description }));
    tap(app, 'child-process-gone', (_event, details) => note('health', 'child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode }));
    return taps;
  };

  return {
    attach() {
      if (attached) return;
      attached = build();
      for (const { target, event, listener } of attached) target.on(event, listener);
    },
    detach() {
      for (const { target, event, listener } of attached ?? []) target.off(event, listener);
      attached = null;
    },
  };
}

/** A native dialog shown as open and close on the timeline (close also when it throws) */
export async function dialogNote<T>(note: Note, kind: string, work: () => Promise<T>): Promise<T> {
  note('dialog', 'open', { kind });
  try {
    return await work();
  } finally {
    note('dialog', 'close', { kind });
  }
}
