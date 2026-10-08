import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { bundledLanguages } from 'shiki';

import { parseDiffFromFile, registerCustomLanguage } from '../src';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import * as sharedHighlighter from '../src/highlighter/shared_highlighter';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import {
  isHandledWorkerPoolError,
  WorkerPoolTerminatedError,
  WorkerPoolWorkerError,
} from '../src/worker/errors';
import type {
  DiffRendererInstance,
  RenderFileRequest,
} from '../src/worker/types';
import { createDeferred } from './testUtils';
import {
  createInitializedManager,
  createInitializingManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  withTimeout,
} from './workerPoolHarness';

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

afterEach(() => {
  mock.restore();
});

describe('WorkerPoolManager lifecycle', () => {
  test('initializes the pool and its workers with Shiki JS by default', async () => {
    await disposeHighlighter();
    const { manager, worker } = await createInitializedManager();
    try {
      const request = await worker.waitForInitializeRequest();
      expect(manager.getPreferredHighlighter()).toBe('shiki-js');
      expect(request.preferredHighlighter).toBe('shiki-js');
      expect(request.resolvedThemes[0].textmate).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('fails initialization when a worker emits an error', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const { initialization, manager, worker } = createInitializingManager();
    await worker.waitForInitializeRequest();

    worker.emitError(new Error('worker failed to load'));

    const initializationError = await getRejection(initialization);
    expect(initializationError.message).toContain('worker failed to load');
    // Without an error callback, consumers still need to log startup
    // failures.
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(isHandledWorkerPoolError(initializationError)).toBe(false);
    expect(manager.isWorkingPool()).toBe(false);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: true,
    });
    expect(worker.terminated).toBe(true);
    manager.terminate();
  });

  test('hands a worker error to onWorkerError and logs nothing itself', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const received: Array<{ event: ErrorEvent | Event; worker: Worker }> = [];
    const { initialization, manager, worker } = createInitializingManager(
      {},
      {
        onWorkerError: (event, failedWorker) => {
          received.push({ event, worker: failedWorker });
        },
      }
    );
    await worker.waitForInitializeRequest();

    worker.emitError(new Error('worker failed to load'));

    const initializationError = await getRejection(initialization);
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(initializationError.message).toContain('worker failed to load');
    expect(isHandledWorkerPoolError(initializationError)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toMatchObject({
      message: 'worker failed to load',
    });
    expect(received[0]?.worker).toBe(worker as unknown as Worker);
    expect(manager.isWorkingPool()).toBe(false);
    // Allow the constructor's error handler to run and check that it does not
    // log the failure already passed to onWorkerError.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).not.toHaveBeenCalled();
    manager.terminate();
  });

  test('hands the plain Event of a worker script that failed to load to onWorkerError', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const received: Event[] = [];
    const { initialization, manager, worker } = createInitializingManager(
      {},
      {
        onWorkerError: (event) => {
          received.push(event);
          event.preventDefault();
        },
      }
    );
    await worker.waitForInitializeRequest();

    // Failed script requests can produce an Event without message or error.
    const event = new Event('error', { cancelable: true });
    worker.emitErrorEvent(event);

    const initializationError = await getRejection(initialization);
    expect(initializationError).toBeInstanceOf(WorkerPoolWorkerError);
    expect(initializationError.message).toContain('failed to load');
    expect(isHandledWorkerPoolError(initializationError)).toBe(true);
    expect(received).toEqual([event]);
    expect(event.defaultPrevented).toBe(true);
    expect(manager.isWorkingPool()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).not.toHaveBeenCalled();
    manager.terminate();
  });

  test('fails a partial pool when any worker never responds', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const { initialization, manager, workers } = createInitializingManager(
      {},
      { poolSize: 2, workerInitializationTimeout: 10 }
    );
    const [responsiveWorker, silentWorker] = workers;
    if (responsiveWorker == null || silentWorker == null) {
      throw new Error('Expected two test workers');
    }
    const [responsiveRequest] = await Promise.all(
      workers.map((worker) => worker.waitForInitializeRequest())
    );
    responsiveWorker.respond({
      type: 'success',
      requestType: 'initialize',
      id: responsiveRequest.id,
      sentAt: Date.now(),
    });

    const initializationError = await getRejection(initialization);
    expect(initializationError.message).toContain(
      'worker initialization timed out after 10ms'
    );
    expect(manager.isWorkingPool()).toBe(false);
    expect(manager.getStats()).toMatchObject({
      managerState: 'waiting',
      activeTasks: 0,
      totalWorkers: 0,
      workersFailed: true,
    });
    expect(responsiveWorker.terminated).toBe(true);
    expect(silentWorker.terminated).toBe(true);
    manager.terminate();
  });

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
  for (const rejectLanguage of [true, false]) {
    test(`a worker ${rejectLanguage ? 'rejection resends' : 'success reuses'} the requested language on the next task`, async () => {
      await disposeHighlighter();
      const { manager, worker } = await createInitializedManager({
        preferredHighlighter: 'shiki-js',
      });
      const mismatch =
        'attachResolvedLanguages: No returned grammar declares "tf" as its name or an alias.';
      if (rejectLanguage) {
        registerCustomLanguage('tf', bundledLanguages.hcl);
        spyOn(console, 'error').mockImplementation(() => {});
      }
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const posted = createDeferred<RenderFileRequest>();
          spyOn(worker, 'postMessage').mockImplementation((request) => {
            if (request.type === 'file') {
              posted.resolve(structuredClone(request));
            }
          });
          const prime = manager.primeFileHighlightCache({
            name: 'example.tf',
            contents: `locals { label = "${attempt}" }`,
            cacheKey: `terraform:${attempt}`,
          });
          const settled = prime.catch((error: unknown) => error);
          const request = await withTimeout(posted.promise);
          if (rejectLanguage) {
            worker.respond({
              type: 'error',
              id: request.id,
              error: mismatch,
            });
            expect(await withTimeout(settled)).toEqual(new Error(mismatch));
            expect(request.resolvedLanguages?.map(({ name }) => name)).toEqual([
              'tf',
            ]);
            expect(
              request.resolvedLanguages?.[0]?.data.map(({ name }) => name)
            ).toEqual(['hcl']);
          } else {
            respondToFileRequest(manager, worker, request);
            expect(await withTimeout(settled)).toBeUndefined();
            if (attempt === 0) {
              expect(
                request.resolvedLanguages?.map(({ name }) => name)
              ).toEqual(['tf']);
            } else {
              expect(request.resolvedLanguages).toBeUndefined();
            }
          }
        }
      } finally {
        manager.terminate();
        RegisteredCustomLanguages.delete('tf');
        await disposeHighlighter();
      }
    });
  }

  test('reports a background preload failure without blocking worker rendering', async () => {
    await disposeHighlighter();
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'shiki-js',
    });
    const highlighter = await sharedHighlighter.getSharedHighlighter({
      themes: [],
      langs: [],
    });
    const preload = createDeferred<DiffsHighlighter>();
    const logged = createDeferred<unknown>();
    const error = new Error('Shared highlighter preload failed');
    spyOn(sharedHighlighter, 'getSharedHighlighter').mockImplementation(
      () => preload.promise
    );
    const logError = spyOn(console, 'error').mockImplementation((error) => {
      logged.resolve(error);
    });
    try {
      const file = { ...createCacheableFile(), lang: 'css' as const };
      const prime = manager.primeFileHighlightCache(file);
      const request = await withTimeout(worker.waitForFileRequest());
      respondToFileRequest(manager, worker, request);
      await withTimeout(prime);
      expect(manager.getFileResultCache(file)).toBeDefined();

      preload.reject(error);
      expect(await withTimeout(logged.promise)).toBe(error);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(manager.isWorkingPool()).toBe(true);
      expect(manager.getStats().activeTasks).toBe(0);
    } finally {
      preload.resolve(highlighter);
      manager.terminate();
    }
  });

  test('does not read or populate the shared cache for an unkeyed diff', async () => {
    const { manager, worker } = await createInitializedManager();
    const successes: FileDiffMetadata[] = [];
    const instance: DiffRendererInstance = {
      __id: 'unkeyed-diff-renderer',
      onHighlightSuccess(diff) {
        successes.push(diff);
      },
      onHighlightError(error) {
        throw error;
      },
    };
    const diff = parseDiffFromFile(
      { name: 'file.ts', contents: 'const value = "old";\n' },
      { name: 'file.ts', contents: 'const value = "new";\n' }
    );
    const sentinel = {
      result: {
        code: { additionLines: [], deletionLines: [] },
        themeStyles: 'sentinel',
        baseThemeType: undefined,
      },
      options: manager.getDiffRenderOptions(),
    };

    try {
      expect(diff.cacheKey).toBeUndefined();
      manager.inspectCaches().diffCache.set(diff.name, sentinel);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();

      manager.highlightDiffAST(instance, diff);
      const request = await worker.waitForDiffRequest();
      expect(request.diff.cacheKey).toBeUndefined();

      respondToDiffRequest(manager, worker, request);

      expect(successes).toEqual([diff]);
      expect(manager.inspectCaches().diffCache.size).toBe(1);
      expect(manager.inspectCaches().diffCache.get(diff.name)).toBe(sentinel);
      expect(manager.getDiffResultCache(diff)).toBeUndefined();
    } finally {
      manager.cleanUpTasks(instance);
      manager.terminate();
    }
  });

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

      expect(rejectedError).toBeInstanceOf(WorkerPoolTerminatedError);
      expect((rejectedError as Error).message).toContain('pool terminated');
      // Components should ignore expected cancellations when logging errors.
      expect(isHandledWorkerPoolError(rejectedError)).toBe(true);
    } finally {
      manager.terminate();
    }
  });
});

function createCacheableDiff(): FileDiffMetadata {
  const oldFile = createCacheableFile('file:old', 'const value = "old";\n');
  const newFile = createCacheableFile('file:new', 'const value = "new";\n');
  return parseDiffFromFile(oldFile, newFile);
}

async function getRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await withTimeout(promise);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('Expected promise to reject');
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
