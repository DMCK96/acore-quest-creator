import SceneWorkerController from '../../worker/SceneWorkerController.js';
import { WmoSpec } from './types.js';
import { AssetHost } from '../../asset.js';

const createWorker = () =>
  new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'wmo-loader',
    type: 'module',
  });

type WmoLoaderOptions = {
  host: AssetHost;
};

class WmoLoader extends SceneWorkerController {
  constructor(options: WmoLoaderOptions) {
    super(createWorker, { host: options.host });
  }

  loadSpec(path: string): Promise<WmoSpec> {
    return this.request('loadSpec', path);
  }
}

export default WmoLoader;
