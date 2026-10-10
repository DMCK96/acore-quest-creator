import type { DebugEventInput } from '@shared/ipc';
import { describeElement } from './describe';
import { focusSnapshot } from './focus-snapshot';

const DEFAULT_ORPHAN_MS = 100;
const MAX_MESSAGE = 300;

type Report = (event: DebugEventInput) => void;

const clip = (text: string): string => (text.length > MAX_MESSAGE ? text.slice(0, MAX_MESSAGE) : text);

/** An enabled, writable field that takes text */
function takesText(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return !(el as HTMLTextAreaElement).disabled && !(el as HTMLTextAreaElement).readOnly;
  if (tag !== 'input') return false;
  const field = el as HTMLInputElement;
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(field.type) && !field.disabled && !field.readOnly;
}

/**
 * The window's recorders for Debug mode: keys (by code, never the character), text input (by type, never
 * its data), focus, visibility, errors and native dialogs. `attachTaps` returns the function that removes
 * every one of them. A printable key in a text field that produces no input within `orphanMs` is reported
 * as `orphan-key`, with a focus snapshot: that is the signature of "the field ignores the keyboard".
 */
export function attachTaps(options: { win: Window; report: Report; now(): number; orphanMs?: number }): () => void {
  const { win, report, now } = options;
  const orphanMs = options.orphanMs ?? DEFAULT_ORPHAN_MS;
  const doc = win.document;
  const emit = (category: string, name: string, data: Record<string, unknown> = {}): void => report({ at: now(), category, name, data });
  const removers: (() => void)[] = [];
  const listen = (target: EventTarget, type: string, handler: (event: any) => void): void => {
    target.addEventListener(type, handler, true);
    removers.push(() => target.removeEventListener(type, handler, true));
  };

  let orphan: { timer: ReturnType<typeof setTimeout>; target: EventTarget | null } | null = null;
  const settle = (): void => {
    if (orphan) clearTimeout(orphan.timer);
    orphan = null;
  };

  for (const type of ['keydown', 'keyup'] as const) {
    listen(win, type, (event: KeyboardEvent) => {
      emit('input', type, {
        code: event.code,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
        repeat: event.repeat,
        target: describeElement(event.target as Element | null),
        defaultPrevented: event.defaultPrevented,
      });
      if (type !== 'keydown' || event.key.length !== 1 || event.ctrlKey || event.metaKey || !takesText(event.target)) return;
      settle();
      const target = event.target;
      orphan = {
        target,
        timer: setTimeout(() => {
          orphan = null;
          // Read now, after the page's own handlers have had their turn
          emit('input', 'orphan-key', { code: event.code, target: describeElement(target as Element | null), defaultPrevented: event.defaultPrevented, focus: focusSnapshot(doc) });
        }, orphanMs),
      };
    });
  }

  for (const type of ['beforeinput', 'input'] as const) {
    listen(win, type, (event: InputEvent) => {
      emit('input', type, { inputType: event.inputType, target: describeElement(event.target as Element | null) });
      if (orphan && orphan.target === event.target) settle();
    });
  }

  for (const type of ['focusin', 'focusout'] as const) {
    listen(win, type, (event: FocusEvent) => emit('focus', type, { target: describeElement(event.target as Element | null) }));
  }
  // Capturing also sees every element's own focus and blur; only the window's are wanted
  for (const type of ['focus', 'blur'] as const) {
    listen(win, type, (event: Event) => {
      if (event.target === win) emit('window', type);
    });
  }
  listen(doc, 'visibilitychange', () => emit('window', 'visibilitychange', { state: doc.visibilityState }));
  listen(win, 'error', (event: ErrorEvent) => emit('error', 'error', { message: clip(String(event.message ?? '')) }));
  listen(win, 'unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    emit('error', 'unhandledrejection', { message: clip(reason instanceof Error ? reason.message : String(reason)) });
  });

  // A native dialog stops the page, so it is bracketed on the timeline; the message is never recorded
  for (const kind of ['confirm', 'alert'] as const) {
    const original = win[kind];
    const wrapper = function (this: unknown, ...args: unknown[]) {
      emit('dialog', `${kind}-open`);
      try {
        return (original as (...a: unknown[]) => unknown).apply(win, args);
      } finally {
        emit('dialog', `${kind}-close`);
      }
    };
    (win as any)[kind] = wrapper;
    removers.push(() => {
      // Put back only our own wrapper: a replacement installed since is not ours to undo
      if ((win as any)[kind] === wrapper) (win as any)[kind] = original;
    });
  }

  return () => {
    settle();
    for (const remove of removers.splice(0)) remove();
  };
}
