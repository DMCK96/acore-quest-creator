// @ts-nocheck
import SceneWorkerController from '../../worker/SceneWorkerController.js';
import { MapSpec, MapAreaSpec } from './types.js';
import { AssetHost } from '../../asset.js';

const createWorker = () =>
  new Worker(new URL('./worker.ts', import.meta.url), {
    name: 'map-loader',
    type: 'module',
  });

type MapLoaderOptions = {
  host: AssetHost;
};

class MapLoader extends SceneWorkerController {
  constructor(options: MapLoaderOptions) {
    super(createWorker, { host: options.host });
  }

  loadMapSpec(mapPath: string): Promise<MapSpec> {
    return this.request('loadMapSpec', mapPath);
  }

  loadAreaSpec(mapPath: string, areaPath: string): Promise<MapAreaSpec> {
    return this.request('loadAreaSpec', mapPath, areaPath);
  }
}

export default MapLoader;
