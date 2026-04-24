import {
  getVirtualizationWorkload,
  sortCanonicalPaths,
} from '@pierre/tree-test-data';
import { describe, expect, test } from 'bun:test';

import { PathStore, StaticPathStore } from '../src/index';
import {
  createDeepChainPaths,
  createDeepChainWithSiblingDirectoryPaths,
  demoSmallPaths,
  getVisiblePathDepthSnapshot,
  getVisiblePathDepthSnapshotViaSingleReads,
  getVisiblePaths,
  getVisibleRowsSansIds,
} from './helpers/storeHarness';

describe('path-store ingest and basics', () => {
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

  test('supports custom sort comparators', () => {
    const sort = (
      left: { basename: string; isDirectory: boolean },
      right: { basename: string; isDirectory: boolean }
    ) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? 1 : -1;
      }

      return right.basename.localeCompare(left.basename);
    };

    expect(
      PathStore.preparePaths(['b.ts', 'a.ts', 'dir/'], {
        sort,
      })
    ).toEqual(['b.ts', 'a.ts', 'dir/']);
  });
  test('returns presorted string paths and builds without reparsing raw unsorted input', () => {
    const preparedInput = PathStore.prepareInput([
      'b.txt',
      'a/file.ts',
      'a10.txt',
      'a2.txt',
      'a1.txt',
      'a/',
    ]);

    expect(preparedInput.paths).toEqual([
      'a/',
      'a/file.ts',
      'a1.txt',
      'a2.txt',
      'a10.txt',
      'b.txt',
    ]);

    const store = new PathStore({
      preparedInput,
    });

    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'a/',
      'a1.txt',
      'a2.txt',
      'a10.txt',
      'b.txt',
    ]);
    expect(store.list()).toEqual([
      'a/file.ts',
      'a1.txt',
      'a2.txt',
      'a10.txt',
      'b.txt',
    ]);
  });

  test('prepares already sorted string paths without changing their order', () => {
    const presortedPaths = ['a/', 'a/file.ts', 'a1.txt', 'a2.txt', 'a10.txt'];
    const preparedInput = PathStore.preparePresortedInput(presortedPaths);

    expect(preparedInput.paths).toEqual(presortedPaths);

    const store = new PathStore({
      preparedInput,
    });

    expect(store.list()).toEqual(['a/file.ts', 'a1.txt', 'a2.txt', 'a10.txt']);
  });

  test('matches the generic constructor path for prepared input with open flattened visibility', () => {
    const presortedPaths = sortCanonicalPaths([
      'docs/guide.md',
      'src/components/Button.tsx',
      'src/components/forms/Field.tsx',
      'src/components/forms/utils.ts',
      'src/index.ts',
      'tmp/',
    ]);
    const preparedInput = PathStore.preparePresortedInput(presortedPaths);

    const preparedStore = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      preparedInput,
    });
    const rawStore = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: presortedPaths,
      presorted: true,
    });

    expect(preparedStore.list()).toEqual(rawStore.list());
    expect(preparedStore.getVisibleCount()).toBe(rawStore.getVisibleCount());
    expect(getVisibleRowsSansIds(preparedStore)).toEqual(
      getVisibleRowsSansIds(rawStore)
    );
  });

  test('matches tree-test-data canonical sorting for a representative small fixture', () => {
    const fixture = [
      'README.md',
      'a10.txt',
      'a2.txt',
      'a1.txt',
      'a/',
      'a/file.ts',
      'src/index.ts',
      'src/lib/',
      'src/lib/util10.ts',
      'src/lib/util2.ts',
      'src/Alpha.ts',
      'src/alpha.ts',
      'docs/',
      'docs/guide10.md',
      'docs/guide2.md',
      'tmp/',
      'tmp/10.log',
      'tmp/2.log',
    ];
    const expectedOrder = [
      'a/',
      'a/file.ts',
      'docs/',
      'docs/guide2.md',
      'docs/guide10.md',
      'src/lib/',
      'src/lib/util2.ts',
      'src/lib/util10.ts',
      'src/Alpha.ts',
      'src/alpha.ts',
      'src/index.ts',
      'tmp/',
      'tmp/2.log',
      'tmp/10.log',
      'a1.txt',
      'a2.txt',
      'a10.txt',
      'README.md',
    ];

    expect(sortCanonicalPaths(fixture)).toEqual(expectedOrder);
    expect(PathStore.preparePaths(fixture)).toEqual(expectedOrder);
  });

  test('matches tree-test-data workload presorting for the demo-small fixture', () => {
    const workload = getVirtualizationWorkload('demo-small');

    expect(workload.presortedFiles).toEqual(
      PathStore.preparePaths(workload.files)
    );
  });

  test('defaults to flattened directories and can be disabled', () => {
    expect(
      getVisiblePaths(
        new PathStore({
          initialExpansion: 'open',
          paths: ['src/lib/index.ts'],
        })
      )
    ).toEqual(['src/lib/', 'src/lib/index.ts']);

    expect(
      getVisiblePaths(
        new PathStore({
          flattenEmptyDirectories: false,
          initialExpansion: 'open',
          paths: ['src/lib/index.ts'],
        })
      )
    ).toEqual(['src/', 'src/lib/', 'src/lib/index.ts']);
  });

  test('flattens single-child directory chains when enabled', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: demoSmallPaths,
    });

    expect(store.getVisibleCount()).toBe(15);
    expect(getVisiblePaths(store, 11, 14)).toEqual([
      'beta/keep.txt',
      'gamma/logs/',
      'gamma/logs/today.txt',
      'zeta.md',
    ]);
    expect(getVisibleRowsSansIds(store, 12, 12)).toEqual([
      {
        depth: 0,
        flattenedSegments: [
          {
            isTerminal: false,
            name: 'gamma',
            path: 'gamma/',
          },
          {
            isTerminal: true,
            name: 'logs',
            path: 'gamma/logs/',
          },
        ],
        hasChildren: true,
        isExpanded: true,
        isFlattened: true,
        isLoading: false,
        kind: 'directory',
        name: 'logs',
        path: 'gamma/logs/',
      },
    ]);
    expect(getVisibleRowsSansIds(store, 13, 13)).toEqual([
      {
        depth: 1,
        flattenedSegments: undefined,
        hasChildren: false,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        name: 'today.txt',
        path: 'gamma/logs/today.txt',
      },
    ]);
  });

  test('maximally flattens closed single-child directory chains before any explicit expansion', () => {
    const paths = ['config/project/app.config.json', 'src/index.ts'];
    const stores = [
      new PathStore({
        flattenEmptyDirectories: true,
        paths,
      }),
      new StaticPathStore({
        flattenEmptyDirectories: true,
        paths,
      }),
    ];

    for (const store of stores) {
      expect(getVisiblePaths(store, 0, 9)).toEqual(['config/project/', 'src/']);
      expect(getVisibleRowsSansIds(store, 0, 0)).toEqual([
        {
          depth: 0,
          flattenedSegments: [
            {
              isTerminal: false,
              name: 'config',
              path: 'config/',
            },
            {
              isTerminal: true,
              name: 'project',
              path: 'config/project/',
            },
          ],
          hasChildren: true,
          isExpanded: false,
          isFlattened: true,
          isLoading: false,
          kind: 'directory',
          name: 'project',
          path: 'config/project/',
        },
      ]);

      store.expand('config/project/');
      expect(getVisiblePaths(store, 0, 9)).toEqual([
        'config/project/',
        'config/project/app.config.json',
        'src/',
      ]);
    }
  });

  test('handles empty trees', () => {
    const store = new PathStore();

    expect(store.list()).toEqual([]);
    expect(store.getVisibleCount()).toBe(0);
    expect(store.getVisibleSlice(0, 10)).toEqual([]);
  });

  test('supports initialExpansion: "open" and collapse/expand overrides', () => {
    const store = new PathStore({
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);

    store.collapse('src/');
    expect(getVisiblePaths(store, 0, 9)).toEqual(['src/', 'README.md']);

    store.expand('src/');
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);
  });

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
    expect(store.list('src/')).toEqual([
      'src/components/Button.tsx',
      'src/index.ts',
    ]);
    expect(store.list('tmp')).toEqual(['tmp/']);
    expect(store.list('tmp/')).toEqual(['tmp/']);
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

  test('rejects moving directories into descendants and missing parents', () => {
    const store = new PathStore({
      paths: ['src/index.ts', 'src/components/Button.tsx'],
    });

    expect(() => store.move('src/', 'src/components/')).toThrow(
      'Cannot move a directory into one of its descendants'
    );
    expect(() => store.move('src/index.ts', 'missing/index.ts')).toThrow(
      'Destination parent does not exist'
    );
  });

  test('requires sorted input when presorted is true', () => {
    expect(
      () =>
        new PathStore({
          paths: ['b.ts', 'a.ts'],
          presorted: true,
        })
    ).toThrow('Builder input must be sorted before appendPaths()');
  });

  test('matches repeated single-row reads after traversing out of deep subtrees', () => {
    const flatPaths = createDeepChainPaths(5);
    const nonFlattenedStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: flatPaths,
    });
    const flattenedStore = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: createDeepChainWithSiblingDirectoryPaths(5),
    });
    const staticFlattenedStore = new StaticPathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: createDeepChainWithSiblingDirectoryPaths(5),
    });

    expect(getVisiblePathDepthSnapshot(nonFlattenedStore)).toEqual(
      getVisiblePathDepthSnapshotViaSingleReads(nonFlattenedStore)
    );
    expect(getVisiblePathDepthSnapshot(flattenedStore)).toEqual(
      getVisiblePathDepthSnapshotViaSingleReads(flattenedStore)
    );
    expect(getVisiblePathDepthSnapshot(staticFlattenedStore)).toEqual(
      getVisiblePathDepthSnapshotViaSingleReads(staticFlattenedStore)
    );
  });

  test('preserves expansion state when moving an expanded directory subtree', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
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

  test('ignores unresolved initialExpandedPaths entries without poisoning later valid prefixes', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['a/b/abc.ts', 'a/cab/c'],
      initialExpansion: 'closed',
      paths: ['a/cab/c/c.ts'],
    });

    expect(store.isExpanded('a/')).toBe(true);
    expect(store.isExpanded('a/cab/')).toBe(true);
    expect(store.isExpanded('a/cab/c/')).toBe(true);
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'a/',
      'a/cab/',
      'a/cab/c/',
      'a/cab/c/c.ts',
    ]);
  });

  test('path info resolves canonical directory lookups and initialExpandedPaths expands ancestors', () => {
    const store = new PathStore({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/components'],
      paths: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
    });

    expect(store.getPathInfo('src/components')).toEqual({
      depth: 2,
      kind: 'directory',
      path: 'src/components/',
    });
    expect(store.getPathInfo('src/components/')).toEqual({
      depth: 2,
      kind: 'directory',
      path: 'src/components/',
    });
    expect(store.getPathInfo('README.md')).toEqual({
      depth: 1,
      kind: 'file',
      path: 'README.md',
    });
    expect(store.getPathInfo('missing.ts')).toBeNull();

    expect(store.isExpanded('src/')).toBe(true);
    expect(store.isExpanded('src/components')).toBe(true);
    expect(getVisiblePaths(store, 0, 9)).toEqual([
      'src/',
      'src/components/',
      'src/components/Button.tsx',
      'src/index.ts',
      'README.md',
    ]);
  });
});
