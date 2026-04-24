import { describe, expect, test } from 'bun:test';

import type {
  FileTreeDirectoryHandle,
  FileTreeRevealDirectoryBatchResult,
  FileTreeRevealDirectorySnapshot,
  FileTreeRevealLoadingSource,
} from '../src/index';
import { FileTreeController } from '../src/model/FileTreeController';

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

async function flushAsync(turns: number = 3): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Bun.sleep(0);
  }
}

function getDirectoryHandle(
  controller: FileTreeController,
  path: string
): FileTreeDirectoryHandle {
  const item = controller.getItem(path);
  if (item == null || !item.isDirectory()) {
    throw new Error(`Expected directory handle for ${path}`);
  }
  return item as FileTreeDirectoryHandle;
}

describe('file-tree reveal loading', () => {
  test('explicit expand loads an unloaded directory and applies child hints', async () => {
    const deferred = createDeferred<FileTreeRevealDirectorySnapshot>();
    const loadDirectoryCalls: string[] = [];
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories() {
        throw new Error('speculative batch should not run in this test');
      },
      async loadDirectory(path) {
        loadDirectoryCalls.push(path);
        return deferred.promise;
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        source,
      },
      paths: ['src/'],
    });
    const events: Array<string> = [];
    controller.onRevealLoading('*', (event) => {
      events.push(`${event.type}:${event.path}:${event.info.state}`);
    });

    getDirectoryHandle(controller, 'src/').expand();

    expect(loadDirectoryCalls).toEqual(['src/']);
    expect(controller.getRevealLoadingInfo('src/')).toEqual({
      path: 'src/',
      state: 'loading',
    });
    expect(events).toEqual(['started:src/:loading']);

    deferred.resolve({
      childDirectoryKnownChildCounts: [undefined, 2],
      children: ['src/index.ts', 'src/lib/'],
    });
    await flushAsync();

    expect(events).toEqual(['started:src/:loading', 'completed:src/:loaded']);
    expect(controller.getRevealLoadingInfo('src/')).toEqual({
      path: 'src/',
      state: 'loaded',
    });
    expect(controller.getRevealLoadingInfo('src/lib/')).toEqual({
      knownChildCount: 2,
      path: 'src/lib/',
      state: 'unloaded',
    });

    controller.destroy();
  });

  test('explicit expand promotes queued speculative work into a single-directory foreground load', async () => {
    const speculative =
      createDeferred<readonly FileTreeRevealDirectoryBatchResult[]>();
    const loadDirectoriesCalls: Array<readonly string[]> = [];
    const loadDirectoryCalls: string[] = [];
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories(paths) {
        loadDirectoriesCalls.push([...paths]);
        return speculative.promise;
      },
      async loadDirectory(path) {
        loadDirectoryCalls.push(path);
        return { children: [`${path}ready.ts`] };
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        policy: { maxSpeculativeBatchSize: 1 },
        source,
      },
      paths: ['alpha/', 'beta/'],
    });
    const startedPaths: string[] = [];
    controller.onRevealLoading('started', (event) => {
      startedPaths.push(event.path);
    });

    controller.getVisibleRows(0, 1);
    await flushAsync();
    expect(loadDirectoriesCalls).toEqual([['alpha/']]);

    getDirectoryHandle(controller, 'beta/').expand();
    await flushAsync();

    expect(loadDirectoryCalls).toEqual(['beta/']);
    expect(startedPaths).toEqual(['alpha/', 'beta/']);

    speculative.resolve([{ snapshot: { children: ['alpha/ready.ts'] } }]);
    await flushAsync();

    expect(loadDirectoriesCalls).toHaveLength(1);
    expect(controller.getRevealLoadingInfo('alpha/')).toEqual({
      path: 'alpha/',
      state: 'loaded',
    });
    expect(controller.getRevealLoadingInfo('beta/')).toEqual({
      path: 'beta/',
      state: 'loaded',
    });

    controller.destroy();
  });

  test('explicit expand reuses a running speculative batch without emitting a second started', async () => {
    const speculative =
      createDeferred<readonly FileTreeRevealDirectoryBatchResult[]>();
    const loadDirectoryCalls: string[] = [];
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories(_paths) {
        return speculative.promise;
      },
      async loadDirectory(path) {
        loadDirectoryCalls.push(path);
        return { children: [] };
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        source,
      },
      paths: ['alpha/', 'beta/'],
    });
    const startedPaths: string[] = [];
    controller.onRevealLoading('started', (event) => {
      startedPaths.push(event.path);
    });

    controller.getVisibleRows(0, 1);
    await flushAsync();
    getDirectoryHandle(controller, 'alpha/').expand();
    await flushAsync();

    expect(startedPaths.filter((path) => path === 'alpha/')).toHaveLength(1);
    expect(loadDirectoryCalls).toEqual([]);

    speculative.resolve([
      { snapshot: { children: ['alpha/a.ts'] } },
      { snapshot: { children: ['beta/b.ts'] } },
    ]);
    await flushAsync();

    expect(controller.getRevealLoadingInfo('alpha/')).toEqual({
      path: 'alpha/',
      state: 'loaded',
    });
    expect(controller.getRevealLoadingInfo('beta/')).toEqual({
      path: 'beta/',
      state: 'loaded',
    });

    controller.destroy();
  });

  test('obsolete speculative batches emit cancelled before an explicit retry completes', async () => {
    const alphaSpeculative =
      createDeferred<readonly FileTreeRevealDirectoryBatchResult[]>();
    const betaSpeculative =
      createDeferred<readonly FileTreeRevealDirectoryBatchResult[]>();
    const loadDirectoriesCalls: Array<readonly string[]> = [];
    const loadDirectoryCalls: string[] = [];
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories(paths) {
        loadDirectoriesCalls.push([...paths]);
        return loadDirectoriesCalls.length === 1
          ? alphaSpeculative.promise
          : betaSpeculative.promise;
      },
      async loadDirectory(path) {
        loadDirectoryCalls.push(path);
        return { children: [`${path}retry.ts`] };
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        policy: {
          maxSpeculativeBatchSize: 1,
          maxSpeculativeInflightRequests: 1,
        },
        source,
      },
      paths: ['alpha/', 'beta/'],
    });
    const events: string[] = [];
    controller.onRevealLoading('*', (event) => {
      events.push(`${event.type}:${event.path}:${event.info.state}`);
    });

    controller.getVisibleRows(0, 0);
    await flushAsync();
    controller.getVisibleRows(1, 1);
    await flushAsync();

    expect(loadDirectoriesCalls).toEqual([['alpha/'], ['beta/']]);
    expect(events).toEqual([
      'started:alpha/:loading',
      'cancelled:alpha/:unloaded',
      'started:beta/:loading',
    ]);
    expect(controller.getRevealLoadingInfo('alpha/')).toEqual({
      path: 'alpha/',
      state: 'unloaded',
    });

    getDirectoryHandle(controller, 'alpha/').expand();
    await flushAsync();

    expect(loadDirectoryCalls).toEqual(['alpha/']);
    expect(events).toEqual([
      'started:alpha/:loading',
      'cancelled:alpha/:unloaded',
      'started:beta/:loading',
      'started:alpha/:loading',
      'completed:alpha/:loaded',
    ]);

    betaSpeculative.resolve([{ snapshot: { children: ['beta/ready.ts'] } }]);
    await flushAsync();

    expect(controller.getRevealLoadingInfo('beta/')).toEqual({
      path: 'beta/',
      state: 'loaded',
    });
    controller.destroy();
  });

  test('destroy emits cancelled for in-flight explicit loads', async () => {
    const deferred = createDeferred<FileTreeRevealDirectorySnapshot>();
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories() {
        throw new Error('speculative batch should not run in this test');
      },
      async loadDirectory() {
        return deferred.promise;
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        source,
      },
      paths: ['src/'],
    });
    const events: string[] = [];
    controller.onRevealLoading('*', (event) => {
      events.push(`${event.type}:${event.path}:${event.info.state}`);
    });

    getDirectoryHandle(controller, 'src/').expand();
    controller.destroy();
    await flushAsync();

    expect(events).toEqual(['started:src/:loading', 'cancelled:src/:unloaded']);
  });

  test('failed reused speculative work retries immediately through the foreground loader', async () => {
    const speculative =
      createDeferred<readonly FileTreeRevealDirectoryBatchResult[]>();
    const loadDirectoryCalls: string[] = [];
    const source: FileTreeRevealLoadingSource = {
      async loadDirectories() {
        return speculative.promise;
      },
      async loadDirectory(path) {
        loadDirectoryCalls.push(path);
        return { children: [`${path}retry.ts`] };
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      loading: {
        mode: 'reveal',
        source,
      },
      paths: ['alpha/'],
    });
    const events: string[] = [];
    controller.onRevealLoading('*', (event) => {
      events.push(`${event.type}:${event.path}:${event.info.state}`);
    });

    controller.getVisibleRows(0, 0);
    await flushAsync();
    getDirectoryHandle(controller, 'alpha/').expand();
    speculative.resolve([{ errorMessage: 'boom' }]);
    await flushAsync();

    expect(loadDirectoryCalls).toEqual(['alpha/']);
    expect(events).toEqual([
      'started:alpha/:loading',
      'failed:alpha/:error',
      'started:alpha/:loading',
      'completed:alpha/:loaded',
    ]);
    expect(controller.getRevealLoadingInfo('alpha/')).toEqual({
      path: 'alpha/',
      state: 'loaded',
    });

    controller.destroy();
  });

  test('custom sort resorts async children locally and warns only once', async () => {
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnCalls.push(String(message));
    };

    try {
      const source: FileTreeRevealLoadingSource = {
        async loadDirectories() {
          throw new Error('speculative batch should not run in this test');
        },
        async loadDirectory(path) {
          return {
            children: [`${path}a.ts`, `${path}b.ts`],
          };
        },
      };
      const controller = new FileTreeController({
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        loading: {
          mode: 'reveal',
          source,
        },
        paths: ['alpha/', 'beta/'],
        sort: (left, right) => right.basename.localeCompare(left.basename),
      });

      getDirectoryHandle(controller, 'alpha/').expand();
      await flushAsync();
      getDirectoryHandle(controller, 'beta/').expand();
      await flushAsync();

      expect(warnCalls).toHaveLength(1);
      const visiblePaths = controller
        .getVisibleRows(0, 5)
        .map((row) => row.path);
      expect(visiblePaths).toEqual([
        'beta/',
        'beta/b.ts',
        'beta/a.ts',
        'alpha/',
        'alpha/b.ts',
        'alpha/a.ts',
      ]);

      controller.destroy();
    } finally {
      console.warn = originalWarn;
    }
  });
});
