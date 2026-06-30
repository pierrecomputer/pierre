import { afterEach, describe, expect, mock, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import type { WorkerPoolManager, WorkerStats } from '../src/worker';
import { createRoot, installDom, makeFileItem, wait } from './domHarness';

class FakeWorkerPoolManager {
  private initialized = false;
  private failed = false;
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();

  public get statSubscriberCount(): number {
    return this.statSubscribers.size;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public isWorkingPool(): boolean {
    return false;
  }

  public initialize(): Promise<void> {
    return Promise.resolve();
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

  public markInitialized(): void {
    this.initialized = true;
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
    const consoleError = mock(() => {});
    console.error = consoleError;
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
    const consoleError = mock(() => {});
    console.error = consoleError;
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

  test('renders immediately when the worker pool has already failed', async () => {
    const { cleanup } = installDom();
    const consoleError = mock(() => {});
    console.error = consoleError;
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
});
