// @ts-nocheck
import { Blp } from '@wowserhq/format';
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
    const blp = new Blp().load(blpData);

    const images = blp.getImages();
    const format = images[0].format;

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
