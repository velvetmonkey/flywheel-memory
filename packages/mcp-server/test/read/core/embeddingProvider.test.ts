import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  MockWorker,
  workerInstances,
  workerCtor,
  existsSyncMock,
} = vi.hoisted(() => {
  class MockWorker {
    public readonly handlers = {
      message: [] as Array<(msg: unknown) => void>,
      error: [] as Array<(err: Error) => void>,
      exit: [] as Array<(code: number) => void>,
    };
    public readonly postedMessages: unknown[] = [];
    public readonly terminate = vi.fn(async () => 0);

    constructor(public readonly workerPath: string) {}

    on(event: 'message' | 'error' | 'exit', handler: (payload: any) => void): this {
      this.handlers[event].push(handler);
      return this;
    }

    postMessage(message: unknown): void {
      this.postedMessages.push(message);
    }

    emit(event: 'message' | 'error' | 'exit', payload: unknown): void {
      for (const handler of this.handlers[event]) {
        handler(payload as never);
      }
    }
  }

  const workerInstances: MockWorker[] = [];
  class MockWorkerCtor extends MockWorker {
    constructor(workerPath: string) {
      super(workerPath);
      workerInstances.push(this);
    }
  }
  const existsSyncMock = vi.fn(() => true);

  return { MockWorker, workerInstances, workerCtor: MockWorkerCtor, existsSyncMock };
});

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:worker_threads', () => ({
  Worker: workerCtor,
}));

import {
  WorkerEmbeddingProvider,
  EmbeddingProviderShutdownError,
  getEmbeddingProvider,
  resetEmbeddingProvider,
} from '../../../src/core/read/embeddingProvider.js';

function getWorker(index: number): InstanceType<typeof MockWorker> {
  const worker = workerInstances[index];
  if (!worker) {
    throw new Error(`Expected worker at index ${index}`);
  }
  return worker;
}

describe('WorkerEmbeddingProvider', () => {
  beforeEach(() => {
    workerInstances.length = 0;
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    resetEmbeddingProvider();
  });

  afterEach(() => {
    resetEmbeddingProvider();
  });

  it('supports repeated init/shutdown cycles on the same provider instance', async () => {
    const provider = new WorkerEmbeddingProvider('model-a');

    const firstInit = provider.init();
    const firstWorker = getWorker(0);
    firstWorker.emit('message', { type: 'ready', dims: 384 });
    await expect(firstInit).resolves.toEqual({ dims: 384 });

    provider.shutdown('test shutdown');
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

    const secondInit = provider.init();
    const secondWorker = getWorker(1);
    expect(secondWorker).not.toBe(firstWorker);
    secondWorker.emit('message', { type: 'ready', dims: 768 });
    await expect(secondInit).resolves.toEqual({ dims: 768 });
  });

  it('rejects pending embeds when shutdown is requested', async () => {
    const provider = new WorkerEmbeddingProvider('model-a');

    const initPromise = provider.init();
    const worker = getWorker(0);
    worker.emit('message', { type: 'ready', dims: 2 });
    await initPromise;

    const embedPromise = provider.embed('hello world');
    provider.shutdown('manual shutdown');

    await expect(embedPromise).rejects.toBeInstanceOf(EmbeddingProviderShutdownError);
    await expect(embedPromise).rejects.toThrow(/manual shutdown/);
  });

  it('rejects init when the worker exits before becoming ready', async () => {
    const provider = new WorkerEmbeddingProvider('model-a');

    const initPromise = provider.init();
    const worker = getWorker(0);
    worker.emit('exit', 1);

    await expect(initPromise).rejects.toThrow(/exited with code 1/);
  });

  it('rejects in-flight embeds when switching models through the provider cache', async () => {
    const providerA = getEmbeddingProvider('model-a');
    const initA = providerA.init();
    const workerA = getWorker(0);
    workerA.emit('message', { type: 'ready', dims: 2 });
    await initA;

    const embedPromise = providerA.embed('hello world');

    const providerB = getEmbeddingProvider('model-b');
    expect(providerB).not.toBe(providerA);
    expect(workerA.terminate).toHaveBeenCalledTimes(1);

    await expect(embedPromise).rejects.toBeInstanceOf(EmbeddingProviderShutdownError);
    await expect(embedPromise).rejects.toThrow(/model switch/);

    const initB = providerB.init();
    const workerB = getWorker(1);
    workerB.emit('message', { type: 'ready', dims: 3 });
    await expect(initB).resolves.toEqual({ dims: 3 });
  });
});
