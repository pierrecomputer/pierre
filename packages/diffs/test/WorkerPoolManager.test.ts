import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  InitializeWorkerRequest,
  WorkerRequest,
  WorkerResponse,
} from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';

const originalRequestAnimationFrame =
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame
    : undefined;
const originalCancelAnimationFrame =
  typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame
    : undefined;
let nextFrameId = 0;
const frames = new Map<number, ReturnType<typeof setTimeout>>();

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback) => {
    const id = ++nextFrameId;
    const timeout = setTimeout(() => {
      frames.delete(id);
      callback(performance.now());
    }, 0);
    frames.set(id, timeout);
    return id;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((id) => {
    const timeout = frames.get(id);
    if (timeout != null) {
      clearTimeout(timeout);
      frames.delete(id);
    }
  }) as typeof cancelAnimationFrame;
});

afterAll(() => {
  for (const timeout of frames.values()) {
    clearTimeout(timeout);
  }
  frames.clear();

  if (originalRequestAnimationFrame != null) {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
  if (originalCancelAnimationFrame != null) {
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

afterEach(async () => {
  await disposeHighlighter();
});

describe('WorkerPoolManager lifecycle', () => {
  test('ignores stale initialization after terminate', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    const request = await worker.waitForInitializeRequest();

    worker.respond({
      type: 'success',
      requestType: 'initialize',
      id: request.id,
      sentAt: Date.now(),
    });
    manager.terminate();

    await withTimeout(initialization);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      pendingTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });

  test('settles initialization when terminate cancels pending worker setup', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    await worker.waitForInitializeRequest();

    manager.terminate();

    await withTimeout(initialization);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      pendingTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });
});

function createInitializingManager(): {
  initialization: Promise<void>;
  manager: WorkerPoolManager;
  worker: TestWorker;
} {
  const worker = new TestWorker();
  const manager = new WorkerPoolManager(
    {
      poolSize: 1,
      workerFactory: () => worker as unknown as Worker,
    },
    {
      langs: [],
      preferredHighlighter: 'shiki-js',
      theme: 'github-dark',
    }
  );
  return {
    initialization: manager.initialize(),
    manager,
    worker,
  };
}

class TestWorker {
  terminated = false;
  private initializeRequest: InitializeWorkerRequest | undefined;
  private initializeRequestResolve:
    | ((request: InitializeWorkerRequest) => void)
    | undefined;
  private readonly initializeRequestPromise =
    new Promise<InitializeWorkerRequest>((resolve) => {
      this.initializeRequestResolve = resolve;
    });
  private readonly messageListeners = new Set<
    (event: MessageEvent<WorkerResponse>) => void
  >();

  addEventListener(
    type: string,
    listener: (event: MessageEvent<WorkerResponse>) => void
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener);
    }
  }

  postMessage(request: WorkerRequest): void {
    if (request.type !== 'initialize') {
      return;
    }
    this.initializeRequest = request;
    this.initializeRequestResolve?.(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  async waitForInitializeRequest(): Promise<InitializeWorkerRequest> {
    return this.initializeRequest ?? this.initializeRequestPromise;
  }

  respond(response: WorkerResponse): void {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<WorkerResponse>);
    }
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for promise to settle'));
    }, 5_000);

    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
    });
  });
}
