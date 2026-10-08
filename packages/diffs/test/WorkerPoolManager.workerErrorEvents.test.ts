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

// worker.ts sends request errors as responses. An `error` event can come
// from unrelated code, such as a timer. These tests check that a request
// can still complete after such an event, and that a worker that stops
// responding receives no further work.

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

  // No caller awaits initialize() in this test. The constructor's error
  // handler must catch the startup failure to prevent an unhandled
  // rejection.
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

// Use the name in each cache key so tests can create separate highlight
// tasks.
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
