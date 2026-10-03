// @ts-nocheck
import { BLP_IMAGE_FORMAT, Blp } from '@wowserhq/format';
import { TextureSpec } from './types.js';
import SceneWorker from '../../worker/SceneWorker.js';
import { AssetHost, loadAsset } from '../../asset.js';

type TextureLoaderWorkerOptions = {
  host: AssetHost;
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
