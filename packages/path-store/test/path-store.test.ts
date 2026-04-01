import { describe, expect, test } from 'bun:test';

import { PathStore, preparePaths } from '../src/index';

describe('preparePaths', () => {
  test('sorts directories before files and uses natural segment order', () => {
    expect(
      preparePaths(['b.txt', 'a/file.ts', 'a10.txt', 'a2.txt', 'a1.txt', 'a/'])
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
    expect(store.getVisibleSlice(0, 9).map((row) => row.path)).toEqual([
      'src/',
      'tmp/',
      'README.md',
    ]);

    store.expand('src/');
    expect(store.getVisibleCount()).toBe(5);
    expect(store.getVisibleSlice(0, 9).map((row) => row.path)).toEqual([
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

  test('supports initialExpandedPaths and keeps visible counts correct across mutation', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/', 'src/components/'],
      paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
    });

    expect(store.getVisibleSlice(0, 9).map((row) => row.path)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);

    store.move('src/components/Button.tsx', 'Button.tsx');
    expect(store.getVisibleSlice(0, 9).map((row) => row.path)).toEqual([
      'src/',
      'src/components/',
      'src/index.ts',
      'Button.tsx',
      'README.md',
    ]);

    store.collapse('src/');
    expect(store.getVisibleCount()).toBe(3);
    expect(store.getVisibleSlice(0, 9).map((row) => row.path)).toEqual([
      'src/',
      'Button.tsx',
      'README.md',
    ]);
  });
});
