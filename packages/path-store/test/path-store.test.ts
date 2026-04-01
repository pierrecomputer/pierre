import { describe, expect, test } from 'bun:test';

import { PathStore } from '../src/index';

function getVisiblePaths(
  store: PathStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
): string[] {
  return store.getVisibleSlice(start, end).map((row) => row.path);
}

describe('preparePaths', () => {
  test('sorts directories before files and uses natural segment order', () => {
    expect(
      PathStore.preparePaths([
        'b.txt',
        'a/file.ts',
        'a10.txt',
        'a2.txt',
        'a1.txt',
        'a/',
      ])
    ).toEqual(['a/', 'a/file.ts', 'a1.txt', 'a2.txt', 'a10.txt', 'b.txt']);
  });
});

describe('PathStore', () => {
  test('lists canonical entries in canonical order', () => {
    const store = new PathStore({
      paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx', 'tmp/'],
    });

    expect(store.list()).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
      'tmp/',
      'README.md',
    ]);
    expect(store.list('src')).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
    ]);
    expect(store.list('tmp')).toEqual(['tmp/']);
    expect(store.list('missing')).toEqual([]);
  });

  test('round-trips canonical list output through a new store', () => {
    const store = new PathStore({
      paths: ['src/utils/index.ts', 'src/index.ts', 'tmp/'],
    });

    const rebuiltStore = new PathStore({
      paths: store.list(),
      presorted: true,
    });

    expect(rebuiltStore.list()).toEqual(store.list());
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

  test('promotes emptied directories so canonical list round-trips', () => {
    const store = new PathStore({
      paths: ['src/index.ts'],
    });

    store.remove('src/index.ts');

    expect(store.list()).toEqual(['src/']);
  });

  test('requires recursive removal for non-empty directories', () => {
    const store = new PathStore({
      paths: ['src/index.ts', 'src/components/Button.tsx'],
    });

    expect(() => store.remove('src/')).toThrow(
      'Cannot remove a non-empty directory without recursive'
    );

    store.remove('src/', { recursive: true });
    expect(store.list()).toEqual([]);
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
      paths: ['README.md', 'src/index.ts', 'tmp/'],
    });
    const operations: string[] = [];

    store.on('*', (event) => {
      operations.push(event.operation);
    });

    expect(() => store.move('README.md', 'src/index.ts')).toThrow(
      'Destination already exists'
    );

    store.batch((batchStore) => {
      batchStore.move('README.md', 'tmp/');
      batchStore.add('src/components/Button.tsx');
    });

    expect(operations).toEqual(['batch']);
    expect(store.list()).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
      'tmp/README.md',
    ]);
  });

  test('computes visible counts and slices for collapsed and expanded trees', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx', 'tmp/'],
    });

    expect(store.getVisibleCount()).toBe(3);
    expect(getVisiblePaths(store, 0, 9)).toEqual(['src/', 'tmp/', 'README.md']);

    store.expand('src/');
    expect(store.getVisibleCount()).toBe(5);
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/components/',
      'src/index.ts',
      'tmp/',
      'README.md',
    ]);

    store.expand('src/components/');
    expect(store.getVisibleCount()).toBe(6);
    expect(store.getVisibleSlice(1, 3).map((row) => row.path)).toEqual([
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
    ]);
  });

  test('returns row metadata for the current visible window and clamps slice bounds', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const rows = store.getVisibleSlice(-50, 50);

    expect(rows.map(({ id: _id, ...row }) => row)).toEqual([
      {
        depth: 0,
        hasChildren: true,
        isExpanded: true,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        name: 'src',
        path: 'src/',
      },
      {
        depth: 1,
        hasChildren: true,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'directory',
        name: 'lib',
        path: 'src/lib/',
      },
      {
        depth: 1,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'index.ts',
        path: 'src/index.ts',
      },
      {
        depth: 0,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'README.md',
        path: 'README.md',
      },
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  test('updates visible rows immediately when adding and removing inside expanded directories', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
    });

    store.add('src/components/');
    store.add('src/components/Button.tsx');

    expect(getVisiblePaths(store)).toEqual([
      'src/',
      'src/components/',
      'src/index.ts',
      'README.md',
    ]);

    store.expand('src/components/');
    expect(getVisiblePaths(store)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);

    store.remove('src/components/Button.tsx');
    expect(getVisiblePaths(store)).toEqual([
      'src/',
      'src/components/',
      'src/index.ts',
      'README.md',
    ]);
    expect(store.list()).toEqual([
      'src/components/',
      'src/index.ts',
      'README.md',
    ]);
  });

  test('continues visible slices after walking out of a nested expanded subtree', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/', 'src/components/'],
      paths: [
        'README.md',
        'src/components/Button.tsx',
        'src/index.ts',
        'tmp/file.ts',
      ],
    });

    expect(store.getVisibleSlice(1, 5).map((row) => row.path)).toEqual([
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
      'tmp/',
      'README.md',
    ]);
  });

  test('preserves expansion state when moving an expanded directory subtree', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/', 'src/components/', 'tmp/'],
      paths: ['README.md', 'src/components/Button.tsx', 'tmp/'],
    });

    store.move('src/components/', 'tmp/');

    expect(getVisiblePaths(store)).toEqual([
      'src/',
      'tmp/',
      'tmp/components/',
      'tmp/components/Button.tsx',
      'README.md',
    ]);
    expect(store.list()).toEqual([
      'src/',
      'tmp/components/Button.tsx',
      'README.md',
    ]);
  });

  test('supports initialExpandedPaths and keeps visible counts correct across mutation', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/', 'src/components/'],
      paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
    });

    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);

    store.move('src/components/Button.tsx', 'Button.tsx');
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/components/',
      'src/index.ts',
      'Button.tsx',
      'README.md',
    ]);

    store.collapse('src/');
    expect(store.getVisibleCount()).toBe(3);
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'Button.tsx',
      'README.md',
    ]);
  });

  test('supports watcher-style array batches and emits one batch event', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/'],
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
    expect(getVisiblePaths(store)).toEqual(['src/', 'src/new.ts', 'tmp/']);
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
});
