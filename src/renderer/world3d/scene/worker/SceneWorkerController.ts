// @ts-nocheck
import { WorkerResponse } from './types.js';
import { RESPONSE_STATUS } from './const.js';

class SceneWorkerController {
  #initialized = false;
  #initializeArgs: any[];
  #initializing: Promise<void>;
  #initializingResolve: (value?: any) => void;
  #initializingReject: (reason?: any) => void;

  #worker: Worker;

  #nextId = 0;
  #pending = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>();

  constructor(createWorker: () => Worker, ...initializeArgs: any[]) {
    this.#worker = createWorker();
    this.#initializeArgs = initializeArgs;

    this.#worker.addEventListener('message', (event: MessageEvent) => {
      this.#handleResponse(event.data);
    });
  }

  async request(func: string, ...args: any[]): Promise<any> {
    if (!this.#initialized) {
      if (this.#initializing) {
        await this.#initializing;
      } else {
        await this.#initialize();
      }
    }

    return this.#request(func, args);
  }

  #request(func: string, args: any[]): Promise<any> {
    const id = this.#nextId++;

    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    this.#worker.postMessage({ id, func, args });

    return promise;
  }

  #initialize() {
    this.#initializing = new Promise((resolve, reject) => {
      this.#initializingResolve = resolve;
      this.#initializingReject = reject;
    });

    this.#request('initialize', this.#initializeArgs)
      .then((response) => {
        this.#initialized = true;
        this.#initializingResolve(response);
      })
      .catch((error) => {
        this.#initializingReject(error);
      });

    return this.#initializing;
  }

  #handleResponse(response: WorkerResponse) {
    const promise = this.#pending.get(response.id);

    if (response.status === RESPONSE_STATUS.STATUS_SUCCESS) {
      promise.resolve(response.value);
    } else {
      promise.reject(response.value);
    }

    this.#pending.delete(response.id);
  }
}

export default SceneWorkerController;
