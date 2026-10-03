// @ts-nocheck
import { RESPONSE_STATUS } from './const.js';
import { WorkerRequest, WorkerResponse } from './types.js';

class SceneWorker {
  constructor() {
    self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
      const request = event.data;

      this.#handleRequest(request).catch((error: Error) => this.#handleError(request, error));
    });
  }

  initialize(...args: any[]) {}

  async #handleRequest(request: WorkerRequest) {
    const func = this[request.func];
    if (!func) {
      throw new Error(`Invalid function name: ${request.func}`);
    }

    const args = request.args ?? [];

    const out = await this[request.func](...args);

    if (Array.isArray(out)) {
      const [value, transfer] = out;
      this.#handleSuccess(request, value, transfer);
    } else {
      const value = out;
      this.#handleSuccess(request, value);
    }
  }

  #handleError(request: WorkerRequest, error: Error) {
    const response: WorkerResponse = {
      id: request.id,
      status: RESPONSE_STATUS.STATUS_ERROR,
      value: error,
    };

    self.postMessage(response);
  }

  #handleSuccess(request: WorkerRequest, value: any, transfer: Transferable[] = []) {
    const response: WorkerResponse = {
      id: request.id,
      status: RESPONSE_STATUS.STATUS_SUCCESS,
      value,
    };

    self.postMessage(response, { transfer });
  }
}

export default SceneWorker;
