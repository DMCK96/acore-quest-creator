// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD_MAPS, setClientMaps, type WorldMap } from '../../src/core/map/world-maps';
import { LAST_PLACE_KEY, readLastPlace, writeLastPlace } from '../../src/renderer/world3d/last-place';
import { WELCOME_SEEN_KEY, markWelcomeSeen, projectKey, welcomeSeen } from '../../src/renderer/world3d/welcome-seen';

const fallback = { map: WORLD_MAPS[0]!.id, ...WORLD_MAPS[0]!.start };
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('where the world was left', () => {
  it('opens at the first continent\'s start the first time', () => {
    expect(readLastPlace()).toEqual(fallback);
  });
  it('remembers a place written', () => {
    writeLastPlace({ map: 1, x: 10, y: 20, z: 30 });
    expect(JSON.parse(localStorage.getItem(LAST_PLACE_KEY)!)).toEqual({ map: 1, x: 10, y: 20, z: 30 });
    expect(readLastPlace()).toEqual({ map: 1, x: 10, y: 20, z: 30 });
  });
  it.each([
    ['not JSON', '{oops'],
    ['a map the view does not draw', JSON.stringify({ map: 33, x: 1, y: 2, z: 3 })],
    ['numbers that are not numbers', JSON.stringify({ map: 0, x: 'a', y: 2, z: 3 })],
    ['nothing useful', JSON.stringify(null)],
  ])('falls back to the start when the stored place is %s', (_why, raw) => {
    localStorage.setItem(LAST_PLACE_KEY, raw);
    expect(readLastPlace()).toEqual(fallback);
  });
  describe('on a transport', () => {
    const zeppelin: WorldMap = { id: 591, name: 'Zeppelin', directory: 'kalimdor', kind: 'transport', start: { x: 0, y: 0, z: 0 }, transport: { templates: [], paths: {} } };
    beforeEach(() => setClientMaps([zeppelin]));
    afterEach(() => setClientMaps([]));
    it('remembers the route and stop with the place', () => {
      writeLastPlace({ map: 591, x: 1, y: 2, z: 3, transport: { template: 2, node: 4 } });
      expect(readLastPlace()).toEqual({ map: 591, x: 1, y: 2, z: 3, transport: { template: 2, node: 4 } });
    });
    it('reads a stored place without a broken route and stop', () => {
      localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ map: 591, x: 1, y: 2, z: 3, transport: { template: 'x' } }));
      expect(readLastPlace()).toEqual({ map: 591, x: 1, y: 2, z: 3 });
    });
    it('reads an old place with no route and stop as before', () => {
      localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ map: 1, x: 10, y: 20, z: 30 }));
      expect(readLastPlace()).toEqual({ map: 1, x: 10, y: 20, z: 30 });
    });
  });
  it('never throws when storage does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeLastPlace({ map: 0, x: 1, y: 2, z: 3 })).not.toThrow();
    expect(readLastPlace()).toEqual(fallback);
  });
});

describe('whether a project has had its welcome', () => {
  it('is keyed by the project file, or "untitled"', () => {
    expect(projectKey('C:\w\north.aqc')).toBe('C:\w\north.aqc');
    expect(projectKey(null)).toBe('untitled');
    expect(projectKey('')).toBe('untitled');
  });
  it('is not seen until marked, and stays seen', () => {
    expect(welcomeSeen('a')).toBe(false);
    markWelcomeSeen('a');
    markWelcomeSeen('a');
    expect(welcomeSeen('a')).toBe(true);
    expect(welcomeSeen('b')).toBe(false);
    expect(JSON.parse(localStorage.getItem(WELCOME_SEEN_KEY)!)).toEqual(['a']);
  });
  it('treats an unreadable list as nothing seen', () => {
    localStorage.setItem(WELCOME_SEEN_KEY, '{oops');
    expect(welcomeSeen('a')).toBe(false);
  });
  it('still remembers for this run when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(welcomeSeen('run-only')).toBe(false);
    markWelcomeSeen('run-only');
    expect(welcomeSeen('run-only')).toBe(true);
  });
});
