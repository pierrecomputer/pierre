import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import chameleHighlighter from '../src/chamele';
import { CodeView } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import type {
  HighlighterTypes,
  RenderDiffOptions,
  RenderFileOptions,
} from '../src/types';
import type { WorkerPoolManager, WorkerStats } from '../src/worker';
import { createRoot, installDom, makeFileItem, wait } from './domHarness';

class FakeWorkerPoolManager {
  private initialized = false;
  private failed = false;
  private initializeCalls = 0;
  private autoInitialize = false;
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();

  public get statSubscriberCount(): number {
    return this.statSubscribers.size;
  }

  public get initializeCallCount(): number {
    return this.initializeCalls;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public isWorkingPool(): boolean {
    return false;
  }

  // Mirror the real manager: a waiting pool only leaves 'waiting' once
  // initialize() runs. When auto-initialize is enabled, initialize() drives the
  // pool to 'initialized' the way the real worker bootstrap eventually does.
  public initialize(): Promise<void> {
    this.initializeCalls += 1;
    if (this.autoInitialize) {
      this.markInitialized();
    }
    return Promise.resolve();
  }

  public enableAutoInitialize(): void {
    this.autoInitialize = true;
  }

  public subscribeToStatChanges(
    callback: (stats: WorkerStats) => unknown
  ): () => void {
    this.statSubscribers.add(callback);
    callback(this.getStats());
    return () => {
      this.statSubscribers.delete(callback);
    };
  }

  public subscribeToThemeChanges(): () => void {
    return () => {};
  }

  public unsubscribeToThemeChanges(): void {}

  public cleanUpTasks(): void {}

  public getFileResultCache(): undefined {
    return undefined;
  }

  // The real manager reports its configured render options regardless of
  // pool health; renderers read the local-fallback theme and engine here.
  public getPreferredHighlighter(): HighlighterTypes {
    return 'shiki-js';
  }

  public getFileRenderOptions(): RenderFileOptions {
    return {
      theme: DEFAULT_THEMES,
      useTokenTransformer: false,
      tokenizeMaxLineLength: 1000,
    };
  }

  public getDiffRenderOptions(): RenderDiffOptions {
    return {
      ...this.getFileRenderOptions(),
      lineDiffType: 'word-alt',
      maxLineDiffLength: 1000,
    };
  }

  public markInitialized(): void {
    this.initialized = true;
    const stats = this.getStats();
    for (const callback of Array.from(this.statSubscribers)) {
      callback(stats);
    }
  }

  public markWaiting(): void {
    this.initialized = false;
    this.failed = false;
    const stats = this.getStats();
    for (const callback of Array.from(this.statSubscribers)) {
      callback(stats);
    }
  }

  // Mirror WorkerPoolManager's init-failure state: it reverts to 'waiting' with
  // workersFailed: true rather than ever reaching 'initialized'.
  public markFailed(): void {
    this.failed = true;
    const stats = this.getStats();
    for (const callback of Array.from(this.statSubscribers)) {
      callback(stats);
    }
  }

  public getStats(): WorkerStats {
    return {
      managerState: this.initialized ? 'initialized' : 'waiting',
      workersFailed: this.failed,
      totalWorkers: 0,
      busyWorkers: 0,
      queuedTasks: 0,
      activeTasks: 0,
      themeSubscribers: 0,
      fileCacheSize: 0,
      diffCacheSize: 0,
    };
  }

  public asWorkerPoolManager(): WorkerPoolManager {
    return this as unknown as WorkerPoolManager;
  }
}

describe('CodeView worker pool readiness', () => {
  afterEach(() => {
    mock.restore();
  });

  test('waits for worker pool initialization before rendering items', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const workerManager = new FakeWorkerPoolManager();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));
      viewer.setItems([makeFileItem('file:pending-worker', 3)]);

      viewer.render(true);
      await wait(0);

      expect(viewer.getRenderedItems()).toHaveLength(0);
      expect(workerManager.statSubscriberCount).toBe(1);

      viewer.render(true);
      await wait(0);

      expect(viewer.getRenderedItems()).toHaveLength(0);
      expect(workerManager.statSubscriberCount).toBe(1);

      workerManager.markInitialized();

      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:pending-worker',
      ]);
      expect(workerManager.statSubscriberCount).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('renders via fallback when the worker pool fails after subscribing', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const workerManager = new FakeWorkerPoolManager();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));
      viewer.setItems([makeFileItem('file:failed-worker', 3)]);

      viewer.render(true);
      await wait(0);

      // Still initializing: nothing rendered yet, one readiness subscriber.
      expect(viewer.getRenderedItems()).toHaveLength(0);
      expect(workerManager.statSubscriberCount).toBe(1);

      workerManager.markFailed();

      // A failed pool must trigger fallback rendering instead of staying blank.
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:failed-worker',
      ]);
      expect(workerManager.statSubscriberCount).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('kicks initialization for a waiting pool that has not auto-started', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const workerManager = new FakeWorkerPoolManager();
    // Model a pool sitting idle in 'waiting' (e.g. after terminate()): it never
    // reaches 'initialized' unless something calls initialize().
    workerManager.enableAutoInitialize();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));
      // The empty mount already kicked initialization; model terminate()
      // discarding that startup so the pool sits idle in 'waiting' again by
      // the time the items render.
      workerManager.markWaiting();
      const initializeCallsAfterSetup = workerManager.initializeCallCount;
      viewer.setItems([makeFileItem('file:waiting-pool', 3)]);

      viewer.render(true);
      await wait(0);

      // Rendering must kick initialization rather than block forever, which
      // then drives the pool to 'initialized' and lets the item render.
      expect(workerManager.initializeCallCount).toBeGreaterThan(
        initializeCallsAfterSetup
      );
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:waiting-pool',
      ]);
      expect(workerManager.statSubscriberCount).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('renders immediately when the worker pool has already failed', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const workerManager = new FakeWorkerPoolManager();
    workerManager.markFailed();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));
      viewer.setItems([makeFileItem('file:already-failed', 3)]);

      viewer.render(true);
      await wait(0);

      // No readiness subscription is needed; render proceeds via fallback.
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:already-failed',
      ]);
      expect(workerManager.statSubscriberCount).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('a custom highlighter never gates rendering on worker readiness', async () => {
    // A custom highlighter routes every render to the main thread, so a
    // still-booting (waiting) worker pool must not hold the first paint.
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const workerManager = new FakeWorkerPoolManager();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    setHighlighter(chameleHighlighter);
    try {
      viewer.setup(createRoot({ height: 1000 }));
      viewer.setItems([makeFileItem('file:custom-ready', 3)]);

      viewer.render(true);
      await wait(0);

      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:custom-ready',
      ]);
      expect(workerManager.statSubscriberCount).toBe(0);
      expect(workerManager.initializeCallCount).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      setHighlighter(shikiHighlighter);
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an empty mount kicks initialization for a waiting pool', async () => {
    const { cleanup } = installDom();
    const workerManager = new FakeWorkerPoolManager();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));

      // Mount renders through the same readiness gate as everything else, so
      // even an empty viewer starts pool initialization immediately instead
      // of deferring startup latency to the first non-empty render.
      expect(workerManager.initializeCallCount).toBe(1);
      expect(workerManager.statSubscriberCount).toBe(1);

      workerManager.markInitialized();
      expect(workerManager.statSubscriberCount).toBe(0);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('an empty mount does not re-initialize a failed pool', async () => {
    const { cleanup } = installDom();
    const workerManager = new FakeWorkerPoolManager();
    workerManager.markFailed();
    const viewer = new CodeView(
      { disableFileHeader: true },
      workerManager.asWorkerPoolManager()
    );

    try {
      viewer.setup(createRoot({ height: 1000 }));

      // Pool failure is sticky: the readiness gate treats a failed pool as
      // ready (renderers fall back to synchronous highlighting), so mounting
      // must not restart it.
      expect(workerManager.initializeCallCount).toBe(0);
      expect(workerManager.statSubscriberCount).toBe(0);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
