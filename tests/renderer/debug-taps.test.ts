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
afterEach(() => { (document.activeElement as HTMLElement | null)?.blur?.(); detach(); vi.useRealTimers(); document.body.innerHTML = ''; });

const key = (target: Element, type: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));

describe('the renderer taps', () => {
  it('records keydown and keyup with code and modifiers but not the character', () => {
    input().focus();
    key(input(), 'keydown', { key: 'a', code: 'KeyA', ctrlKey: true });
    key(input(), 'keyup', { key: 'a', code: 'KeyA' });
    expect(events.filter((e) => e.category === 'input').map((e) => [e.category, e.name])).toEqual([['input', 'keydown'], ['input', 'keyup']]);
    expect(events.find((e) => e.name === 'keydown')!.data).toMatchObject({ code: 'KeyA', ctrl: true, shift: false, alt: false, meta: false, target: 'input#a', defaultPrevented: false });
    expect(JSON.stringify(events)).not.toContain('"key"');
    expect(JSON.stringify(events)).not.toContain('"a"');
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('records beforeinput and input by type only, never their data', () => {
    input().focus();
    input().dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: 'a', inputType: 'insertText' }));
    input().dispatchEvent(new InputEvent('input', { bubbles: true, data: 'a', inputType: 'insertText' }));
    expect(events.filter((e) => e.category === 'input').map((e) => e.name)).toEqual(['beforeinput', 'input']);
    expect(events.find((e) => e.name === 'input')!.data).toMatchObject({ inputType: 'insertText', target: 'input#a' });
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
