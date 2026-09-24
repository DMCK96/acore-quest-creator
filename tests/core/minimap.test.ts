import { describe, expect, it } from 'vitest';
import { gridOf } from '../../src/core/map/coords';
import { minimapPath, parseMd5Translate } from '../../src/core/map/minimap';

const TRS = 'dir: Azeroth\r\nAzeroth\\map32_48.blp\tAzeroth_32_48.blp\r\nAzeroth\\map31_48.blp\t0123456789abcdef0123456789abcdef.blp\r\ndir: Kalimdor\nKalimdor\\map1_2.blp\tfedcba.blp\n\n';

describe('minimap names', () => {
  it('reads the translate file, skipping dir lines', () => {
    const t = parseMd5Translate(TRS);
    expect(t.size).toBe(3);
    expect(t.get('azeroth\\map32_48.blp')).toBe('Azeroth_32_48.blp');
  });
  it('names the tile of a grid: column is gy, row is gx', () => {
    const t = parseMd5Translate(TRS);
    expect(minimapPath(t, 'Azeroth', 48, 32)).toBe('Textures\\Minimap\\Azeroth_32_48.blp');
    expect(minimapPath(t, 'AZEROTH', 48, 31)).toBe('Textures\\Minimap\\0123456789abcdef0123456789abcdef.blp');
    expect(minimapPath(t, 'Azeroth', 1, 1)).toBeNull();
  });
  it('finds the tile under Northshire', () => {
    const { gx, gy } = gridOf(-8902.59, -162.606);
    expect(minimapPath(parseMd5Translate(TRS), 'Azeroth', gx, gy)).toBe('Textures\\Minimap\\Azeroth_32_48.blp');
  });
});
