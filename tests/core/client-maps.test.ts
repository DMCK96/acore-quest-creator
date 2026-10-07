import { describe, expect, it } from 'vitest';
import { buildClientMaps, parseWdtLayout, tileCentre } from '../../src/core/map/client-maps';
import { buildDbcWithStrings } from '../helpers/dbc';
import { groupWorldMaps, setClientMaps, worldMapById, worldMapDirectory, worldMaps, WORLD_MAPS } from '../../src/core/map/world-maps';

/** A WDT: MVER, MPHD with `flags`, and a MAIN whose entries flag the tiles given as [file's first number, second number] */
function wdt(flags: number, tiles: [number, number][]): Uint8Array {
  const chunk = (tag: string, body: Uint8Array): number[] => {
    const head = new Uint8Array(8);
    [...tag].reverse().forEach((c, i) => (head[i] = c.charCodeAt(0)));
    new DataView(head.buffer).setUint32(4, body.length, true);
    return [...head, ...body];
  };
  const mphd = new Uint8Array(32);
  new DataView(mphd.buffer).setUint32(0, flags, true);
  const main = new Uint8Array(64 * 64 * 8);
  for (const [a, b] of tiles) new DataView(main.buffer).setUint32((b * 64 + a) * 8, 1, true);
  return Uint8Array.from([...chunk('MVER', new Uint8Array(4)), ...chunk('MPHD', mphd), ...chunk('MAIN', main)]);
}

const row = (cells: Record<number, number | string>) => Array.from({ length: 66 }, (_, i) => cells[i] ?? 0);

describe('reading a WDT', () => {
  it('lists the occupied tiles and tells a one-building map apart', () => {
    expect(parseWdtLayout(wdt(0xe, [[25, 21], [26, 23]]))).toEqual({ globalWmo: false, tiles: [{ a: 25, b: 21 }, { a: 26, b: 23 }] });
    expect(parseWdtLayout(wdt(0x1, [])).globalWmo).toBe(true);
  });

  it('puts a tile at its middle: the first number runs along Y, the second along X', () => {
    // Icecrown Citadel's NPC at (4357, 2769) is in tile _26_23
    const { x, y } = tileCentre({ a: 26, b: 23 });
    expect(Math.abs(x - 4357.05)).toBeLessThan(267);
    expect(Math.abs(y - 2769.42)).toBeLessThan(267);
  });
});

describe('the maps the client can draw', () => {
  const dbc = buildDbcWithStrings([
    row({ 0: 0, 1: 'Azeroth', 2: 0, 5: 'Eastern Kingdoms' }),
    row({ 0: 631, 1: 'IcecrownCitadel', 2: 2, 5: 'Icecrown Citadel' }),
    row({ 0: 34, 1: 'StormwindJail', 2: 1, 5: 'Stormwind Stockade' }),
    row({ 0: 999, 1: 'NoFiles', 2: 1, 5: 'Gone' }),
    row({ 0: 533, 1: 'Stratholme Raid', 2: 2, 5: 'Naxxramas' }),
  ], 66);
  const files: Record<string, Uint8Array> = {
    'world/maps/IcecrownCitadel/IcecrownCitadel.wdt': wdt(0xe, [[25, 21], [26, 23], [27, 22]]),
    'world/maps/StormwindJail/StormwindJail.wdt': wdt(0x1, []),
    'world/maps/Stratholme Raid/Stratholme Raid.wdt': wdt(0, [[30, 30]]),
    'world/maps/Azeroth/Azeroth.wdt': wdt(0, [[30, 30]]),
  };
  const read = async (path: string) => files[path] ?? null;

  it('lists maps with terrain tiles, by name, and leaves out the continents, one-building maps and maps without files', async () => {
    const maps = await buildClientMaps(dbc, read);
    expect(maps.map((m) => [m.id, m.name, m.directory, m.kind])).toEqual([
      [631, 'Icecrown Citadel', 'IcecrownCitadel', 'raid'],
      [533, 'Naxxramas', 'Stratholme Raid', 'raid'],
    ].sort((x, y) => String(x[1]).localeCompare(String(y[1]))));
  });

  it('starts a map at the tile nearest the middle of its tiles', async () => {
    const [icc] = (await buildClientMaps(dbc, read)).filter((m) => m.id === 631);
    const centre = tileCentre({ a: 26, b: 22 });
    // (25,21), (26,23) and (27,22) average to about (26,22): the tile (27,22) or (26,23) is closest; either is within a tile of it
    expect(Math.hypot(icc!.start.x - centre.x, icc!.start.y - centre.y)).toBeLessThan(800);
    expect(icc!.start.z).toBe(0);
  });
});

describe('the registry of maps', () => {
  it('draws the continents, and the client’s maps once they are set', () => {
    expect(worldMapById(631)).toBeNull();
    setClientMaps([{ id: 631, name: 'Icecrown Citadel', directory: 'IcecrownCitadel', kind: 'raid', start: { x: 1, y: 2, z: 3 } }]);
    expect(worldMapDirectory(631)).toBe('IcecrownCitadel');
    expect(worldMaps()).toHaveLength(WORLD_MAPS.length + 1);
    expect(groupWorldMaps(worldMaps()).map((g) => g.label)).toEqual(['Continents', 'Raids']);
    setClientMaps([]);
    expect(worldMapById(631)).toBeNull();
  });
});
