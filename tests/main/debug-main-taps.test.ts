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
