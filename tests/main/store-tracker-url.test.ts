import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/main/store/store';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

describe('tracker URL on a profile', () => {
  it('defaults to empty and saves', () => {
    const store = openStore(':memory:', box);
    const saved = store.profiles.save({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    expect(saved.trackerUrl).toBe('');
    expect(store.profiles.save({ id: saved.id, name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', trackerUrl: 'http://127.0.0.1:9000' }).trackerUrl).toBe('http://127.0.0.1:9000');
  });
});
