import { describe, expect, it } from 'vitest';
import { parseMapDirectories, parseMapNames, parseZoneLabels } from '../../src/core/game/maps-dbc';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';

const row = (n: number, cells: Record<number, number | string>) => Array.from({ length: n }, (_, i) => cells[i] ?? 0);

describe('map DBCs', () => {
  it('names maps and tells instances apart', () => {
    const dbc = buildDbcWithStrings([row(66, { 0: 0, 2: 0, 5: 'Eastern Kingdoms' }), row(66, { 0: 36, 2: 1, 5: 'Deadmines' })], 66);
    expect(parseMapNames(dbc)).toEqual(new Map([[0, { name: 'Eastern Kingdoms', instance: false }], [36, { name: 'Deadmines', instance: true }]]));
  });
  it('places zone names in the middle of their world map area', () => {
    const wma = buildDbcWithStrings([row(11, { 0: 1, 1: 0, 2: 12, 4: f32(-100), 5: f32(-300), 6: f32(-8000), 7: f32(-9000) }), row(11, { 0: 2, 1: 0, 2: 0 })], 11);
    const areas = buildDbcWithStrings([row(36, { 0: 12, 11: 'Elwynn Forest' })], 36);
    expect(parseZoneLabels(wma, areas)).toEqual([{ map: 0, name: 'Elwynn Forest', x: -8500, y: -200 }]);
  });
  it('reads each map folder name', () => {
    const bytes = buildDbcWithStrings([[0, 'Azeroth', 0, 0, 0, 'Eastern Kingdoms'], [1, 'Kalimdor', 0, 0, 0, 'Kalimdor']], 6);
    expect(parseMapDirectories(bytes)).toEqual(new Map([[0, 'Azeroth'], [1, 'Kalimdor']]));
  });
});
