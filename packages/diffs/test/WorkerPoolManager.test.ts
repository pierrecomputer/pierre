import { pierreDark, pierreLight } from '@pierre/highlights/themes';
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

import { parseDiffFromFile } from '../src';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { FileContents, FileDiffMetadata } from '../src/types';
import type {
  DiffRendererInstance,
  SetRenderOptionsWorkerRequest,
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
  test('fails initialization when a worker emits an error', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const { initialization, manager, worker } = createInitializingManager();
    await worker.waitForInitializeRequest();

    worker.emitError(new Error('worker failed to load'));

    const initializationError = await getRejection(initialization);
    expect(initializationError.message).toContain('worker failed to load');
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

describe('WorkerPoolManager themes', () => {
  test('resolves worker themes through the retained highlighter after shared disposal', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const retained = await getSharedHighlighter({ themes: ['github-dark'] });
      const name = 'retained-worker-theme';
      const retainedTheme = { ...pierreDark, name };
      const loader = mock(() => Promise.resolve(retainedTheme));
      retained.themeResolver.registerTheme(name, loader);
      await disposeHighlighter();
      const active = await getSharedHighlighter({ themes: ['github-dark'] });
      const activeTheme = { ...pierreLight, name };
      active.themeResolver.seedResolvedTheme(name, activeTheme);
      const posted = createDeferred<SetRenderOptionsWorkerRequest>();
      spyOn(worker, 'postMessage').mockImplementation((request) => {
        if (request.type === 'set-render-options') posted.resolve(request);
      });

      const update = manager.setRenderOptions({ theme: name });
      const request = await withTimeout(posted.promise);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(request.resolvedThemes).toEqual([retainedTheme]);
      expect(retained.getTheme(name)).toEqual(retainedTheme);
      expect(active.getTheme(name)).toEqual(activeTheme);
      worker.respond({
        type: 'success',
        requestType: 'set-render-options',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(update);
    } finally {
      manager.terminate();
    }
  });

  test('posts already resolved theme changes before yielding', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const highlighter = await getSharedHighlighter({
        themes: ['github-light'],
      });
      const postMessage = spyOn(worker, 'postMessage');
      const update = manager.setRenderOptions({ theme: 'github-light' });
      const request = postMessage.mock.calls[0]?.[0];
      if (request?.type !== 'set-render-options') {
        throw new Error('Expected a synchronous render-options request');
      }
      expect(request.resolvedThemes).toEqual([
        highlighter.getTheme('github-light'),
      ]);
      expect(manager.getFileRenderOptions().theme).toBe('github-light');
      worker.respond({
        type: 'success',
        requestType: 'set-render-options',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(update);
    } finally {
      manager.terminate();
    }
  });
});

describe('WorkerPoolManager cache priming', () => {
  test('sends files without language grammar payloads', async () => {
    const { manager, worker } = await createInitializedManager();
    try {
      const file = {
        name: 'example.tf',
        contents: 'locals { label = "example" }',
        cacheKey: 'terraform',
      };
      const prime = manager.primeFileHighlightCache(file);
      const request = await withTimeout(worker.waitForFileRequest());
      expect(request).not.toHaveProperty('resolvedLanguages');
      respondToFileRequest(manager, worker, request);
      await withTimeout(prime);
      expect(manager.getFileResultCache(file)).toBeDefined();
    } finally {
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

      expect(rejectedError).toBeInstanceOf(Error);
      expect((rejectedError as Error).message).toContain('pool terminated');
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
