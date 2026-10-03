import { scaleRgba, type RgbaImage } from '../../../../core/client/blp';

/**
 * A character's body texture as the game builds it (3.3.5): one 256 × 256 texture divided into
 * regions, its skin painted first and then each layer (face, underwear, each item's pieces) over it in
 * its region. A larger skin (some clients ship them) scales every region with it.
 */

export type Region = 'armUpper' | 'armLower' | 'hand' | 'faceUpper' | 'faceLower' | 'torsoUpper' | 'torsoLower' | 'legUpper' | 'legLower' | 'foot';

/** The size the regions are given at */
const BASE_SIZE = 256;

export const REGIONS: Record<Region, { x: number; y: number; w: number; h: number }> = {
  armUpper: { x: 0, y: 0, w: 128, h: 64 },
  armLower: { x: 0, y: 64, w: 128, h: 64 },
  hand: { x: 0, y: 128, w: 128, h: 32 },
  faceUpper: { x: 0, y: 160, w: 128, h: 32 },
  faceLower: { x: 0, y: 192, w: 128, h: 64 },
  torsoUpper: { x: 128, y: 0, w: 128, h: 64 },
  torsoLower: { x: 128, y: 64, w: 128, h: 32 },
  legUpper: { x: 128, y: 96, w: 128, h: 64 },
  legLower: { x: 128, y: 160, w: 128, h: 64 },
  foot: { x: 128, y: 224, w: 128, h: 32 },
};

/** The regions an item display's eight textures are for, in ItemDisplayInfo's order */
export const ITEM_REGIONS: Region[] = ['armUpper', 'armLower', 'hand', 'torsoUpper', 'torsoLower', 'legUpper', 'legLower', 'foot'];

/** Each region's folder under Item\TextureComponents */
const FOLDERS: Record<Region, string> = {
  armUpper: 'ArmUpperTexture',
  armLower: 'ArmLowerTexture',
  hand: 'HandTexture',
  faceUpper: 'FaceUpperTexture',
  faceLower: 'FaceLowerTexture',
  torsoUpper: 'TorsoUpperTexture',
  torsoLower: 'TorsoLowerTexture',
  legUpper: 'LegUpperTexture',
  legLower: 'LegLowerTexture',
  foot: 'FootTexture',
};

/** An item's texture for a region: the file for the body's sex (0 male, 1 female), then the unisex one */
export function itemTextureFiles(name: string, region: Region, sex: number): string[] {
  const folder = `Item\\TextureComponents\\${FOLDERS[region]}\\${name}`;
  return [`${folder}_${sex === 1 ? 'F' : 'M'}.blp`, `${folder}_U.blp`];
}

/** The base with each layer drawn over it by its alpha, in its region (or over all of it); the base is left as it was */
export function composite(base: RgbaImage, layers: { image: RgbaImage; region: Region | null }[]): RgbaImage {
  const out = new Uint8Array(base.rgba);
  const scale = base.width / BASE_SIZE;
  for (const { image, region } of layers) {
    const at = region ? REGIONS[region] : null;
    const x0 = at ? Math.round(at.x * scale) : 0;
    const y0 = at ? Math.round(at.y * scale) : 0;
    const w = at ? Math.round(at.w * scale) : base.width;
    const h = at ? Math.round(at.h * scale) : base.height;
    const src = image.width === w && image.height === h ? image.rgba : scaleRgba(image, w, h).rgba;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = ((y0 + y) * base.width + x0 + x) * 4;
        const a = src[s + 3]! / 255;
        for (let k = 0; k < 3; k++) out[d + k] = Math.round(src[s + k]! * a + out[d + k]! * (1 - a));
      }
    }
  }
  return { width: base.width, height: base.height, rgba: out };
}
