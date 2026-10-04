// @ts-nocheck
import SceneWorkerController from '../../worker/SceneWorkerController.js';
import { TextureSpec } from './types.js';
import { AssetHost } from '../../asset.js';

const createWorker = () =>
  new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'texture-loader',
    type: 'module',
  });

type TextureLoaderOptions = {
  host: AssetHost;
};

class TextureLoader extends SceneWorkerController {
  constructor(options: TextureLoaderOptions) {
    super(createWorker, { host: options.host });
  }

  loadSpec(path: string): Promise<TextureSpec> {
    return this.request('loadSpec', path);
  }
}

export default TextureLoader;
