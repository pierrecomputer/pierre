import type { ElementContent } from 'hast';

import type {
  InitializeWorkerRequest,
  RenderDiffRequest,
  RenderFileRequest,
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
  WorkerRequest,
  WorkerResponse,
} from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';

// WorkerPoolManager schedules its broadcasts through requestAnimationFrame,
// which Bun's test environment does not provide. Installs a setTimeout-backed
// substitute and returns a restore function for afterAll.
export function installAnimationFramePolyfill(): () => void {
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

  return () => {
    for (const timeout of frames.values()) {
      clearTimeout(timeout);
    }
    frames.clear();
    if (originalRequestAnimationFrame != null) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
    if (originalCancelAnimationFrame != null) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
  };
}

// A plain object substituted for a browser Worker through `workerFactory`.
// Records posted requests by type and delivers responses to the manager's
// message listeners on demand, so tests fully control response timing.
export class TestWorker {
  terminated = false;
  private diffRequests: RenderDiffRequest[] = [];
  private diffRequestResolve:
    | ((request: RenderDiffRequest) => void)
    | undefined;
  private fileRequests: RenderFileRequest[] = [];
  private fileRequestResolve:
    | ((request: RenderFileRequest) => void)
    | undefined;
  private initializeRequest: InitializeWorkerRequest | undefined;
  private initializeRequestResolve:
    | ((request: InitializeWorkerRequest) => void)
    | undefined;
  private readonly initializeRequestPromise =
    new Promise<InitializeWorkerRequest>((resolve) => {
      this.initializeRequestResolve = resolve;
    });
  private readonly messageListeners = new Set<EventListener>();
  private readonly errorListeners = new Set<EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListeners.add(listener);
    } else if (type === 'error') {
      this.errorListeners.add(listener);
    }
  }

  postMessage(request: WorkerRequest): void {
    // Browser workers synchronously clone a message before returning.
    const clonedRequest = structuredClone(request);
    if (clonedRequest.type === 'initialize') {
      this.initializeRequest = clonedRequest;
      this.initializeRequestResolve?.(clonedRequest);
    } else if (clonedRequest.type === 'diff') {
      this.diffRequests.push(clonedRequest);
      this.diffRequestResolve?.(clonedRequest);
      this.diffRequestResolve = undefined;
    } else if (clonedRequest.type === 'file') {
      this.fileRequests.push(clonedRequest);
      this.fileRequestResolve?.(clonedRequest);
      this.fileRequestResolve = undefined;
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  async waitForInitializeRequest(): Promise<InitializeWorkerRequest> {
    return this.initializeRequest ?? this.initializeRequestPromise;
  }

  get diffRequestCount(): number {
    return this.diffRequests.length;
  }

  get fileRequestCount(): number {
    return this.fileRequests.length;
  }

  async waitForDiffRequest(): Promise<RenderDiffRequest> {
    const request = this.diffRequests.at(-1);
    if (request != null) {
      return request;
    }
    return new Promise<RenderDiffRequest>((resolve) => {
      this.diffRequestResolve = resolve;
    });
  }

  async waitForFileRequest(): Promise<RenderFileRequest> {
    const request = this.fileRequests.at(-1);
    if (request != null) {
      return request;
    }
    return new Promise<RenderFileRequest>((resolve) => {
      this.fileRequestResolve = resolve;
    });
  }

  respond(response: WorkerResponse): void {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<WorkerResponse>);
    }
  }

  emitError(error: Error): void {
    const event = { error, message: error.message } as ErrorEvent;
    for (const listener of this.errorListeners) {
      listener(event);
    }
  }
}

export function createInitializingManager(
  initOptions: Partial<WorkerInitializationRenderOptions> = {},
  poolOptions: Pick<
    WorkerPoolOptions,
    'poolSize' | 'workerInitializationTimeout'
  > = {}
): {
  initialization: Promise<void>;
  manager: WorkerPoolManager;
  worker: TestWorker;
  workers: TestWorker[];
} {
  const worker = new TestWorker();
  const workers = [worker];
  for (let i = 1; i < (poolOptions.poolSize ?? 1); i++) {
    workers.push(new TestWorker());
  }
  let workerIndex = 0;
  const manager = new WorkerPoolManager(
    {
      poolSize: poolOptions.poolSize ?? 1,
      workerFactory: () => {
        const nextWorker = workers[workerIndex++];
        if (nextWorker == null) {
          throw new Error('Test worker pool exhausted');
        }
        return nextWorker as unknown as Worker;
      },
      ...poolOptions,
    },
    {
      langs: [],
      preferredHighlighter: 'shiki-js',
      theme: 'github-dark',
      ...initOptions,
    }
  );
  return {
    initialization: manager.initialize(),
    manager,
    worker,
    workers,
  };
}

export async function createInitializedManager(
  initOptions: Partial<WorkerInitializationRenderOptions> = {}
): Promise<{
  manager: WorkerPoolManager;
  worker: TestWorker;
}> {
  const { initialization, manager, worker } =
    createInitializingManager(initOptions);
  const request = await worker.waitForInitializeRequest();
  worker.respond({
    type: 'success',
    requestType: 'initialize',
    id: request.id,
    sentAt: Date.now(),
  });
  await withTimeout(initialization);
  return { manager, worker };
}

export function respondToDiffRequest(
  manager: WorkerPoolManager,
  worker: TestWorker,
  request: RenderDiffRequest
): void {
  worker.respond({
    type: 'success',
    requestType: 'diff',
    id: request.id,
    result: {
      code: { additionLines: [], deletionLines: [] },
      themeStyles: '',
      baseThemeType: undefined,
    },
    options: manager.getDiffRenderOptions(),
    sentAt: Date.now(),
  });
}

export function respondToFileRequest(
  manager: WorkerPoolManager,
  worker: TestWorker,
  request: RenderFileRequest,
  code: ElementContent[] = []
): void {
  worker.respond({
    type: 'success',
    requestType: 'file',
    id: request.id,
    result: {
      code,
      themeStyles: '',
      baseThemeType: undefined,
    },
    options: manager.getFileRenderOptions(),
    sentAt: Date.now(),
  });
}

export function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for promise to settle'));
    }, 5_000);

    promise.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
    });
  });
}
