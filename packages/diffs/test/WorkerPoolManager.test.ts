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
import { CodeView } from '../src/components/CodeView';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import * as sharedHighlighter from '../src/highlighter/shared_highlighter';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import highlightsHighlighter from '../src/highlights';
import type {
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import type { DiffRendererInstance } from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { createRoot, installDom, waitFor } from './domHarness';
import { createDeferred } from './testUtils';
import {
  createInitializedManager,
  createInitializingManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  TestWorker,
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
  setHighlighter(shikiHighlighter);
  mock.restore();
});

describe('WorkerPoolManager lifecycle', () => {
  test.each(['updated', 'constructed', 'failed bootstrap'] as const)(
    'restores a valid Shiki theme after a custom-only theme (%s)',
    async (state) => {
      setHighlighter({
        ...shikiHighlighter,
        name: 'custom',
        load: async () => {},
      });
      const worker = new TestWorker();
      const manager = new WorkerPoolManager(
        { poolSize: 1, workerFactory: () => worker as unknown as Worker },
        {
          theme:
            state === 'constructed'
              ? 'custom-only-restore-theme'
              : 'github-dark',
        }
      );
      const appliedThemes: unknown[] = [];
      manager.subscribeToThemeChanges({
        onThemeChange: () =>
          appliedThemes.push(manager.getFileRenderOptions().theme),
      });
      try {
        if (state !== 'constructed') {
          await manager.setRenderOptions({
            theme: 'custom-only-restore-theme',
          });
        }
        setHighlighter(shikiHighlighter);
        if (state === 'failed bootstrap') {
          void manager.initialize().catch(() => {});
        }
        const update = manager.setRenderOptions({ theme: 'github-light' });
        const request = await withTimeout(worker.waitForInitializeRequest());
        expect(request.renderOptions.theme).toBe('github-light');
        expect(request.resolvedThemes.map(({ name }) => name)).toContain(
          'github-light'
        );
        worker.respond({
          type: 'success',
          requestType: 'initialize',
          id: request.id,
          sentAt: Date.now(),
        });
        await update;
        expect(manager.isInitialized()).toBe(true);
        expect(manager.getFileRenderOptions().theme).toBe('github-light');
        expect(appliedThemes.at(-1)).toBe('github-light');
      } finally {
        manager.terminate();
      }
    }
  );

  test('updates custom themes without loading Shiki or starting workers', async () => {
    const load = mock(async () => {});
    setHighlighter({ ...shikiHighlighter, name: 'custom', load });
    const sharedLoad = spyOn(sharedHighlighter, 'getSharedHighlighter');
    const factory = mock(() => new TestWorker() as unknown as Worker);
    const manager = new WorkerPoolManager(
      { poolSize: 1, workerFactory: factory },
      { theme: 'github-dark' }
    );
    const onThemeChange = mock(() => {});
    manager.subscribeToThemeChanges({ onThemeChange });
    const { fileCache, diffCache } = manager.inspectCaches();
    fileCache.set('old', {
      options: manager.getFileRenderOptions(),
      result: { code: [], themeStyles: '', baseThemeType: undefined },
    });
    diffCache.set('old', {
      options: manager.getDiffRenderOptions(),
      result: {
        code: { additionLines: [], deletionLines: [] },
        themeStyles: '',
        baseThemeType: undefined,
      },
    });
    try {
      await manager.setRenderOptions({ theme: 'custom-only-theme' });
      expect(load).toHaveBeenCalledWith({
        themes: ['custom-only-theme'],
        langs: [],
      });
      expect(manager.getFileRenderOptions().theme).toBe('custom-only-theme');
      expect(fileCache.size).toBe(0);
      expect(diffCache.size).toBe(0);
      expect(onThemeChange).toHaveBeenCalledTimes(1);
      expect(sharedLoad).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
    } finally {
      manager.terminate();
    }
  });

  test.each(['superseded', 'terminated', 'replaced'] as const)(
    'ignores a %s custom theme load',
    async (reason) => {
      const pending = createDeferred<void>();
      const load = mock(({ themes }: { themes: string[] }) =>
        themes.includes('custom-slow') ? pending.promise : Promise.resolve()
      );
      setHighlighter({ ...shikiHighlighter, name: 'custom', load });
      const manager = new WorkerPoolManager(
        { workerFactory: () => new TestWorker() as unknown as Worker },
        { theme: 'github-dark' }
      );
      const onThemeChange = mock(() => {});
      manager.subscribeToThemeChanges({ onThemeChange });
      try {
        const update = manager.setRenderOptions({ theme: 'custom-slow' });
        if (reason === 'superseded') {
          await manager.setRenderOptions({ theme: 'custom-latest' });
        } else if (reason === 'terminated') {
          manager.terminate();
        } else {
          setHighlighter(shikiHighlighter);
        }
        pending.resolve();
        await update;
        expect(manager.getFileRenderOptions().theme).toBe(
          reason === 'superseded' ? 'custom-latest' : 'github-dark'
        );
        expect(onThemeChange).toHaveBeenCalledTimes(
          reason === 'superseded' ? 1 : 0
        );
      } finally {
        pending.resolve();
        manager.terminate();
      }
    }
  );

  test('ignores a stale Shiki initialization after custom themes restart the pool', async () => {
    const highlighter = await sharedHighlighter.getSharedHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['text'],
    });
    const pending = createDeferred<DiffsHighlighter>();
    const sharedLoad = spyOn(
      sharedHighlighter,
      'getSharedHighlighter'
    ).mockImplementationOnce(() => pending.promise);
    const workers = [new TestWorker(), new TestWorker()];
    let nextWorker = 0;
    const factory = mock(() => workers[nextWorker++] as unknown as Worker);
    const manager = new WorkerPoolManager(
      { poolSize: 1, workerFactory: factory },
      { theme: 'github-dark' }
    );
    try {
      const staleInitialization = manager.initialize();
      const initialRequest = await workers[0].waitForInitializeRequest();
      workers[0].respond({
        type: 'success',
        requestType: 'initialize',
        id: initialRequest.id,
        sentAt: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      setHighlighter({
        ...shikiHighlighter,
        name: 'custom',
        load: async () => {},
      });
      await manager.setRenderOptions({ theme: 'github-light' });
      expect(sharedLoad).toHaveBeenCalledTimes(1);
      expect(workers[0].terminated).toBe(true);
      expect(manager.isInitialized()).toBe(false);
      expect(factory).toHaveBeenCalledTimes(1);

      setHighlighter(shikiHighlighter);
      const initialization = manager.initialize();
      const request = await withTimeout(workers[1].waitForInitializeRequest());
      expect(request.renderOptions.theme).toBe('github-light');
      workers[1].respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
      await initialization;
      pending.resolve(highlighter);
      await staleInitialization;
      expect(manager.isInitialized()).toBe(true);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(workers[1].terminated).toBe(false);
      expect(manager.getStats().totalWorkers).toBe(1);
    } finally {
      pending.resolve(highlighter);
      manager.terminate();
    }
  });

  test('keeps an existing CodeView attached through custom themes and back to Shiki', async () => {
    const dom = installDom();
    const workers = [new TestWorker(), new TestWorker()];
    let nextWorker = 0;
    const manager = new WorkerPoolManager(
      {
        poolSize: 1,
        workerFactory: () => workers[nextWorker++] as unknown as Worker,
      },
      { theme: 'github-dark' }
    );
    const viewer = new CodeView({ disableFileHeader: true }, manager);
    const root = createRoot();
    try {
      const initialRequest = await workers[0].waitForInitializeRequest();
      workers[0].respond({
        type: 'success',
        requestType: 'initialize',
        id: initialRequest.id,
        sentAt: Date.now(),
      });
      await manager.initialize();
      viewer.setup(root);
      viewer.setItems([
        {
          id: 'file',
          type: 'file',
          file: { name: 'file.txt', lang: 'text', contents: 'hello' },
        },
      ]);
      viewer.render(true);
      const container = root.querySelector('diffs-container');
      expect(container).not.toBeNull();

      setHighlighter({
        ...highlightsHighlighter,
        getTheme(name) {
          return { ...highlightsHighlighter.getTheme(name), bg: '#112233' };
        },
      });
      await manager.setRenderOptions({ theme: 'github-light' });
      await waitFor(
        () =>
          container?.shadowRoot?.textContent?.includes(
            '--diffs-bg:#112233;'
          ) === true
      );
      expect(container?.shadowRoot?.textContent).toContain(
        '--diffs-bg:#112233;'
      );

      setHighlighter(shikiHighlighter);
      viewer.render(true);
      const initialization = manager.initialize();
      const request = await withTimeout(workers[1].waitForInitializeRequest());
      workers[1].respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
      await initialization;
      const expected = `--diffs-bg:${shikiHighlighter.getTheme('github-light').bg};`;
      await waitFor(
        () => container?.shadowRoot?.textContent?.includes(expected) === true
      );
      expect(root.querySelector('diffs-container')).toBe(container);
      expect(container?.shadowRoot?.textContent).toContain(expected);
      expect(container?.shadowRoot?.textContent).not.toContain(
        '--diffs-bg:#112233;'
      );
      expect(viewer.getRenderedItems()).toHaveLength(1);
    } finally {
      viewer.cleanUp();
      manager.terminate();
      root.remove();
      dom.cleanup();
    }
  });

  test('accepts the legacy cache limit and prefers the new option', () => {
    setHighlighter({ ...shikiHighlighter, name: 'custom' });
    for (const [options, expected] of [
      [{ totalASTLRUCacheSize: 500 }, 500],
      [{ totalASTLRUCacheSize: 500, totalTokenLRUCacheSize: 25 }, 25],
    ] as const) {
      const manager = new WorkerPoolManager(
        {
          workerFactory: () => {
            throw new Error('Unexpected worker');
          },
          ...options,
        },
        {}
      );
      const { fileCache, diffCache } = manager.inspectCaches();
      expect(fileCache.limit).toBe(expected);
      expect(diffCache.limit).toBe(expected);
      manager.terminate();
    }
  });

  test('defers Shiki initialization while a custom highlighter is registered', async () => {
    const sharedLoad = spyOn(sharedHighlighter, 'getSharedHighlighter');
    const worker = new TestWorker();
    const factory = mock(() => worker as unknown as Worker);
    setHighlighter({ ...shikiHighlighter, name: 'custom' });
    const manager = new WorkerPoolManager(
      { poolSize: 1, workerFactory: factory },
      { theme: 'github-dark' }
    );
    await manager.initialize(['typescript']);
    expect(factory).not.toHaveBeenCalled();
    expect(sharedLoad).not.toHaveBeenCalled();
    expect(manager.isWorkingPool()).toBe(false);

    setHighlighter(shikiHighlighter);
    const initialization = manager.initialize();
    const request = await worker.waitForInitializeRequest();
    worker.respond({
      type: 'success',
      requestType: 'initialize',
      id: request.id,
      sentAt: Date.now(),
    });
    await initialization;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.isInitialized()).toBe(true);
    manager.terminate();
  });

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

describe('WorkerPoolManager cache priming', () => {
  test('reports a background preload failure without blocking worker rendering', async () => {
    await disposeHighlighter();
    const { manager, worker } = await createInitializedManager();
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

      manager.highlightDiffTokens(instance, diff);
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
      manager.highlightDiffTokens(instance, diff);
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
