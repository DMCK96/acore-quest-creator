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
