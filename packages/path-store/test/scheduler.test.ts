import { describe, expect, test } from 'bun:test';

import { createPathStoreScheduler, PathStore } from '../src/index';

function createDeferred<TValue>() {
  let resolvePromise!: (value: TValue) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

describe('PathStoreScheduler', () => {
  test('drains queued work in caller-supplied priority order and yields across slices', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a/', 'b/', 'c/'],
    });
    store.markDirectoryUnloaded('a/');
    store.markDirectoryUnloaded('b/');
    store.markDirectoryUnloaded('c/');

    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });
    const startedPaths: string[] = [];

    scheduler.enqueue({
      createPatch() {
        startedPaths.push('a/');
        return { operations: [{ path: 'a/file-a.ts', type: 'add' }] };
      },
      path: 'a/',
      priority: 10,
    });
    scheduler.enqueue({
      createPatch() {
        startedPaths.push('b/');
        return { operations: [{ path: 'b/file-b.ts', type: 'add' }] };
      },
      path: 'b/',
      priority: 30,
    });
    scheduler.enqueue({
      createPatch() {
        startedPaths.push('c/');
        return { operations: [{ path: 'c/file-c.ts', type: 'add' }] };
      },
      path: 'c/',
      priority: 20,
    });

    await scheduler.whenIdle();

    expect(startedPaths).toEqual(['b/', 'c/', 'a/']);
    expect(store.list()).toEqual(['a/file-a.ts', 'b/file-b.ts', 'c/file-c.ts']);
    expect(scheduler.getMetrics().yieldCount).toBeGreaterThan(1);
  });

  test('dedupes same-directory enqueues and runs only one task', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });
    store.markDirectoryUnloaded('src/');

    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });
    let runCount = 0;

    const firstResult = scheduler.enqueue({
      createPatch() {
        runCount += 1;
        return { operations: [{ path: 'src/file.ts', type: 'add' }] };
      },
      path: 'src/',
      priority: 10,
    });
    const secondResult = scheduler.enqueue({
      createPatch() {
        runCount += 1;
        return { operations: [{ path: 'src/other.ts', type: 'add' }] };
      },
      path: 'src/',
      priority: 50,
    });

    expect(firstResult.status).toBe('queued');
    expect(secondResult.status).toBe('reused');
    expect(
      firstResult.status !== 'rejected' && secondResult.status !== 'rejected'
        ? secondResult.handle.id
        : null
    ).toBe(firstResult.status !== 'rejected' ? firstResult.handle.id : null);

    await scheduler.whenIdle();

    expect(runCount).toBe(1);
    expect(store.list()).toEqual(['src/file.ts']);
  });

  test('cancels queued work before it starts without mutating the store', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a/', 'b/'],
    });
    store.markDirectoryUnloaded('a/');
    store.markDirectoryUnloaded('b/');

    const firstDeferred = createDeferred<{
      operations: { path: string; type: 'add' }[];
    }>();
    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });

    const first = scheduler.enqueue({
      createPatch() {
        return firstDeferred.promise;
      },
      path: 'a/',
      priority: 20,
    });
    const second = scheduler.enqueue({
      createPatch() {
        return { operations: [{ path: 'b/file.ts', type: 'add' }] };
      },
      path: 'b/',
      priority: 10,
    });

    expect(second.status).toBe('queued');
    if (second.status !== 'rejected') {
      expect(scheduler.cancel(second.handle)).toBe(true);
      firstDeferred.resolve({
        operations: [{ path: 'a/file.ts', type: 'add' }],
      });
      await scheduler.whenIdle();

      expect(await second.handle.result).toEqual({
        path: 'b/',
        status: 'cancelled',
      });
    }

    expect(store.list()).toEqual(['a/file.ts', 'b/']);
    expect(scheduler.getMetrics().cancelledTaskCount).toBe(1);
    expect(first.status).toBe('queued');
  });

  test('honors external AbortSignal cancellation for queued work', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a/', 'b/'],
    });
    store.markDirectoryUnloaded('a/');
    store.markDirectoryUnloaded('b/');

    const firstDeferred = createDeferred<{
      operations: { path: string; type: 'add' }[];
    }>();
    const secondAbortController = new AbortController();
    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });

    const first = scheduler.enqueue({
      createPatch() {
        return firstDeferred.promise;
      },
      path: 'a/',
      priority: 20,
    });
    const second = scheduler.enqueue({
      createPatch() {
        return { operations: [{ path: 'b/file.ts', type: 'add' }] };
      },
      path: 'b/',
      priority: 10,
      signal: secondAbortController.signal,
    });

    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');

    secondAbortController.abort();
    firstDeferred.resolve({
      operations: [{ path: 'a/file.ts', type: 'add' }],
    });
    await scheduler.whenIdle();

    if (second.status !== 'rejected') {
      expect(await second.handle.result).toEqual({
        path: 'b/',
        status: 'cancelled',
      });
    }

    expect(store.list()).toEqual(['a/file.ts', 'b/']);
    expect(scheduler.getMetrics().cancelledTaskCount).toBe(1);
  });

  test('cancels running work by failing the active load attempt with cancelled', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });
    store.markDirectoryUnloaded('src/');

    const deferred = createDeferred<{
      operations: { path: string; type: 'add' }[];
    }>();
    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });
    const enqueueResult = scheduler.enqueue({
      createPatch() {
        return deferred.promise;
      },
      path: 'src/',
      priority: 10,
    });

    if (enqueueResult.status === 'rejected') {
      throw new Error('Scheduler rejected a test task unexpectedly.');
    }

    while (enqueueResult.handle.status() !== 'running') {
      await Bun.sleep(0);
    }

    expect(scheduler.cancel(enqueueResult.handle)).toBe(true);
    deferred.resolve({ operations: [{ path: 'src/file.ts', type: 'add' }] });
    await scheduler.whenIdle();

    expect(await enqueueResult.handle.result).toEqual({
      path: 'src/',
      status: 'cancelled',
    });
    expect(store.list()).toEqual(['src/']);
    expect(store.getDirectoryLoadState('src/')).toBe('error');
  });

  test('rejects overflow explicitly without dropping queued work', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a/', 'b/', 'c/'],
    });
    store.markDirectoryUnloaded('a/');
    store.markDirectoryUnloaded('b/');
    store.markDirectoryUnloaded('c/');

    const deferred = createDeferred<{
      operations: { path: string; type: 'add' }[];
    }>();
    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxQueueSize: 2,
      maxTasksPerSlice: 1,
      store,
    });

    const first = scheduler.enqueue({
      createPatch() {
        return deferred.promise;
      },
      path: 'a/',
      priority: 30,
    });
    const second = scheduler.enqueue({
      createPatch() {
        return { operations: [{ path: 'b/file.ts', type: 'add' }] };
      },
      path: 'b/',
      priority: 20,
    });
    const third = scheduler.enqueue({
      createPatch() {
        return { operations: [{ path: 'c/file.ts', type: 'add' }] };
      },
      path: 'c/',
      priority: 10,
    });

    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    expect(third).toEqual({
      reason: 'queue-overflow',
      status: 'rejected',
    });

    deferred.resolve({ operations: [{ path: 'a/file.ts', type: 'add' }] });
    await scheduler.whenIdle();

    expect(store.list()).toEqual(['a/file.ts', 'b/file.ts', 'c/']);
    expect(scheduler.getMetrics().rejectedTaskCount).toBe(1);
  });

  test('dispose cancels queued work and prevents future execution', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['a/', 'b/'],
    });
    store.markDirectoryUnloaded('a/');
    store.markDirectoryUnloaded('b/');

    const deferred = createDeferred<{
      operations: { path: string; type: 'add' }[];
    }>();
    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });

    scheduler.enqueue({
      createPatch() {
        return deferred.promise;
      },
      path: 'a/',
      priority: 20,
    });
    const second = scheduler.enqueue({
      createPatch() {
        return { operations: [{ path: 'b/file.ts', type: 'add' }] };
      },
      path: 'b/',
      priority: 10,
    });

    expect(second.status).toBe('queued');
    scheduler.dispose();
    deferred.resolve({ operations: [{ path: 'a/file.ts', type: 'add' }] });
    await scheduler.whenIdle();

    if (second.status !== 'rejected') {
      expect(await second.handle.result).toEqual({
        path: 'b/',
        status: 'cancelled',
      });
    }

    expect(
      scheduler.enqueue({
        createPatch() {
          return { operations: [{ path: 'a/late.ts', type: 'add' }] };
        },
        path: 'a/',
        priority: 1,
      })
    ).toEqual({
      reason: 'disposed',
      status: 'rejected',
    });
  });

  test('dispose lets whenIdle resolve even if the running task never resolves', async () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/'],
    });
    store.markDirectoryUnloaded('src/');

    const scheduler = createPathStoreScheduler({
      chunkBudgetMs: 0,
      maxTasksPerSlice: 1,
      store,
    });
    const enqueueResult = scheduler.enqueue({
      createPatch() {
        return new Promise<{ operations: { path: string; type: 'add' }[] }>(
          () => {}
        );
      },
      path: 'src/',
      priority: 10,
    });

    if (enqueueResult.status === 'rejected') {
      throw new Error('Scheduler rejected a test task unexpectedly.');
    }

    while (enqueueResult.handle.status() !== 'running') {
      await Bun.sleep(0);
    }

    scheduler.dispose();

    expect(
      await Promise.race([
        scheduler.whenIdle().then(() => 'idle'),
        Bun.sleep(50).then(() => 'timeout'),
      ])
    ).toBe('idle');
    expect(await enqueueResult.handle.result).toEqual({
      path: 'src/',
      status: 'cancelled',
    });
    expect(store.list()).toEqual(['src/']);
    expect(store.getDirectoryLoadState('src/')).toBe('error');
  });
});
