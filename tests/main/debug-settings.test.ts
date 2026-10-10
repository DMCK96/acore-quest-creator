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
