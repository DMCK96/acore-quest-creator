// @ts-nocheck
import { BLP_IMAGE_FORMAT, Blp } from '@wowserhq/format';
import { TextureSpec } from './types.js';
import SceneWorker from '../../worker/SceneWorker.js';
import { AssetHost, loadAsset } from '../../asset.js';

type TextureLoaderWorkerOptions = {
  host: AssetHost;
};

/**
 * A texture file lists where each of its mip levels is and how big. The reader trusts all sixteen
 * slots, but some files leave garbage in the ones they do not use (a size of four billion), which
 * stops the whole file from loading. Slots past the levels the picture's size allows, or that run
 * past the end of the file, are cleared; the game itself only reads the levels that can exist.
 */
const clearImpossibleMipSlots = (data: ArrayBuffer) => {
  if (data.byteLength < 148) {
    return;
  }

  const view = new DataView(data);
  if (view.getUint32(0, false) !== 0x424c5032) {
    // Not "BLP2"
    return;
  }

  const hasMips = view.getUint8(11) !== 0;
  const largest = Math.max(view.getUint32(12, true), view.getUint32(16, true), 1);
  const levels = hasMips ? Math.floor(Math.log2(largest)) + 1 : 1;

  for (let level = 0; level < 16; level++) {
    const offsetAt = 20 + level * 4;
    const sizeAt = 84 + level * 4;
    const offset = view.getUint32(offsetAt, true);
    const size = view.getUint32(sizeAt, true);

    if (level >= levels || offset === 0 || size === 0 || offset + size > data.byteLength) {
      view.setUint32(offsetAt, 0, true);
      view.setUint32(sizeAt, 0, true);
    }
  }
};

class TextureLoaderWorker extends SceneWorker {
  #host: AssetHost;

  initialize(options: TextureLoaderWorkerOptions) {
    this.#host = options.host;
  }

  async loadSpec(path: string) {
    const blpData = await loadAsset(this.#host, path);

    let blp: Blp;
    let images;
    try {
      clearImpossibleMipSlots(blpData);
      blp = new Blp().load(blpData);
      images = blp.getImages();
    } catch (error) {
      // Say what the file is, so a bad one can be told from a format that is not read
      const start = Array.from(new Uint8Array(blpData, 0, Math.min(16, blpData.byteLength)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      throw new Error(
        `${path}: ${error.message} (the file is ${blpData.byteLength} bytes and begins ${start})`,
      );
    }

    // Uncompressed textures are stored blue-green-red-alpha; the GPU wants red-green-blue-alpha
    let format = images[0].format;
    if (format === BLP_IMAGE_FORMAT.IMAGE_ARGB8888) {
      for (const image of images) {
        const data = image.data;
        for (let i = 0; i + 3 < data.length; i += 4) {
          const blue = data[i];
          data[i] = data[i + 2];
          data[i + 2] = blue;
        }
      }
      format = BLP_IMAGE_FORMAT.IMAGE_ABGR8888;
    }

    const mipmaps = new Array(images.length);
    const buffers = new Set<ArrayBuffer>();

    for (let i = 0; i < images.length; i++) {
      const image = images[i];

      mipmaps[i] = {
        width: image.width,
        height: image.height,
        data: image.data,
      };

      buffers.add(image.data.buffer);
    }

    const spec: TextureSpec = {
      width: blp.width,
      height: blp.height,
      format,
      mipmaps,
    };

    const transfer = [...buffers];

    return [spec, transfer];
  }
}

export default TextureLoaderWorker;
