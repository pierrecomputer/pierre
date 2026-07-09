import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, FileDiffMetadata } from '../src/types';
import type {
  DiffRendererInstance,
  InitializeWorkerRequest,
  RenderDiffRequest,
  RenderFileRequest,
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

afterAll(async () => {
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
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });

  test('settles initialization when terminate cancels active worker setup', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    await worker.waitForInitializeRequest();

    manager.terminate();

    await withTimeout(initialization);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: false,
    });
    expect(worker.terminated).toBe(true);
  });
});

describe('WorkerPoolManager cache priming', () => {
  test('primeDiffHighlightCache resolves after a successful response populates the diff cache', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const diff = createCacheableDiff();
      const prime = manager.primeDiffHighlightCache(diff);
      const request = await worker.waitForDiffRequest();

      expect(request.diff).toEqual(diff);
      expect(request.diff).not.toBe(diff);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();

      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(manager.getDiffResultCache(diff)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('stores a diff result under the cache key dispatched to the worker', async () => {
    const { initialization, manager, worker } = createInitializingManager();
    try {
      const diff = createCacheableDiff();
      const initialCacheKey = diff.cacheKey;
      if (initialCacheKey == null) {
        throw new Error('expected a cacheable diff');
      }
      const prime = manager.primeDiffHighlightCache(diff);

      diff.cacheKey = `${initialCacheKey}:queued`;
      const initializeRequest = await worker.waitForInitializeRequest();
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: initializeRequest.id,
        sentAt: Date.now(),
      });
      await withTimeout(initialization);
      const request = await worker.waitForDiffRequest();
      const dispatchedCacheKey = request.diff.cacheKey;
      if (dispatchedCacheKey == null) {
        throw new Error('expected a dispatched cache key');
      }

      diff.cacheKey = `${dispatchedCacheKey}:hydrated`;
      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(
        manager.getDiffResultCache({ ...diff, cacheKey: dispatchedCacheKey })
      ).toBeDefined();
      expect(
        manager.getDiffResultCache({ ...diff, cacheKey: initialCacheKey })
      ).toBeUndefined();
      expect(manager.getDiffResultCache(diff)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('stores a file result under the cache key dispatched to the worker', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const file = createCacheableFile();
      const prime = manager.primeFileHighlightCache(file);
      const request = await worker.waitForFileRequest();
      const dispatchedCacheKey = request.file.cacheKey;
      if (dispatchedCacheKey == null) {
        throw new Error('expected a dispatched cache key');
      }

      file.cacheKey = `${dispatchedCacheKey}:edited`;
      respondToFileRequest(manager, worker, request);
      await withTimeout(prime);

      expect(
        manager.getFileResultCache({ ...file, cacheKey: dispatchedCacheKey })
      ).toBeDefined();
      expect(manager.getFileResultCache(file)).toBeUndefined();
    } finally {
      manager.terminate();
    }
  });

  test('primeDiffHighlightCache awaits an existing matching render task', async () => {
    const { manager, worker } = await createInitializedManager();
    const successes: FileDiffMetadata[] = [];
    const instance: DiffRendererInstance = {
      __id: 'diff-renderer',
      onHighlightSuccess(diff) {
        successes.push(diff);
      },
      onHighlightError(error) {
        throw error;
      },
    };

    try {
      const diff = createCacheableDiff();
      manager.highlightDiffAST(instance, diff);
      const request = await worker.waitForDiffRequest();

      const prime = manager.primeDiffHighlightCache(diff);
      await Promise.resolve();

      expect(worker.diffRequestCount).toBe(1);
      respondToDiffRequest(manager, worker, request);
      await withTimeout(prime);

      expect(manager.getDiffResultCache(diff)).toBeDefined();
      expect(successes).toEqual([diff]);
    } finally {
      manager.cleanUpTasks(instance);
      manager.terminate();
    }
  });

  test('primeDiffHighlightCache rejects when an active task is terminated', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const prime = manager.primeDiffHighlightCache(createCacheableDiff());
      await worker.waitForDiffRequest();

      manager.terminate();

      let rejectedError: unknown;
      try {
        await prime;
      } catch (error) {
        rejectedError = error;
      }

      expect(rejectedError).toBeInstanceOf(Error);
      expect((rejectedError as Error).message).toContain('pool terminated');
    } finally {
      manager.terminate();
    }
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

async function createInitializedManager(): Promise<{
  manager: WorkerPoolManager;
  worker: TestWorker;
}> {
  const { initialization, manager, worker } = createInitializingManager();
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

function createCacheableDiff(): FileDiffMetadata {
  const oldFile = createCacheableFile('file:old', 'const value = "old";\n');
  const newFile = createCacheableFile('file:new', 'const value = "new";\n');
  return parseDiffFromFile(oldFile, newFile);
}

function createCacheableFile(
  cacheKey = 'file:cache',
  contents = 'const value = true;\n'
): FileContents {
  return {
    name: 'file.ts',
    contents,
    cacheKey,
  };
}

function respondToDiffRequest(
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

function respondToFileRequest(
  manager: WorkerPoolManager,
  worker: TestWorker,
  request: RenderFileRequest
): void {
  worker.respond({
    type: 'success',
    requestType: 'file',
    id: request.id,
    result: {
      code: [],
      themeStyles: '',
      baseThemeType: undefined,
    },
    options: manager.getFileRenderOptions(),
    sentAt: Date.now(),
  });
}

class TestWorker {
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
