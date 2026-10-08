import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/main/store/store';
import { createMcpSettings } from '../../src/main/mcp/settings';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

describe('MCP settings', () => {
  it('starts off, on port 47600, with a token that stays the same between reads', () => {
    const settings = createMcpSettings(openStore(':memory:', box));
    const a = settings.read();
    expect(a.enabled).toBe(false);
    expect(a.port).toBe(47600);
    const token = settings.token();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(settings.token()).toBe(token);
  });

  it('remembers enabled, port and token in the store', () => {
    const store = openStore(':memory:', box);
    const first = createMcpSettings(store);
    first.setEnabled(true);
    first.setPort(50000);
    const token = first.token();
    const again = createMcpSettings(store);
    expect(again.read()).toEqual({ enabled: true, port: 50000 });
    expect(again.token()).toBe(token);
  });

  it('regenerates a different token', () => {
    const settings = createMcpSettings(openStore(':memory:', box));
    const old = settings.token();
    const fresh = settings.regenerateToken();
    expect(fresh).not.toBe(old);
    expect(settings.token()).toBe(fresh);
  });

  it('does not make a token, or need the keyring, until one is asked for', () => {
    const noKeyring = { encrypt: () => { throw new Error('no secure storage'); }, decrypt: () => { throw new Error('no secure storage'); } };
    const settings = createMcpSettings(openStore(':memory:', noKeyring));
    expect(settings.read()).toEqual({ enabled: false, port: 47600 });
    expect(() => settings.token()).toThrow(/no secure storage/);
  });

  it('refuses a port that is not a whole number from 1024 to 65535', () => {
    const settings = createMcpSettings(openStore(':memory:', box));
    for (const bad of [80, 1023, 65536, 3000.5, Number.NaN]) expect(() => settings.setPort(bad)).toThrow(RangeError);
  });
});
