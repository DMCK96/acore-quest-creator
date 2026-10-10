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
