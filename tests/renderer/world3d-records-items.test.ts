// @vitest-environment jsdom
import { ClientDb } from '@wowserhq/format';
import { describe, expect, it } from 'vitest';
import { buildDbcWithStrings } from '../helpers/dbc';
import { ChrRacesRecord, ItemDisplayInfoRecord } from '../../src/renderer/world3d/scene/db/records';

const db = (Record: any, records: (number | string)[][], fields: number): ClientDb<any> => {
  const bytes = buildDbcWithStrings(records, fields);
  return new ClientDb(Record).load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
};

describe('the item and race fields dressing an NPC needs', () => {
  it('reads an item display\'s geoset groups and its eight region textures', () => {
    const row = [7, 'Helm.mdx', '', 'HelmSkin', '', 'icon', '', 2, 3, 1, 0, 0, 0, 0, 0,
      'AU', 'AL', 'HA', 'TU', 'TL', 'LU', 'LL', 'FO', 0, 0];
    const record = db(ItemDisplayInfoRecord, [row], 25).getRecord(7);
    expect(record.modelNames).toEqual(['Helm.mdx', '']);
    expect(record.modelTextures).toEqual(['HelmSkin', '']);
    expect(record.geosetGroups).toEqual([2, 3, 1]);
    expect(record.regionTextures).toEqual(['AU', 'AL', 'HA', 'TU', 'TL', 'LU', 'LL', 'FO']);
  });

  it('reads a race\'s client prefix', () => {
    const record = db(ChrRacesRecord, [[1, 0, 1, 0, 49, 50, 'Hu']], 69).getRecord(1);
    expect([record.maleDisplayId, record.femaleDisplayId, record.clientPrefix]).toEqual([49, 50, 'Hu']);
  });
});
