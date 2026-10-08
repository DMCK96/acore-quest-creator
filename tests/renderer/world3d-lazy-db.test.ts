import { ClientDb } from '@wowserhq/format';
import { describe, expect, it } from 'vitest';
import { CreatureDisplayInfoRecord } from '../../src/renderer/world3d/scene/db/records';
import { LazyClientDb } from '../../src/renderer/world3d/scene/db/LazyClientDb';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';

/** A CreatureDisplayInfo row: id, model, sound, extra, scale, alpha, three skins, a portrait, six more */
const row = (id: number, model: number, skin: string) => [id, model, 0, 7, f32(1.5), 255, skin, '', '', `p${id}`, 0, 0, 0, 0, 0, 0];
const ROWS = [row(2, 20, 'a'), row(5, 50, 'bb'), row(9, 90, ''), row(30, 300, 'dddd')];
const file = (rows = ROWS) => buildDbcWithStrings(rows, 16);

const plain = (record: unknown) => ({ ...(record as object) });

describe('a client table read row by row, as it is asked for', () => {
  it('answers each id with the record the whole-table reader makes, strings and floats included', () => {
    const lazy = new LazyClientDb(CreatureDisplayInfoRecord).load(file());
    const eager = new ClientDb(CreatureDisplayInfoRecord).load(file().buffer as ArrayBuffer);
    for (const id of [2, 5, 9, 30]) {
      expect(plain(lazy.getRecord(id)), `id ${id}`).toEqual(plain(eager.getRecord(id)));
    }
    expect(lazy.getRecord(5)).toMatchObject({ id: 5, modelId: 50, extendedDisplayInfoId: 7, creatureModelScale: 1.5, portraitTextureName: 'p5', textureVariations: ['bb', '', ''] });
  });

  it('has nothing for an id the table does not hold, below, between or above its ids', () => {
    const lazy = new LazyClientDb(CreatureDisplayInfoRecord).load(file());
    for (const id of [0, 1, 3, 6, 29, 31, 1e9, -4]) expect(lazy.getRecord(id) ?? null, `id ${id}`).toBeNull();
  });

  it('finds ids in a table that is not in order', () => {
    const lazy = new LazyClientDb(CreatureDisplayInfoRecord).load(file([row(30, 300, 'x'), row(2, 20, 'y'), row(9, 90, 'z')]));
    expect(lazy.getRecord(2)).toMatchObject({ id: 2, modelId: 20 });
    expect(lazy.getRecord(30)).toMatchObject({ id: 30, modelId: 300 });
    expect(lazy.getRecord(9)).toMatchObject({ id: 9, modelId: 90 });
    expect(lazy.getRecord(10) ?? null).toBeNull();
  });

  it('reads only the rows asked for, once each', () => {
    let reads = 0;
    class Counting extends CreatureDisplayInfoRecord {
      load(...args: Parameters<CreatureDisplayInfoRecord['load']>) {
        reads++;
        return super.load(...args);
      }
    }
    const lazy = new LazyClientDb(Counting).load(file());
    expect(reads).toBe(0);
    const a = lazy.getRecord(5);
    expect(reads).toBe(1);
    expect(lazy.getRecord(5)).toBe(a);
    expect(reads).toBe(1);
    lazy.getRecord(9);
    expect(reads).toBe(2);
  });

  it('lists every record, in the file’s order, when asked for them all', () => {
    const lazy = new LazyClientDb(CreatureDisplayInfoRecord).load(file());
    const eager = new ClientDb(CreatureDisplayInfoRecord).load(file().buffer as ArrayBuffer);
    expect(lazy.records.map(plain)).toEqual(eager.records.map(plain));
    expect(lazy.getRecordByIndex(1)).toBe(lazy.records[1]);
    expect(lazy.getRecordByIndex(-1)).toBeNull();
    expect(lazy.getRecordByIndex(4)).toBeNull();
    // A record asked for by id is the one the list holds
    expect(lazy.getRecord(30)).toBe(lazy.records[3]);
  });

  it('holds an empty table', () => {
    const lazy = new LazyClientDb(CreatureDisplayInfoRecord).load(file([]));
    expect(lazy.getRecord(1) ?? null).toBeNull();
    expect(lazy.records).toEqual([]);
  });

  it('refuses a file that is not a client table', () => {
    expect(() => new LazyClientDb(CreatureDisplayInfoRecord).load(new Uint8Array(40))).toThrow(/WDBC/);
  });
});
