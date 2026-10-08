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
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(settings.read().token).toBe(a.token);
  });

  it('remembers enabled, port and token in the store', () => {
    const store = openStore(':memory:', box);
    const first = createMcpSettings(store);
    first.setEnabled(true);
    first.setPort(50000);
    const token = first.read().token;
    expect(createMcpSettings(store).read()).toEqual({ enabled: true, port: 50000, token });
  });

  it('regenerates a different token', () => {
    const settings = createMcpSettings(openStore(':memory:', box));
    const old = settings.read().token;
    const fresh = settings.regenerateToken();
    expect(fresh).not.toBe(old);
    expect(settings.read().token).toBe(fresh);
  });

  it('refuses a port that is not a whole number from 1024 to 65535', () => {
    const settings = createMcpSettings(openStore(':memory:', box));
    for (const bad of [80, 1023, 65536, 3000.5, Number.NaN]) expect(() => settings.setPort(bad)).toThrow(RangeError);
  });
});
