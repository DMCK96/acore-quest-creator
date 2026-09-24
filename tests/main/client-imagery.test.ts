import { describe, expect, it } from 'vitest';
import { createClientImagery, nodeClientFs } from '../../src/main/client-imagery';
import { buildMpq, storedFile, text } from '../helpers/mpq-file';
import { memClient } from '../helpers/client-fs';
import { solidBlp } from '../helpers/blp-file';
import { buildDbcWithStrings, f32 } from '../helpers/dbc';

const NONE = 0xffffffff;
const at = (rgba: Uint8Array, x: number, y: number): number[] => Array.from(rgba.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));
const art = (name: string, rgba: [number, number, number, number]) =>
  Array.from({ length: 12 }, (_, i) => storedFile(`Interface\\WorldMap\\${name}\\${name}${i + 1}.blp`, solidBlp(256, 256, rgba)));

function client(minimapSize = 256) {
  return memClient({
    '/wow/Data/common.MPQ': buildMpq([
      storedFile('DBFilesClient\\Map.dbc', buildDbcWithStrings([[0, 'Azeroth', 0, 0, 0, 'Eastern Kingdoms'], [1, 'Kalimdor', 0, 0, 0, 'Kalimdor']], 6)),
      storedFile('DBFilesClient\\WorldMapArea.dbc', buildDbcWithStrings([
        [14, 0, 0, 'Azeroth', f32(18171), f32(-22569), f32(11176), f32(-15973), NONE, 0, 0],
        [30, 0, 12, 'Elwynn', f32(1535), f32(-1935), f32(-7939), f32(-10254), NONE, 0, 0],
      ], 11)),
      storedFile('DBFilesClient\\WorldMapOverlay.dbc', buildDbcWithStrings([[122, 30, 87, 0, 0, 0, 0, 0, 'SPOT', 256, 256, 400, 150, 0, 0, 0, 0]], 17)),
      storedFile('Interface\\WorldMap\\Elwynn\\SPOT1.blp', solidBlp(256, 256, [250, 250, 0, 255])),
      storedFile('DBFilesClient\\AreaTable.dbc', buildDbcWithStrings([[9, 0, 12], [12, 0, 0]], 3)),
      storedFile('Textures\\Minimap\\md5translate.trs', text('dir: Azeroth\r\nAzeroth\\map32_48.blp\tAzeroth_32_48.blp\r\n')),
      storedFile('Textures\\Minimap\\Azeroth_32_48.blp', solidBlp(minimapSize, minimapSize, [200, 10, 10, 255])),
      ...art('Elwynn', [10, 200, 10, 255]),
      ...art('Azeroth', [10, 10, 200, 255]),
    ]),
  });
}

describe('client imagery', () => {
  it('reports its archives, its fingerprint and what it could not read when it opened', async () => {
    const whole = (await createClientImagery('/wow', client()))!;
    expect(whole.archives).toEqual(['common.MPQ']);
    expect(whole.fingerprint).not.toBe('');
    expect(whole.problems).toEqual([]);
    const bare = (await createClientImagery('/wow', memClient({ '/wow/Data/common.MPQ': buildMpq([storedFile('x', text('x'))]) })))!;
    expect(bare.problems.some((p) => p.includes('WorldMapArea.dbc'))).toBe(true);
  });
  it('gives the minimap tile of a grid', async () => {
    const imagery = (await createClientImagery('/wow', client()))!;
    const tile = (await imagery.minimap(0, 48, 32))!;
    expect(tile).toHaveLength(256 * 256 * 4);
    expect(at(tile, 0, 0)).toEqual([200, 10, 10, 255]);
    expect(await imagery.minimap(0, 0, 0)).toBeNull();
    expect(await imagery.minimap(1, 48, 32)).toBeNull();
    expect(await imagery.minimap(530, 48, 32)).toBeNull();
  });
  it('scales a minimap tile of another size to 256 px', async () => {
    const tile = (await (await createClientImagery('/wow', client(128)))!.minimap(0, 48, 32))!;
    expect(tile).toHaveLength(256 * 256 * 4);
    expect(at(tile, 255, 255)).toEqual([200, 10, 10, 255]);
  });
  it('paints a zoom-5 tile from the zone the ground belongs to, and the sea from the zone box around it, never the continent', async () => {
    const imagery = (await createClientImagery('/wow', client()))!;
    // Zoom-5 tile (16, 24) covers grids gx 48-49, gy 32-33: inside Elwynn's box.
    // Pixel (250, 250) is clear of the fixture's overlay.
    expect(at((await imagery.art(0, 16, 24, () => 9))!, 250, 250)).toEqual([10, 200, 10, 255]);
    // Area 0 (the sea): the continent's art is a whole continent in 1002 px, far too coarse this close.
    expect(at((await imagery.art(0, 16, 24, () => 0))!, 250, 250)).toEqual([10, 200, 10, 255]);
    expect(at((await imagery.art(0, 16, 24, () => null))!, 250, 250)).toEqual([10, 200, 10, 255]);
    expect(await imagery.art(1, 16, 24, () => 9)).toBeNull();
  });
  it('paints the explored-area overlays onto the zone art', async () => {
    const imagery = (await createClientImagery('/wow', client()))!;
    // Pixel (10, 10) of zoom-5 tile (16, 24) sits at about (456, 184) of Elwynn's art: inside the overlay at (400, 150).
    expect(at((await imagery.art(0, 16, 24, () => 9))!, 10, 10)).toEqual([250, 250, 0, 255]);
    expect(at((await imagery.art(0, 16, 24, () => 9))!, 250, 250)).toEqual([10, 200, 10, 255]);
  });
  it('is null for a folder that is not a client', async () => {
    expect(await createClientImagery('/nothing', memClient({}))).toBeNull();
  });
});

describe.skipIf(!process.env.ACQC_TEST_CLIENT_DIR)('the real client', () => {
  it('draws the minimap and the painted art around Northshire', async () => {
    const imagery = (await createClientImagery(process.env.ACQC_TEST_CLIENT_DIR!, nodeClientFs, (m) => console.warn(m)))!;
    try {
      const minimap = (await imagery.minimap(0, 48, 32))!;
      expect(minimap).toHaveLength(256 * 256 * 4);
      expect(minimap.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
      const painted = (await imagery.art(0, 16, 24, () => 9))!;
      expect(painted.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    } finally {
      await imagery.close();
    }
  }, 60_000);
});
