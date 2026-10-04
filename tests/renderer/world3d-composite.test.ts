import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/client/blp';
import { ITEM_REGIONS, REGIONS, composite, itemTextureFiles } from '../../src/renderer/world3d/scene/character/composite';

const solid = (width: number, height: number, rgba: number[]): RgbaImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, rgba: data };
};
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('building a body texture', () => {
  it('paints a layer into its region, scaled to fit, and leaves the rest as it was', () => {
    const out = composite(solid(256, 256, [200, 0, 0, 255]), [{ image: solid(2, 2, [0, 0, 255, 255]), region: 'hand' }]);
    expect(px(out, 10, 140)).toEqual([0, 0, 255, 255]);
    expect(px(out, 127, 159)).toEqual([0, 0, 255, 255]);
    expect(px(out, 10, 170)).toEqual([200, 0, 0, 255]);
    expect(px(out, 200, 140)).toEqual([200, 0, 0, 255]);
  });

  it('blends a layer by its alpha, and a whole-texture layer covers everything', () => {
    const half = composite(solid(256, 256, [200, 0, 0, 255]), [{ image: solid(1, 1, [0, 0, 200, 128]), region: 'foot' }]);
    const [r, g, b, a] = px(half, 130, 230);
    expect(r).toBeGreaterThan(90);
    expect(r).toBeLessThan(110);
    expect(b).toBeGreaterThan(90);
    expect([g, a]).toEqual([0, 255]);
    const whole = composite(solid(256, 256, [1, 1, 1, 255]), [{ image: solid(4, 4, [9, 9, 9, 255]), region: null }]);
    expect(px(whole, 255, 255)).toEqual([9, 9, 9, 255]);
  });

  it('scales regions to a larger base', () => {
    const out = composite(solid(512, 512, [200, 0, 0, 255]), [{ image: solid(2, 2, [0, 0, 255, 255]), region: 'hand' }]);
    expect(px(out, 250, 318)).toEqual([0, 0, 255, 255]);
    expect(px(out, 10, 330)).toEqual([200, 0, 0, 255]);
  });

  it('leaves the base untouched', () => {
    const base = solid(256, 256, [200, 0, 0, 255]);
    composite(base, [{ image: solid(1, 1, [0, 0, 255, 255]), region: null }]);
    expect(px(base, 0, 0)).toEqual([200, 0, 0, 255]);
  });
});

describe('where an item\'s region textures are', () => {
  it('names the sex\'s file, then the unisex one', () => {
    expect(itemTextureFiles('Robe_A_01Purple_Chest_TU', 'torsoUpper', 0)).toEqual([
      'Item\\TextureComponents\\TorsoUpperTexture\\Robe_A_01Purple_Chest_TU_M.blp',
      'Item\\TextureComponents\\TorsoUpperTexture\\Robe_A_01Purple_Chest_TU_U.blp',
    ]);
    expect(itemTextureFiles('Boot_A', 'foot', 1)[0]).toBe('Item\\TextureComponents\\FootTexture\\Boot_A_F.blp');
  });

  it('knows the regions in the order ItemDisplayInfo gives them', () => {
    expect(ITEM_REGIONS).toEqual(['armUpper', 'armLower', 'hand', 'torsoUpper', 'torsoLower', 'legUpper', 'legLower', 'foot']);
    expect(REGIONS.legLower).toEqual({ x: 128, y: 160, w: 128, h: 64 });
  });
});
