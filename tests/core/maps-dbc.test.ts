import { describe, expect, it } from 'vitest';
import { parseMapNames } from '../../src/core/game/maps-dbc';
import { buildDbcWithStrings } from '../helpers/dbc';

const row = (n: number, cells: Record<number, number | string>) => Array.from({ length: n }, (_, i) => cells[i] ?? 0);

describe('map DBCs', () => {
  it('names maps and tells instances apart', () => {
    const dbc = buildDbcWithStrings([row(66, { 0: 0, 2: 0, 5: 'Eastern Kingdoms' }), row(66, { 0: 36, 2: 1, 5: 'Deadmines' })], 66);
    expect(parseMapNames(dbc)).toEqual(new Map([[0, { name: 'Eastern Kingdoms', instance: false }], [36, { name: 'Deadmines', instance: true }]]));
  });
});
