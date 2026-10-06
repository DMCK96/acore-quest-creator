import { describe, expect, it } from 'vitest';
import SceneWorkerController from '../../src/renderer/world3d/scene/worker/SceneWorkerController';
import { RESPONSE_STATUS } from '../../src/renderer/world3d/scene/worker/const';

/** A worker that records what it is sent and answers when told to */
class FakeWorker {
  sent: { id: number; func: string }[] = [];
  terminated = false;
  #listener: ((event: { data: unknown }) => void) | null = null;
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
    this.#listener = listener;
  }
  postMessage(message: { id: number; func: string }) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(id: number, value: unknown) {
    this.#listener?.({ data: { id, status: RESPONSE_STATUS.STATUS_SUCCESS, value } });
  }
}

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  promise.then(() => (done = true), () => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

const controller = () => {
  const worker = new FakeWorker();
  return { worker, loader: new SceneWorkerController(() => worker as unknown as Worker, { host: 'x' }) };
};

describe('a scene worker controller', () => {
  it('answers a request once the worker is set up', async () => {
    const { worker, loader } = controller();
    const spec = loader.request('loadSpec', 'a.m2');
    worker.answer(0, undefined); // initialize
    await Promise.resolve();
    await Promise.resolve();
    worker.answer(1, 'spec');
    await expect(spec).resolves.toBe('spec');
  });

  it('stops its worker when disposed, so leaving a world leaves no worker behind', () => {
    const { worker, loader } = controller();
    loader.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('sends nothing after it is disposed, and a request then never settles', async () => {
    const { worker, loader } = controller();
    loader.dispose();
    const late = loader.request('loadSpec', 'a.m2');
    expect(worker.sent).toEqual([]);
    expect(await settled(late)).toBe(false);
  });

  it('ignores an answer that arrives for a request it dropped', () => {
    const { worker, loader } = controller();
    void loader.request('loadSpec', 'a.m2');
    loader.dispose();
    expect(() => worker.answer(0, undefined)).not.toThrow();
  });
});
