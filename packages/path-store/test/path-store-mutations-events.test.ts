import { describe, expect, test } from 'bun:test';

import { PathStore } from '../src/index';
import {
  assertMatchesRebuild,
  collectWildcardEvents,
  getVisiblePaths,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store mutations and events', () => {
  test('keeps closed-default semantics for directories added after all startup directories were expanded', () => {
    const preparedInput = PathStore.preparePresortedInput(['src/a.ts']);
    const store = new PathStore({
      initialExpandedPaths: ['src/'],
      preparedInput,
    });

    expect(getVisiblePaths(store, 0, 10)).toEqual(['src/', 'src/a.ts']);

    store.add('new-dir/file.ts');

    expect(getVisiblePaths(store, 0, 10)).toEqual([
      'new-dir/',
      'src/',
      'src/a.ts',
    ]);
    expect(store.getVisibleSlice(0, 0)[0]?.isExpanded).toBe(false);
  });

  test('adds files and explicit directories into canonical order', () => {
    const store = new PathStore({
      paths: ['README.md', 'src/index.ts'],
    });

    store.add('src/components/');
    store.add('src/components/Button.tsx');

    expect(store.list()).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);
    expect(store.list('src/components')).toEqual(['src/components/Button.tsx']);
  });

  test('rejects duplicate additions', () => {
    const store = new PathStore({
      paths: ['src/index.ts'],
    });

    expect(() => store.add('src/index.ts')).toThrow(
      'Path already exists: "src/index.ts"'
    );
  });

  test('moves entries using mv-style destination-directory semantics', () => {
    const store = new PathStore({
      paths: ['README.md', 'src/index.ts', 'tmp/'],
    });

    store.move('README.md', 'tmp/');
    expect(store.list()).toEqual(['src/index.ts', 'tmp/README.md']);
  });

  test('throws on collisions by default and can batch operations into one event', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'tmp/'],
    });
    const events = collectWildcardEvents(store);

    expect(() => store.move('README.md', 'src/index.ts')).toThrow(
      'Destination already exists'
    );

    store.batch((batchStore) => {
      batchStore.move('README.md', 'tmp/');
      batchStore.add('src/components/Button.tsx');
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      canonicalChanged: true,
      operation: 'batch',
      projectionChanged: true,
      visibleCountDelta: 2,
    });
    expect(events[0]?.operation === 'batch' ? events[0].events : []).toEqual([
      expect.objectContaining({
        from: 'README.md',
        operation: 'move',
        to: 'tmp/README.md',
        visibleCountDelta: 0,
      }),
      expect.objectContaining({
        operation: 'add',
        path: 'src/components/Button.tsx',
        visibleCountDelta: 2,
      }),
    ]);
    expect(store.list()).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
      'tmp/README.md',
    ]);
  });

  test('supports nested batches and emits one top-level batch event', () => {
    const store = new PathStore({
      paths: ['src/old.ts', 'tmp/'],
    });
    const events = collectWildcardEvents(store);

    store.batch(() => {
      store.batch(() => {
        store.move('src/old.ts', 'tmp/');
      });
      store.add('src/new.ts');
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.operation).toBe('batch');
    expect(events[0]?.visibleCountDelta).toBe(0);
    expect(events[0]?.operation === 'batch' ? events[0].events : []).toEqual([
      expect.objectContaining({
        from: 'src/old.ts',
        operation: 'move',
        to: 'tmp/old.ts',
      }),
      expect.objectContaining({
        operation: 'add',
        path: 'src/new.ts',
      }),
    ]);
    expect(store.list()).toEqual(['src/new.ts', 'tmp/old.ts']);
  });

  test('emits expand and collapse events with typed invalidation metadata', () => {
    const store = new PathStore({
      paths: ['src/index.ts', 'src/components/Button.tsx'],
    });
    const events = collectWildcardEvents(store);

    store.expand('src/');
    store.collapse('src/');

    expect(events).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: false,
        operation: 'expand',
        path: 'src/',
        projectionChanged: true,
        visibleCountDelta: 2,
      },
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: false,
        operation: 'collapse',
        path: 'src/',
        projectionChanged: true,
        visibleCountDelta: -2,
      },
    ]);
    expect(events[0]?.affectedNodeIds).toHaveLength(1);
    expect(events[1]?.affectedNodeIds).toHaveLength(1);
  });

  test('emits add, remove, and move events with typed semantic fields', () => {
    const addStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/index.ts'],
    });
    const addEvents = collectWildcardEvents(addStore);
    addStore.add('src/components/Button.tsx');
    expect(addEvents).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        operation: 'add',
        path: 'src/components/Button.tsx',
        projectionChanged: true,
        visibleCountDelta: 2,
      },
    ]);

    const removeStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/components/Button.tsx', 'src/index.ts'],
    });
    const removeEvents = collectWildcardEvents(removeStore);
    removeStore.remove('src/components/Button.tsx');
    expect(removeEvents).toHaveLength(1);
    expect(removeEvents[0]).toMatchObject({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      canonicalChanged: true,
      operation: 'remove',
      path: 'src/components/Button.tsx',
      projectionChanged: true,
      recursive: false,
      visibleCountDelta: -1,
    });

    const moveStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/components/Button.tsx', 'src/index.ts', 'tmp/'],
    });
    const moveEvents = collectWildcardEvents(moveStore);
    moveStore.move('src/components/', 'tmp/');
    expect(moveEvents).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        from: 'src/components/',
        operation: 'move',
        projectionChanged: true,
        to: 'tmp/components/',
        visibleCountDelta: 0,
      },
    ]);
  });

  test('delivers operation listeners before wildcard listeners synchronously', () => {
    const store = new PathStore({
      paths: ['src/index.ts'],
    });
    const callOrder: string[] = [];

    store.on('add', (event) => {
      if (event.operation !== 'add') {
        return;
      }
      callOrder.push(`specific:${event.operation}:${event.path}`);
    });
    store.on('*', (event) => {
      callOrder.push(`wildcard:${event.operation}`);
    });

    store.add('src/new.ts');

    expect(callOrder).toEqual(['specific:add:src/new.ts', 'wildcard:add']);
  });

  test('supports unsubscribing listeners', () => {
    const store = new PathStore({
      paths: ['src/index.ts'],
    });
    const operations: string[] = [];

    const unsubscribe = store.on('*', (event) => {
      operations.push(event.operation);
    });

    store.add('src/first.ts');
    unsubscribe();
    store.add('src/second.ts');

    expect(operations).toEqual(['add']);
  });

  test('propagates listener errors after committing the mutation and stops later listeners', () => {
    const store = new PathStore({
      paths: ['src/index.ts'],
    });
    const callOrder: string[] = [];

    store.on('add', () => {
      callOrder.push('specific');
      throw new Error('listener boom');
    });
    store.on('*', () => {
      callOrder.push('wildcard');
    });

    expect(() => store.add('src/new.ts')).toThrow('listener boom');
    expect(callOrder).toEqual(['specific']);
    expect(store.list()).toEqual(['src/index.ts', 'src/new.ts']);
  });

  test('delivers batch commit listeners synchronously after child mutations are committed', () => {
    const store = new PathStore({
      paths: ['src/old.ts', 'tmp/'],
    });
    const callOrder: string[] = [];

    store.on('batch', (event) => {
      if (event.operation !== 'batch') {
        return;
      }
      callOrder.push(
        `specific:${event.operation}:${event.events
          .map((childEvent) => childEvent.operation)
          .join(',')}`
      );
      expect(store.list()).toEqual(['src/new.ts', 'tmp/old.ts']);
    });
    store.on('*', (event) => {
      callOrder.push(`wildcard:${event.operation}`);
    });

    store.batch(() => {
      store.move('src/old.ts', 'tmp/');
      store.add('src/new.ts');
    });

    expect(callOrder).toEqual(['specific:batch:move,add', 'wildcard:batch']);
  });

  test('keeps sibling positions correct after removing one child and moving another', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });

    store.remove('src/b.ts');
    store.move('src/c.ts', 'c.ts');

    expect(getVisiblePaths(store, 0, 9)).toEqual(['src/', 'src/a.ts', 'c.ts']);
    expect(store.list()).toEqual(['src/a.ts', 'c.ts']);
  });

  test('supports watcher-style array batches and emits one batch event', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
      paths: ['src/keep.ts', 'src/old.ts', 'tmp/'],
    });
    const events: string[] = [];

    store.on('*', (event) => {
      events.push(event.operation);
    });

    store.batch([
      { from: 'src/old.ts', to: 'tmp/', type: 'move' },
      { path: 'src/new.ts', type: 'add' },
      { path: 'src/keep.ts', type: 'remove' },
    ]);

    expect(events).toEqual(['batch']);
    expect(getVisiblePaths(store)).toEqual([
      'src/',
      'src/new.ts',
      'tmp/',
      'tmp/old.ts',
    ]);
    expect(store.list()).toEqual(['src/new.ts', 'tmp/old.ts']);
  });

  test('supports skip and replace collision strategies for file moves', () => {
    const store = new PathStore({
      paths: ['a.ts', 'b.ts'],
    });
    const events: string[] = [];

    store.on('*', (event) => {
      events.push(event.operation);
    });

    store.move('a.ts', 'b.ts', { collision: 'skip' });
    expect(events).toEqual([]);
    expect(store.list()).toEqual(['a.ts', 'b.ts']);
    expect(store.getNodeCount()).toBe(2);

    store.move('a.ts', 'b.ts', { collision: 'replace' });
    expect(events).toEqual(['move']);
    expect(store.list()).toEqual(['b.ts']);
    expect(store.getNodeCount()).toBe(1);
  });

  test('applies custom sort comparators to canonical listings and mutations', () => {
    const sort = (
      left: { basename: string; isDirectory: boolean },
      right: { basename: string; isDirectory: boolean }
    ) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? 1 : -1;
      }

      return right.basename.localeCompare(left.basename);
    };
    const store = new PathStore({
      paths: ['b.ts', 'a.ts', 'dir/index.ts'],
      sort,
    });

    store.add('z.ts');

    expect(store.list()).toEqual(['z.ts', 'dir/index.ts', 'b.ts', 'a.ts']);
  });

  test('splits and rejoins flattened chains when siblings are added and removed', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['a/b/c/file.ts'],
    });
    const events = collectWildcardEvents(store);

    expect(getVisibleRowsSansIds(store, 0, 9)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'a',
            path: 'a/',
          },
          {
            isTerminal: false,
            name: 'b',
            path: 'a/b/',
          },
          {
            isTerminal: true,
            name: 'c',
            path: 'a/b/c/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'c',
        path: 'a/b/c/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'file.ts',
        path: 'a/b/c/file.ts',
      },
    ]);
    assertMatchesRebuild(store, { flattenEmptyDirectories: true });

    store.add('a/b/peer.ts');
    expect(getVisibleRowsSansIds(store, 0, 9)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'a',
            path: 'a/',
          },
          {
            isTerminal: true,
            name: 'b',
            path: 'a/b/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'b',
        path: 'a/b/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: true,
        isExpanded: true,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        name: 'c',
        path: 'a/b/c/',
      },
      {
        depth: 2,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'file.ts',
        path: 'a/b/c/file.ts',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'peer.ts',
        path: 'a/b/peer.ts',
      },
    ]);
    assertMatchesRebuild(store, { flattenEmptyDirectories: true });
    expect(events[0]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      canonicalChanged: true,
      operation: 'add',
      path: 'a/b/peer.ts',
      projectionChanged: true,
      visibleCountDelta: 2,
    });

    store.remove('a/b/peer.ts');
    expect(getVisibleRowsSansIds(store, 0, 9)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'a',
            path: 'a/',
          },
          {
            isTerminal: false,
            name: 'b',
            path: 'a/b/',
          },
          {
            isTerminal: true,
            name: 'c',
            path: 'a/b/c/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'c',
        path: 'a/b/c/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'file.ts',
        path: 'a/b/c/file.ts',
      },
    ]);
    assertMatchesRebuild(store, { flattenEmptyDirectories: true });
    expect(events[1]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      canonicalChanged: true,
      operation: 'remove',
      path: 'a/b/peer.ts',
      projectionChanged: true,
      recursive: false,
      visibleCountDelta: -2,
    });
  });
});
