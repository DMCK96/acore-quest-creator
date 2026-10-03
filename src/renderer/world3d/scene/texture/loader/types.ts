// @ts-nocheck
import { BLP_IMAGE_FORMAT } from '@wowserhq/format';

type TextureMipmapSpec = {
  width: number;
  height: number;
  data: Uint8Array;
};

type TextureSpec = {
  width: number;
  height: number;
  format: BLP_IMAGE_FORMAT;
  mipmaps: TextureMipmapSpec[];
};

export { TextureSpec };
