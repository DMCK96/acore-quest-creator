import { describe, expect, it } from 'vitest';
import { liquidLevel, parseMapFile } from '../../src/core/game/terrain';
import { buildMapFile } from '../helpers/map-file';

// Grid 32/32 spans X and Y from 0 down to -533.33; cell row r covers X from -r*G/128, col c covers Y likewise.
const G = 533.3333;
const at = (row: number, col: number) => ({ x: -(row + 0.5) * G / 128, y: -(col + 0.5) * G / 128 });

describe('liquid', () => {
  it('reads no water from a grid without a liquid section', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10 }));
    expect(file.liquid).toBeNull();
    expect(liquidLevel(file, at(3, 3).x, at(3, 3).y)).toBeNull();
  });
  it('reads one level over the whole grid', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10, liquid: { flags: 1, level: 12.5 } }));
    expect(liquidLevel(file, at(3, 3).x, at(3, 3).y)).toBeCloseTo(12.5, 4);
  });
  it('keeps water to the 8x8-cell blocks that have it', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10, liquid: { flags: 1, level: 12.5, blockFlags: (r, c) => (r === 0 && c === 0 ? 1 : 0) } }));
    expect(liquidLevel(file, at(3, 3).x, at(3, 3).y)).toBeCloseTo(12.5, 4);
    expect(liquidLevel(file, at(20, 20).x, at(20, 20).y)).toBeNull();
  });
  it('reads per-point levels inside the liquid window only', () => {
    const file = parseMapFile(buildMapFile({ kind: 'flat', gridHeight: 10, liquid: { flags: 1, level: 0, levels: { offX: 0, offY: 0, width: 9, height: 9, at: (i, j) => i + j } } }));
    expect(liquidLevel(file, at(2, 3).x, at(2, 3).y)).toBeCloseTo(5, 4);
    expect(liquidLevel(file, at(60, 60).x, at(60, 60).y)).toBeNull();
  });
});
