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
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileDiffMetadata } from '../src/types';
import type { DiffRendererInstance } from '../src/worker/types';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import {
  createInitializedManager,
  createInitializingManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  TestWorker,
  withTimeout,
} from './workerPoolHarness';

// A worker's `error` event after initialization does not come from the request
// it is running: worker.ts catches every request failure and posts an `error`
// response. The event comes from code outside the request handler, such as a
// timer. That code does not stop the worker, so the worker still answers. If
// the worker has crashed instead, it answers nothing again. These tests cover
// both cases.

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

describe('WorkerPoolManager worker error events', () => {
  test('a running worker that fires error still delivers its answer', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const { manager, worker } = await createInitializedManager();
    try {
      const successes: FileDiffMetadata[] = [];
      const errors: unknown[] = [];
      const instance: DiffRendererInstance = {
        __id: 'alive-worker-diff-renderer',
        onHighlightSuccess(diff) {
          successes.push(diff);
        },
        onHighlightError(error) {
          errors.push(error);
        },
      };
      const diff = createDiff('alive');
      const prime = manager.primeDiffHighlightCache(diff);
      manager.highlightDiffAST(instance, diff);
      const request = await worker.waitForDiffRequest();

      worker.emitError(new Error('stray error outside the request handler'));
      respondToDiffRequest(manager, worker, request);

      await withTimeout(prime);
      expect(errors).toEqual([]);
      expect(successes).toHaveLength(1);
      expect(manager.getDiffResultCache(diff)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('a worker that fires error and goes silent gets no new work', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    // Both workers load the diff language, so the pool prefers the first one.
    const { initialization, manager, workers } = createInitializingManager(
      { langs: ['typescript'] },
      { poolSize: 2 }
    );
    const [crashedWorker, liveWorker] = workers;
    for (const worker of workers) {
      const request = await worker.waitForInitializeRequest();
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
    }
    await withTimeout(initialization);
    try {
      void manager.primeDiffHighlightCache(createDiff('first')).catch(() => {});
      await crashedWorker.waitForDiffRequest();
      crashedWorker.emitError(new Error('worker crashed'));

      const secondPrime = manager.primeDiffHighlightCache(createDiff('second'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(crashedWorker.diffRequestCount).toBe(1);
      expect(liveWorker.diffRequestCount).toBe(1);
      const request = await liveWorker.waitForDiffRequest();
      respondToDiffRequest(manager, liveWorker, request);
      await withTimeout(secondPrime);
    } finally {
      manager.terminate();
    }
  });

  test('setRenderOptions resolves when a worker fires error and then acknowledges', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const { manager, worker } = await createInitializedManager();
    try {
      const update = manager.setRenderOptions({ theme: 'github-light' });
      const request = await withTimeout(
        worker.waitForSetRenderOptionsRequest()
      );

      worker.emitError(new Error('stray error outside the request handler'));
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

  // The constructor's initialize() call returns before initialization
  // settles, so queueInitialization's catch never sees the failure. If no other
  // caller awaits initialize(), the failure is an unhandled rejection, and Bun
  // fails the test on it. The hook does not change that.
  test('a failed initialization that only the constructor started is not an unhandled rejection', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const worker = new TestWorker();
    const manager = new WorkerPoolManager(
      {
        poolSize: 1,
        workerFactory: () => worker as unknown as Worker,
        onWorkerError: () => {},
      },
      { langs: [], preferredHighlighter: 'shiki-js', theme: 'github-dark' }
    );
    try {
      await worker.waitForInitializeRequest();
      worker.emitError(new Error('worker failed to load'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.isWorkingPool()).toBe(false);
    } finally {
      manager.terminate();
    }
  });
});

// Creates a TypeScript diff whose cache key is unique to `name`, so each call
// makes a separate pool task.
function createDiff(name: string): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: 'file.ts',
      contents: `const ${name} = "old";\n`,
      cacheKey: `${name}:old`,
    },
    {
      name: 'file.ts',
      contents: `const ${name} = "new";\n`,
      cacheKey: `${name}:new`,
    }
  );
}
