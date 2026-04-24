import { describe, expect, test } from 'bun:test';

import {
  createVisibleTreeProjection,
  PathStore,
  StaticPathStore,
} from '../src/index';
import {
  assertMatchesRebuild,
  collectWildcardEvents,
  createDeepChainPaths,
  createDeepChainWithSiblingDirectoryPaths,
  createDemoSmallStore,
  createWideDirectoryPaths,
  createWideRootFilePaths,
  getVisiblePathDepthSnapshot,
  getVisiblePaths,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store visible projection', () => {
  test('reports projected depth for descendants under flattened rows', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['src/lib/index.ts'],
    });

    expect(getVisibleRowsSansIds(store, 0, 1)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'src',
            path: 'src/',
          },
          {
            isTerminal: true,
            name: 'lib',
            path: 'src/lib/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'lib',
        path: 'src/lib/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'index.ts',
        path: 'src/lib/index.ts',
      },
    ]);
  });

  test('returns visible row context with flattened ancestors and sibling metadata', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: [
        'README.md',
        'src/index.ts',
        'src/lib/a.ts',
        'src/lib/b.ts',
        'src/test/spec.ts',
      ],
    });

    const context = store.getVisibleRowContext(2);
    expect(context?.row.path).toBe('src/lib/a.ts');
    expect(context?.ancestorPaths).toEqual(['src/', 'src/lib/']);
    expect(
      context?.ancestorRows.map((ancestor) => ({
        ancestorPaths: ancestor.ancestorPaths,
        index: ancestor.index,
        path: ancestor.row.path,
        posInSet: ancestor.posInSet,
        setSize: ancestor.setSize,
        subtreeEndIndex: ancestor.subtreeEndIndex,
      }))
    ).toEqual([
      {
        ancestorPaths: [],
        index: 0,
        path: 'src/',
        posInSet: 0,
        setSize: 2,
        subtreeEndIndex: 6,
      },
      {
        ancestorPaths: ['src/'],
        index: 1,
        path: 'src/lib/',
        posInSet: 0,
        setSize: 3,
        subtreeEndIndex: 3,
      },
    ]);
    expect(context?.posInSet).toBe(0);
    expect(context?.setSize).toBe(2);
    expect(context?.subtreeEndIndex).toBe(2);
  });

  test('restores projected depth after collapsing and re-expanding a flattened row', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['src/lib/index.ts'],
    });

    store.collapse('src/lib/');
    expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'src',
            path: 'src/',
          },
          {
            isTerminal: true,
            name: 'lib',
            path: 'src/lib/',
          },
        ],
        hasChildren: true,
        isExpanded: false,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'lib',
        path: 'src/lib/',
      },
    ]);

    store.expand('src/lib/');
    expect(getVisibleRowsSansIds(store, 0, 1)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'src',
            path: 'src/',
          },
          {
            isTerminal: true,
            name: 'lib',
            path: 'src/lib/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'lib',
        path: 'src/lib/',
      },
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'index.ts',
        path: 'src/lib/index.ts',
      },
    ]);
  });

  test('supports numeric initialExpansion depth with explicit expanded overrides', () => {
    const paths = ['README.md', 'src/index.ts', 'src/lib/util.ts'];

    const store = new PathStore({
      initialExpansion: 1,
      paths,
    });

    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/lib/',
      'src/index.ts',
      'README.md',
    ]);

    const overriddenStore = new PathStore({
      initialExpansion: 1,
      initialExpandedPaths: ['src/lib/'],
      paths,
    });

    expect(getVisiblePaths(overriddenStore, 0, 9)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
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

  test('marks collapsed-subtree canonical mutations as projection-stable when visible rows do not change', () => {
    const addStore = new PathStore({
      flattenEmptyDirectories: false,
      paths: ['src/a.ts', 'src/b.ts'],
    });
    const addEvents = collectWildcardEvents(addStore);
    addStore.add('src/c.ts');
    expect(addEvents).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        operation: 'add',
        path: 'src/c.ts',
        projectionChanged: false,
        visibleCountDelta: 0,
      },
    ]);
    expect(getVisiblePaths(addStore, 0, 9)).toEqual(['src/']);

    const removeStore = new PathStore({
      flattenEmptyDirectories: false,
      paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
    const removeEvents = collectWildcardEvents(removeStore);
    removeStore.remove('src/b.ts');
    expect(removeEvents).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        operation: 'remove',
        path: 'src/b.ts',
        projectionChanged: false,
        recursive: false,
        visibleCountDelta: 0,
      },
    ]);
    expect(getVisiblePaths(removeStore, 0, 9)).toEqual(['src/']);

    const moveStore = new PathStore({
      flattenEmptyDirectories: false,
      paths: ['a/x.ts', 'a/z.ts', 'b/y.ts'],
    });
    const moveEvents = collectWildcardEvents(moveStore);
    moveStore.move('a/x.ts', 'b/');
    expect(moveEvents).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        from: 'a/x.ts',
        operation: 'move',
        projectionChanged: false,
        to: 'b/x.ts',
        visibleCountDelta: 0,
      },
    ]);
    expect(getVisiblePaths(moveStore, 0, 9)).toEqual(['a/', 'b/']);
  });

  test('returns row metadata for the current visible window and clamps slice bounds', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
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

  test('keeps sibling depths correct after traversing out of a deep expanded subtree', () => {
    const paths = createDeepChainPaths(5);
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths,
    });
    const staticStore = new StaticPathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths,
    });

    expect(
      store
        .getVisibleSlice(0, store.getVisibleCount() - 1)
        .map((row) => ({ depth: row.depth, path: row.path }))
    ).toEqual([
      { depth: 0, path: 'level1/' },
      { depth: 1, path: 'level1/level2/' },
      { depth: 2, path: 'level1/level2/level3/' },
      { depth: 3, path: 'level1/level2/level3/level4/' },
      { depth: 4, path: 'level1/level2/level3/level4/level5/' },
      { depth: 5, path: 'level1/level2/level3/level4/level5/leaf.txt' },
      { depth: 0, path: 'root.txt' },
    ]);
    expect(
      staticStore
        .getVisibleSlice(0, staticStore.getVisibleCount() - 1)
        .map((row) => ({ depth: row.depth, path: row.path }))
    ).toEqual([
      { depth: 0, path: 'level1/' },
      { depth: 1, path: 'level1/level2/' },
      { depth: 2, path: 'level1/level2/level3/' },
      { depth: 3, path: 'level1/level2/level3/level4/' },
      { depth: 4, path: 'level1/level2/level3/level4/level5/' },
      { depth: 5, path: 'level1/level2/level3/level4/level5/leaf.txt' },
      { depth: 0, path: 'root.txt' },
    ]);
  });

  test('keeps sibling directory depths correct after traversing out of a deep expanded subtree', () => {
    const paths = createDeepChainWithSiblingDirectoryPaths(5);
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths,
    });
    const staticStore = new StaticPathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths,
    });

    const expectedRows = [
      { depth: 0, path: 'level1/' },
      { depth: 1, path: 'level1/level2/' },
      { depth: 2, path: 'level1/level2/level3/' },
      { depth: 3, path: 'level1/level2/level3/level4/' },
      { depth: 4, path: 'level1/level2/level3/level4/level5/' },
      { depth: 5, path: 'level1/level2/level3/level4/level5/leaf.txt' },
      { depth: 0, path: 'sibling-folder/' },
      { depth: 1, path: 'sibling-folder/child.txt' },
      { depth: 0, path: 'root.txt' },
    ];

    expect(getVisiblePathDepthSnapshot(store)).toEqual(expectedRows);
    expect(getVisiblePathDepthSnapshot(staticStore)).toEqual(expectedRows);
  });

  test('builds visible tree projection metadata without reparsing row paths', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: createDeepChainWithSiblingDirectoryPaths(3),
    });

    expect(
      createVisibleTreeProjection(
        store.getVisibleSlice(0, store.getVisibleCount() - 1)
      ).rows
    ).toEqual([
      {
        index: 0,
        parentPath: null,
        path: 'level1/',
        posInSet: 0,
        setSize: 3,
      },
      {
        index: 1,
        parentPath: 'level1/',
        path: 'level1/level2/',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 2,
        parentPath: 'level1/level2/',
        path: 'level1/level2/level3/',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 3,
        parentPath: 'level1/level2/level3/',
        path: 'level1/level2/level3/leaf.txt',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 4,
        parentPath: null,
        path: 'sibling-folder/',
        posInSet: 1,
        setSize: 3,
      },
      {
        index: 5,
        parentPath: 'sibling-folder/',
        path: 'sibling-folder/child.txt',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 6,
        parentPath: null,
        path: 'root.txt',
        posInSet: 2,
        setSize: 3,
      },
    ]);
  });

  test('keeps sibling depths correct with flattening enabled after deep chain traversal', () => {
    const paths = createDeepChainWithSiblingDirectoryPaths(5);
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths,
    });
    const staticStore = new StaticPathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths,
    });

    const expectedRows = [
      {
        depth: 0,
        path: 'level1/level2/level3/level4/level5/',
      },
      {
        depth: 1,
        path: 'level1/level2/level3/level4/level5/leaf.txt',
      },
      {
        depth: 0,
        path: 'sibling-folder/',
      },
      {
        depth: 1,
        path: 'sibling-folder/child.txt',
      },
      {
        depth: 0,
        path: 'root.txt',
      },
    ];

    expect(getVisiblePathDepthSnapshot(store)).toEqual(expectedRows);
    expect(getVisiblePathDepthSnapshot(staticStore)).toEqual(expectedRows);
  });

  test('builds flattened visible tree projection metadata with correct sibling sets', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: createDeepChainWithSiblingDirectoryPaths(3),
    });

    expect(
      createVisibleTreeProjection(
        store.getVisibleSlice(0, store.getVisibleCount() - 1)
      ).rows
    ).toEqual([
      {
        index: 0,
        parentPath: null,
        path: 'level1/level2/level3/',
        posInSet: 0,
        setSize: 3,
      },
      {
        index: 1,
        parentPath: 'level1/level2/level3/',
        path: 'level1/level2/level3/leaf.txt',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 2,
        parentPath: null,
        path: 'sibling-folder/',
        posInSet: 1,
        setSize: 3,
      },
      {
        index: 3,
        parentPath: 'sibling-folder/',
        path: 'sibling-folder/child.txt',
        posInSet: 0,
        setSize: 1,
      },
      {
        index: 4,
        parentPath: null,
        path: 'root.txt',
        posInSet: 2,
        setSize: 3,
      },
    ]);
  });

  test('capped visible tree projection data keeps full sibling counts', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: createWideDirectoryPaths(1000),
    });

    const projection = store.getVisibleTreeProjectionData(512);

    expect(projection.paths.length).toBe(512);
    expect(projection.paths[0]).toBe('wide/');
    expect(projection.setSizeByIndex[0]).toBe(1);
    expect(projection.paths[1]).toBe('wide/item1.ts');
    expect(projection.posInSetByIndex[1]).toBe(0);
    expect(projection.setSizeByIndex[1]).toBe(1000);
    expect(projection.paths[511]).toBe('wide/item511.ts');
    expect(projection.posInSetByIndex[511]).toBe(510);
    expect(projection.setSizeByIndex[511]).toBe(1000);
  });

  test('supports visible tree projection depths beyond the initial typed-array capacity', () => {
    const depth = 80;
    const rows = Array.from({ length: depth }, (_, index) => ({
      depth: index,
      path: `${Array.from({ length: index + 1 }, (_, segmentIndex) => `level${segmentIndex + 1}`).join('/')}/`,
    }));
    rows.push({
      depth,
      path: `${Array.from({ length: depth }, (_, index) => `level${index + 1}`).join('/')}/leaf.txt`,
    });
    rows.push({
      depth: 0,
      path: 'root.txt',
    });

    const projection = createVisibleTreeProjection(rows);
    const deepLeafRow = projection.rows[depth];
    const rootSiblingRow = projection.rows[depth + 1];

    expect(deepLeafRow).toEqual({
      index: depth,
      parentPath: `${Array.from({ length: depth }, (_, index) => `level${index + 1}`).join('/')}/`,
      path: `${Array.from({ length: depth }, (_, index) => `level${index + 1}`).join('/')}/leaf.txt`,
      posInSet: 0,
      setSize: 1,
    });
    expect(rootSiblingRow).toEqual({
      index: depth + 1,
      parentPath: null,
      path: 'root.txt',
      posInSet: 1,
      setSize: 2,
    });
    expect(
      projection.rows.every(
        ({ posInSet, setSize }) =>
          Number.isFinite(posInSet) && Number.isFinite(setSize)
      )
    ).toBe(true);
    expect(projection.visibleIndexByPath.get('root.txt')).toBe(depth + 1);
  });

  test('updates visible rows immediately when adding and removing inside expanded directories', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
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
      initialExpansion: 'open',
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
      'tmp/file.ts',
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

  test('marks flatten-sensitive add and remove operations as projection changes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['a/b/c/file.ts'],
    });
    const events = collectWildcardEvents(store);

    store.add('a/b/peer.ts');
    store.remove('a/b/peer.ts');

    expect(events).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        operation: 'add',
        path: 'a/b/peer.ts',
        projectionChanged: true,
        visibleCountDelta: 2,
      },
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        canonicalChanged: true,
        operation: 'remove',
        path: 'a/b/peer.ts',
        projectionChanged: true,
        recursive: false,
        visibleCountDelta: -2,
      },
    ]);
    expect(getVisiblePaths(store, 0, 9)).toEqual(['a/b/c/', 'a/b/c/file.ts']);
  });

  test('marks collapsed flattened-chain splits and rejoins as projection changes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      paths: ['config/project/app.config.json', 'src/index.ts'],
    });
    const events = collectWildcardEvents(store);

    store.expand('config/project/');
    events.length = 0;

    store.add('config/peer.ts');
    expect(events[0]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      canonicalChanged: true,
      operation: 'add',
      path: 'config/peer.ts',
      projectionChanged: true,
      visibleCountDelta: -1,
    });
    expect(getVisiblePaths(store, 0, 9)).toEqual(['config/', 'src/']);

    store.remove('config/peer.ts');
    expect(events[1]).toEqual({
      affectedAncestorIds: expect.any(Array),
      affectedNodeIds: expect.any(Array),
      canonicalChanged: true,
      operation: 'remove',
      path: 'config/peer.ts',
      projectionChanged: true,
      recursive: false,
      visibleCountDelta: 1,
    });
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'config/project/',
      'config/project/app.config.json',
      'src/',
    ]);
  });

  test('marks moves into collapsed flattened chains as projection changes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      paths: ['config/project/app.config.json', 'tmp/peer.ts'],
    });
    const events = collectWildcardEvents(store);

    store.expand('config/project/');
    events.length = 0;

    store.move('tmp/peer.ts', 'config/');
    expect(events).toEqual([
      expect.objectContaining({
        from: 'tmp/peer.ts',
        operation: 'move',
        projectionChanged: true,
        to: 'config/peer.ts',
      }),
    ]);
    expect(getVisiblePaths(store, 0, 9)).toEqual(['config/', 'tmp/']);
  });
  test('restores exact visible rows when a collapsed folder is expanded again', () => {
    const store = createDemoSmallStore();

    expect(getVisiblePaths(store, 0, 3)).toEqual([
      'alpha/',
      'alpha/docs/',
      'alpha/docs/readme.md',
      'alpha/src/',
    ]);

    store.collapse('alpha/');
    expect(getVisiblePaths(store, 0, 3)).toEqual([
      'alpha/',
      'beta/',
      'beta/archive/',
      'beta/archive/notes.txt',
    ]);

    store.expand('alpha/');
    expect(getVisiblePaths(store, 0, 3)).toEqual([
      'alpha/',
      'alpha/docs/',
      'alpha/docs/readme.md',
      'alpha/src/',
    ]);
  });

  test('deleting a visible leaf keeps the fixed offset window consistent', () => {
    const store = createDemoSmallStore();

    expect(getVisiblePaths(store, 2, 5)).toEqual([
      'alpha/docs/readme.md',
      'alpha/src/',
      'alpha/src/utils/',
      'alpha/src/utils/math.ts',
    ]);

    store.remove('alpha/docs/readme.md');

    expect(getVisiblePaths(store, 2, 5)).toEqual([
      'alpha/src/',
      'alpha/src/utils/',
      'alpha/src/utils/math.ts',
      'alpha/src/app.ts',
    ]);
  });

  test('moving a visible leaf to its parent produces the expected visible order', () => {
    const store = createDemoSmallStore();

    store.move('alpha/docs/readme.md', 'alpha/');

    expect(getVisiblePaths(store, 0, 7)).toEqual([
      'alpha/',
      'alpha/docs/',
      'alpha/src/',
      'alpha/src/utils/',
      'alpha/src/utils/math.ts',
      'alpha/src/app.ts',
      'alpha/readme.md',
      'alpha/todo.txt',
    ]);
  });

  test('collapsing a folder above the viewport shifts the fixed offset window', () => {
    const store = createDemoSmallStore();

    expect(getVisiblePaths(store, 8, 11)).toEqual([
      'beta/',
      'beta/archive/',
      'beta/archive/notes.txt',
      'beta/keep.txt',
    ]);

    store.collapse('alpha/src/utils/');

    expect(getVisiblePaths(store, 8, 11)).toEqual([
      'beta/archive/',
      'beta/archive/notes.txt',
      'beta/keep.txt',
      'gamma/',
    ]);
  });

  test('selects middle windows correctly inside wide roots and wide directories', () => {
    const wideRootStore = new PathStore({
      initialExpansion: 'open',
      paths: createWideRootFilePaths(160),
    });
    const wideDirectoryStore = new PathStore({
      initialExpansion: 'open',
      paths: createWideDirectoryPaths(160),
    });

    expect(getVisiblePaths(wideRootStore, 95, 99)).toEqual([
      'item96.ts',
      'item97.ts',
      'item98.ts',
      'item99.ts',
      'item100.ts',
    ]);
    expect(getVisiblePaths(wideDirectoryStore, 95, 99)).toEqual([
      'wide/item95.ts',
      'wide/item96.ts',
      'wide/item97.ts',
      'wide/item98.ts',
      'wide/item99.ts',
    ]);
  });

  test('matches a rebuild after wide-directory mutations cross chunk boundaries', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: createWideDirectoryPaths(160),
    });

    store.remove('wide/item32.ts');
    store.move('wide/item97.ts', 'wide/item97-renamed.ts');
    store.add('wide/item161.ts');
    store.collapse('wide/');
    store.expand('wide/');

    expect(getVisiblePaths(store, 94, 99)).toEqual([
      'wide/item95.ts',
      'wide/item96.ts',
      'wide/item97-renamed.ts',
      'wide/item98.ts',
      'wide/item99.ts',
      'wide/item100.ts',
    ]);
    assertMatchesRebuild(store);
  });

  test('crosses the chunk threshold cleanly when adding and removing children', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: createWideDirectoryPaths(63),
    });

    expect(getVisiblePaths(store, 30, 35)).toEqual([
      'wide/item30.ts',
      'wide/item31.ts',
      'wide/item32.ts',
      'wide/item33.ts',
      'wide/item34.ts',
      'wide/item35.ts',
    ]);

    store.add('wide/item64.ts');
    expect(getVisiblePaths(store, 61, 64)).toEqual([
      'wide/item61.ts',
      'wide/item62.ts',
      'wide/item63.ts',
      'wide/item64.ts',
    ]);
    assertMatchesRebuild(store);

    store.remove('wide/item64.ts');
    expect(getVisiblePaths(store, 61, 63)).toEqual([
      'wide/item61.ts',
      'wide/item62.ts',
      'wide/item63.ts',
    ]);
    assertMatchesRebuild(store);
  });

  test('matches a rebuild after wide root mutations', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: createWideRootFilePaths(160),
    });

    store.remove('item32.ts');
    store.move('item97.ts', 'item97-renamed.ts');
    store.add('item161.ts');

    expect(getVisiblePaths(store, 94, 99)).toEqual([
      'item96.ts',
      'item97-renamed.ts',
      'item98.ts',
      'item99.ts',
      'item100.ts',
      'item101.ts',
    ]);
    assertMatchesRebuild(store);
  });

  test('matches a rebuild-from-list after mixed mutations and projection changes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: [
        'README.md',
        'src/components/Button.tsx',
        'src/components/Input.tsx',
        'src/index.ts',
        'tmp/notes.txt',
      ],
    });

    assertMatchesRebuild(store);

    store.add('src/components/Modal.tsx');
    assertMatchesRebuild(store);

    store.move('src/components/Input.tsx', 'tmp/');
    assertMatchesRebuild(store);

    store.collapse('src/components/');
    assertMatchesRebuild(store);

    store.expand('src/components/');
    assertMatchesRebuild(store);

    store.remove('tmp/notes.txt');
    assertMatchesRebuild(store);

    store.batch((batchStore) => {
      batchStore.move('src/components/', 'tmp/');
      batchStore.add('docs/');
      batchStore.add('docs/guide.md');
    });
    assertMatchesRebuild(store);
  });
});
