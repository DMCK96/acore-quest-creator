// @vitest-environment jsdom
import { ClientDb } from '@wowserhq/format';
import { describe, expect, it, vi } from 'vitest';
import { buildDbcWithStrings } from '../helpers/dbc';
import { ItemDisplayInfoRecord, ItemRecord } from '../../src/renderer/world3d/scene/db/records';
import { DisplayResolver } from '../../src/renderer/world3d/scene/spawn/DisplayResolver';

const db = (Record: any, records: (number | string)[][], fields: number): ClientDb<any> => {
  const bytes = buildDbcWithStrings(records, fields);
  return new ClientDb(Record).load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};
const tables: Record<string, () => ClientDb<any>> = {
  // item 1899: class 2 (weapon), display 5000
  // item 143: a shield (class 4, inventory type 14), display 5001
  Item: () => db(ItemRecord, [[1899, 2, 7, 0, 1, 5000, 21, 3], [143, 4, 6, 0, 1, 5001, 14, 4]], 8),
  ItemDisplayInfo: () => db(ItemDisplayInfoRecord, [[5000, 'Sword_1H_Short_A_01.mdx', '', 'Sword_1H_Short_A_01Blue', ''], [5001, 'Shield_Crest_B_01.mdx', '', 'Shield_Crest_B_01Gold', '']], 25),
};
const resolver = () => new DisplayResolver({ get: async (name) => (tables[name] ? tables[name]() : null) });

describe('a held weapon', () => {
  it('is its display\'s model and texture, from the weapon folder', async () => {
    expect(await resolver().weapon(1899)).toEqual({
      kind: 'model',
      path: 'Item\\ObjectComponents\\Weapon\\Sword_1H_Short_A_01.m2',
      textures: { 2: 'Item\\ObjectComponents\\Weapon\\Sword_1H_Short_A_01Blue.blp' },
      geosets: null,
      scale: 1,
    });
  });

  it('is held on the arm (the shield point), not in the hand, when it is a shield', async () => {
    const r = resolver();
    expect((await r.weapon(143))!.shield).toBe(true);
    // ... and its model and texture are in the shield folder, not the weapon one
    expect((await r.weapon(143))!.path).toBe('Item\\ObjectComponents\\Shield\\Shield_Crest_B_01.m2');
    expect((await r.weapon(143))!.textures).toEqual({ 2: 'Item\\ObjectComponents\\Shield\\Shield_Crest_B_01Gold.blp' });
    expect((await r.weapon(1899))!.shield).toBeFalsy();
  });

  it('is nothing for no item, or an item the client does not know (a custom one), logged once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = resolver();
    expect(await r.weapon(0)).toBeNull();
    expect(await r.weapon(900001)).toBeNull();
    expect(await r.weapon(900001)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^3D view: item 900001/);
    warn.mockRestore();
  });
});
