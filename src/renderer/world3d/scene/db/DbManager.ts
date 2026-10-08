// @ts-nocheck
import { ClientDbRecord } from '@wowserhq/format';
import { LazyClientDb } from './LazyClientDb.js';
import { AssetHost, loadAsset, normalizePath } from '../asset.js';

interface Constructor<T> {
  new (...args: any[]): T;
}

type DbManagerOptions = {
  host: AssetHost;
};

class DbManager {
  #host: AssetHost;
  #loaded = new Map<string, LazyClientDb<any>>();
  #loading = new Map<string, Promise<LazyClientDb<any>>>();

  constructor(options: DbManagerOptions) {
    this.#host = options.host;
  }

  get<T extends ClientDbRecord>(name: string, RecordClass: Constructor<T>): Promise<LazyClientDb<T>> {
    const refId = [normalizePath(name), RecordClass.prototype.constructor.name].join(':');

    const loaded = this.#loaded.get(refId);
    if (loaded) {
      return Promise.resolve(loaded);
    }

    const alreadyLoading = this.#loading.get(refId);
    if (alreadyLoading) {
      return alreadyLoading;
    }

    const loading = this.#load(refId, name, RecordClass);
    this.#loading.set(refId, loading);

    return loading;
  }

  async #load<T extends ClientDbRecord>(
    refId: string,
    name: string,
    RecordClass: Constructor<T>,
  ): Promise<LazyClientDb<T>> {
    const path = `DBFilesClient/${name}`;

    let db: LazyClientDb<T>;
    try {
      const data = await loadAsset(this.#host, path);
      db = new LazyClientDb(RecordClass).load(data);

      this.#loaded.set(refId, db);
    } finally {
      this.#loading.delete(refId);
    }

    return db;
  }
}

export default DbManager;
export { DbManager };
