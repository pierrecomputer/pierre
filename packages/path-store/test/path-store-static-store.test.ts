import { describe, expect, test } from 'bun:test';

import { PathStore, StaticPathStore } from '../src/index';
import {
  createDemoSmallStore,
  createStaticDemoSmallStore,
  createWideDirectoryPaths,
  demoSmallPaths,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store static store', () => {
  test('static store matches mutable canonical and visible reads for the same input', () => {
    const mutableStore = createDemoSmallStore();
    const staticStore = createStaticDemoSmallStore();

    expect(staticStore.list()).toEqual(mutableStore.list());
    expect(staticStore.list('alpha/src/')).toEqual(
      mutableStore.list('alpha/src/')
    );
    expect(staticStore.getVisibleCount()).toBe(mutableStore.getVisibleCount());
    expect(getVisibleRowsSansIds(staticStore, 0, 20)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 20)
    );
  });

  test('static store stays projection-compatible after expand and collapse', () => {
    const mutableStore = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 1,
      paths: ['a/b/c/file.ts', 'a/b/peer.ts', 'src/index.ts'],
    });
    const staticStore = new StaticPathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 1,
      paths: ['a/b/c/file.ts', 'a/b/peer.ts', 'src/index.ts'],
    });

    expect(getVisibleRowsSansIds(staticStore, 0, 20)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 20)
    );

    mutableStore.collapse('a/');
    staticStore.collapse('a/');
    expect(getVisibleRowsSansIds(staticStore, 0, 20)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 20)
    );

    mutableStore.expand('a/');
    staticStore.expand('a/');
    expect(getVisibleRowsSansIds(staticStore, 0, 20)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 20)
    );
  });

  test('static store honors initialExpandedPaths on top of default closed expansion', () => {
    const mutableStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['alpha/', 'alpha/src/'],
      initialExpansion: 'closed',
      paths: demoSmallPaths,
    });
    const staticStore = new StaticPathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['alpha/', 'alpha/src/'],
      initialExpansion: 'closed',
      paths: demoSmallPaths,
    });

    expect(staticStore.getVisibleCount()).toBe(mutableStore.getVisibleCount());
    expect(getVisibleRowsSansIds(staticStore, 0, 20)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 20)
    );
  });

  test('static store exposes no topology mutation methods', () => {
    const staticStore = createStaticDemoSmallStore();

    expect(typeof staticStore.list).toBe('function');
    expect(typeof staticStore.getVisibleCount).toBe('function');
    expect(typeof staticStore.getVisibleSlice).toBe('function');
    expect(typeof staticStore.expand).toBe('function');
    expect(typeof staticStore.collapse).toBe('function');
    expect('add' in (staticStore as object)).toBe(false);
    expect('remove' in (staticStore as object)).toBe(false);
    expect('move' in (staticStore as object)).toBe(false);
    expect('batch' in (staticStore as object)).toBe(false);
    expect('cleanup' in (staticStore as object)).toBe(false);
    expect('on' in (staticStore as object)).toBe(false);
  });

  test('static store matches mutable wide-directory visible windows after collapse and re-expand', () => {
    const paths = createWideDirectoryPaths(160);
    const mutableStore = new PathStore({
      initialExpansion: 'open',
      paths,
    });
    const staticStore = new StaticPathStore({
      initialExpansion: 'open',
      paths,
    });

    expect(staticStore.getVisibleCount()).toBe(mutableStore.getVisibleCount());
    expect(getVisibleRowsSansIds(staticStore, 95, 99)).toEqual(
      getVisibleRowsSansIds(mutableStore, 95, 99)
    );

    mutableStore.collapse('wide/');
    staticStore.collapse('wide/');
    expect(getVisibleRowsSansIds(staticStore, 0, 1)).toEqual(
      getVisibleRowsSansIds(mutableStore, 0, 1)
    );

    mutableStore.expand('wide/');
    staticStore.expand('wide/');
    expect(getVisibleRowsSansIds(staticStore, 95, 99)).toEqual(
      getVisibleRowsSansIds(mutableStore, 95, 99)
    );
  });
});
