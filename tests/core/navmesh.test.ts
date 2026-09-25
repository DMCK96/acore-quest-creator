import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { floorsAt, navTileFileName, NavmeshFormatError, parseNavTile } from '../../src/core/game/navmesh';
import { buildNavTile } from '../helpers/nav-tile';
import { serverDataDir } from '../helpers/env';

const square = (z: number, x0 = -100, x1 = 0, y0 = -100, y1 = 0): [number, number, number][] =>
  [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];

describe('navmesh', () => {
  it('names tiles like the server', () => {
    expect(navTileFileName(0, -8902.59, -162.606)).toBe('0004832.mmtile');
  });
  it('finds the floor under a point', () => {
    const tile = parseNavTile(buildNavTile([{ verts: square(40) }]));
    expect(floorsAt(tile, -50, -50)).toEqual([40]);
    expect(floorsAt(tile, 50, 50)).toEqual([]);
  });
  it('lists stacked floors lowest first and interpolates slopes', () => {
    const slope: [number, number, number][] = [[-100, -100, 0], [0, -100, 10], [0, 0, 10], [-100, 0, 0]];
    const tile = parseNavTile(buildNavTile([{ verts: square(80) }, { verts: slope }, { verts: square(80.3) }]));
    expect(floorsAt(tile, -50, -50)).toEqual([5, 80]);
  });
  it('ignores off-mesh connections', () => {
    const tile = parseNavTile(buildNavTile([{ verts: square(40), offMesh: true }]));
    expect(floorsAt(tile, -50, -50)).toEqual([]);
  });
  it('rejects files that are not v20 tiles', () => {
    const bad = buildNavTile([{ verts: square(1) }]);
    new DataView(bad.buffer).setUint32(8, 19, true);
    expect(() => parseNavTile(bad)).toThrow(NavmeshFormatError);
    expect(() => parseNavTile(new Uint8Array(10))).toThrow(NavmeshFormatError);
  });
  // The server's own navmesh when .env names its data folder; skipped where there is none (CI).
  const real = process.env.ACQC_WORLD_DB_DBC_DIR ? join(serverDataDir(), 'mmaps', '0004832.mmtile') : '';
  it.skipIf(!real || !existsSync(real))('finds the ground under Marshal McBride in the fork\'s navmesh', () => {
    const floors = floorsAt(parseNavTile(new Uint8Array(readFileSync(real))), -8902.59, -162.606);
    expect(floors.some((z) => Math.abs(z - 82.02) < 0.5)).toBe(true);
  });
  it('never reports a floor it cannot compute', () => {
    const tile = parseNavTile(buildNavTile([{ verts: square(Number.NaN) }, { verts: square(40) }]));
    expect(floorsAt(tile, -50, -50)).toEqual([40]);
  });
});
