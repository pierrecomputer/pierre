import { describe, expect, test } from 'bun:test';

import type {
  FileTreeBulkIngestSource,
  FileTreeDirectoryHandle,
} from '../src/index';
import {
  FILE_TREE_RENAME_VIEW,
  FileTreeController,
} from '../src/model/FileTreeController';

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

async function flushAsync(turns: number = 4): Promise<void> {
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

describe('file-tree bulk ingest', () => {
  test('bulk mode reports idle before the first ingest and seeds the path count', () => {
    const source: FileTreeBulkIngestSource = {
      openSession() {
        return Promise.resolve({
          chunks: (async function* () {})(),
          header: {},
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        source,
      },
      paths: ['preview/a.ts'],
    });

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 1,
      status: 'idle',
    });

    controller.destroy();
  });

  test('startBulkIngest applies the header before the first chunk and completes through checkpoints', async () => {
    const firstChunk = createDeferred<{ paths: readonly string[] }>();
    const source: FileTreeBulkIngestSource = {
      openSession() {
        return Promise.resolve({
          chunks: (async function* () {
            yield await firstChunk.promise;
          })(),
          header: { totalPathCount: 2 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });
    const events: Array<string> = [];
    controller.onBulkIngest('*', (event) => {
      events.push(
        `${event.type}:${event.info.ingestedPathCount}:${String(event.info.totalPathCount)}`
      );
    });

    controller.startBulkIngest();
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 0,
      status: 'ingesting',
      totalPathCount: 2,
    });

    firstChunk.resolve({ paths: ['a.ts', 'b.ts'] });
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 2,
      status: 'completed',
      totalPathCount: 2,
    });
    expect(controller.getItem('a.ts')).not.toBeNull();
    expect(events).toEqual([
      'started:0:undefined',
      'progressed:0:2',
      'progressed:2:2',
      'completed:2:2',
    ]);

    controller.destroy();
  });

  test('cancelBulkIngest retains the last published checkpoint and terminal status', async () => {
    const secondChunk = createDeferred<{ paths: readonly string[] }>();
    const source: FileTreeBulkIngestSource = {
      openSession() {
        return Promise.resolve({
          chunks: (async function* () {
            yield { paths: ['a.ts'] };
            yield await secondChunk.promise;
          })(),
          header: { totalPathCount: 2 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });

    controller.startBulkIngest();
    await flushAsync();
    controller.cancelBulkIngest();
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 1,
      status: 'cancelled',
      totalPathCount: 2,
    });
    expect(controller.getItem('a.ts')).not.toBeNull();

    controller.destroy();
  });

  test('a new ingest aborts the old session and stale chunks cannot mutate later', async () => {
    const firstChunk = createDeferred<{ paths: readonly string[] }>();
    let openCount = 0;
    let firstSessionAborted = false;
    const source: FileTreeBulkIngestSource = {
      openSession(signal) {
        openCount += 1;
        if (openCount === 1) {
          signal.addEventListener('abort', () => {
            firstSessionAborted = true;
          });
          return Promise.resolve({
            chunks: (async function* () {
              yield await firstChunk.promise;
            })(),
            header: { totalPathCount: 1 },
          });
        }

        return Promise.resolve({
          chunks: (async function* () {
            yield await Promise.resolve({ paths: ['fresh.ts'] });
          })(),
          header: { totalPathCount: 1 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });
    const eventTypes: string[] = [];
    controller.onBulkIngest('*', (event) => {
      eventTypes.push(event.type);
    });

    controller.startBulkIngest();
    await flushAsync();
    controller.startBulkIngest();
    await flushAsync();

    expect(openCount).toBe(2);
    expect(firstSessionAborted).toBe(true);

    firstChunk.resolve({ paths: ['stale.ts'] });
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 1,
      status: 'completed',
      totalPathCount: 1,
    });
    expect(controller.getItem('fresh.ts')).not.toBeNull();
    expect(controller.getItem('stale.ts')).toBeNull();
    expect(eventTypes).toContain('cancelled');

    controller.destroy();
  });

  test('destroy aborts the active ingest session immediately', async () => {
    let aborted = false;
    const source: FileTreeBulkIngestSource = {
      openSession(signal) {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return Promise.resolve({
          chunks: (async function* () {
            yield await new Promise<{ paths: readonly string[] }>(() => {});
          })(),
          header: {},
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        source,
      },
    });

    controller.startBulkIngest();
    await flushAsync();
    controller.destroy();
    await flushAsync();

    expect(aborted).toBe(true);
  });

  test('path-changing mutations cancel ingest before applying and become the next seed', async () => {
    const staleChunk = createDeferred<{ paths: readonly string[] }>();
    let openCount = 0;
    const source: FileTreeBulkIngestSource = {
      openSession() {
        openCount += 1;
        if (openCount === 1) {
          return Promise.resolve({
            chunks: (async function* () {
              yield { paths: ['streamed.ts'] };
              yield await staleChunk.promise;
            })(),
            header: { totalPathCount: 2 },
          });
        }

        return Promise.resolve({
          chunks: (async function* () {
            yield await Promise.resolve({ paths: ['tail.ts'] });
          })(),
          header: { totalPathCount: 3 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });
    const bulkEventTypes: string[] = [];
    controller.onBulkIngest('*', (event) => {
      bulkEventTypes.push(event.type);
    });

    controller.startBulkIngest();
    await flushAsync();

    controller.add('manual.ts');
    await flushAsync();
    staleChunk.resolve({ paths: ['stale.ts'] });
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 2,
      status: 'idle',
    });
    expect(controller.getItem('manual.ts')).not.toBeNull();
    expect(controller.getItem('streamed.ts')).not.toBeNull();
    expect(controller.getItem('stale.ts')).toBeNull();

    controller.startBulkIngest();
    await flushAsync();

    expect(openCount).toBe(2);
    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 3,
      status: 'completed',
      totalPathCount: 3,
    });
    expect(controller.getItem('manual.ts')).not.toBeNull();
    expect(controller.getItem('streamed.ts')).not.toBeNull();
    expect(controller.getItem('tail.ts')).not.toBeNull();
    expect(controller.getItem('stale.ts')).toBeNull();
    expect(bulkEventTypes).toContain('cancelled');

    controller.destroy();
  });

  test('checkpoint publication emits batch mutations instead of reset churn', async () => {
    const source: FileTreeBulkIngestSource = {
      openSession() {
        return Promise.resolve({
          chunks: (async function* () {
            yield await Promise.resolve({ paths: ['a.ts', 'b.ts'] });
          })(),
          header: { totalPathCount: 2 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });
    const mutationOperations: string[] = [];
    controller.onMutation('*', (event) => {
      mutationOperations.push(event.operation);
    });

    controller.startBulkIngest();
    await flushAsync();

    expect(mutationOperations).toEqual(['batch']);
    expect(mutationOperations).not.toContain('reset');

    controller.destroy();
  });

  test('failed ingests retain the last published checkpoint and retries restart from the original seed', async () => {
    let openCount = 0;
    const source: FileTreeBulkIngestSource = {
      openSession() {
        openCount += 1;
        if (openCount === 1) {
          return Promise.resolve({
            chunks: (async function* () {
              yield { paths: ['a.ts'] };
              throw new Error('boom');
            })(),
            header: { totalPathCount: 2 },
          });
        }

        return Promise.resolve({
          chunks: (async function* () {
            yield await Promise.resolve({ paths: ['b.ts'] });
          })(),
          header: { totalPathCount: 1 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
    });

    controller.startBulkIngest();
    await flushAsync();
    expect(controller.getBulkIngestInfo()).toEqual({
      errorMessage: 'boom',
      ingestedPathCount: 1,
      status: 'failed',
      totalPathCount: 2,
    });
    expect(controller.getItem('a.ts')).not.toBeNull();

    controller.startBulkIngest();
    await flushAsync();

    expect(controller.getBulkIngestInfo()).toEqual({
      ingestedPathCount: 1,
      status: 'completed',
      totalPathCount: 1,
    });
    expect(controller.getItem('a.ts')).toBeNull();
    expect(controller.getItem('b.ts')).not.toBeNull();

    controller.destroy();
  });

  test('checkpoint publication preserves expansion focus selection and rename draft when paths survive', async () => {
    const source: FileTreeBulkIngestSource = {
      openSession() {
        return Promise.resolve({
          chunks: (async function* () {
            yield await Promise.resolve({ paths: ['src/b.ts'] });
          })(),
          header: { totalPathCount: 2 },
        });
      },
    };
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'closed',
      loading: {
        mode: 'bulk',
        policy: { checkpointTimeBudgetMs: 0 },
        source,
      },
      renaming: true,
      paths: ['src/a.ts'],
    });
    const renameView = controller[FILE_TREE_RENAME_VIEW]();

    getDirectoryHandle(controller, 'src/').expand();
    controller.focusPath('src/a.ts');
    controller.selectOnlyPath('src/a.ts');
    expect(controller.startRenaming('src/a.ts')).toBe(true);
    renameView.setValue('draft.ts');

    controller.startBulkIngest();
    await flushAsync();

    expect(getDirectoryHandle(controller, 'src/').isExpanded()).toBe(true);
    expect(controller.getFocusedPath()).toBe('src/a.ts');
    expect(controller.getSelectedPaths()).toEqual(['src/a.ts']);
    expect(renameView.getPath()).toBe('src/a.ts');
    expect(renameView.getValue()).toBe('draft.ts');
    expect(controller.getItem('src/b.ts')).not.toBeNull();

    controller.destroy();
  });
});
