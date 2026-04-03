import { describe, expect, test } from 'bun:test';

import { PathStore } from '../src/index';

const demoSmallPaths = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
];

function createWideRootFilePaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item${index + 1}.ts`);
}

function createWideDirectoryPaths(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `wide/item${index + 1}.ts`
  );
}

function getVisiblePaths(
  store: PathStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
): string[] {
  return store.getVisibleSlice(start, end).map((row) => row.path);
}

function getVisibleRowsSansIds(
  store: PathStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
) {
  return store.getVisibleSlice(start, end).map(({ id: _id, ...row }) => ({
    ...row,
    flattenedSegments: row.flattenedSegments?.map(
      ({ nodeId: _segmentNodeId, ...segment }) => segment
    ),
  }));
}

function getExpandedDirectoryPaths(store: PathStore): string[] {
  const expandedPaths = new Set<string>();

  for (const row of store.getVisibleSlice(
    0,
    Math.max(0, store.getVisibleCount() - 1)
  )) {
    if (row.kind !== 'directory') {
      continue;
    }

    if (row.isFlattened && row.flattenedSegments != null) {
      for (
        let segmentIndex = 0;
        segmentIndex < row.flattenedSegments.length - 1;
        segmentIndex++
      ) {
        const segment = row.flattenedSegments[segmentIndex];
        if (segment != null) {
          expandedPaths.add(segment.path);
        }
      }

      const terminalSegment =
        row.flattenedSegments[row.flattenedSegments.length - 1];
      if (row.isExpanded && terminalSegment != null) {
        expandedPaths.add(terminalSegment.path);
      }
      continue;
    }

    if (row.isExpanded) {
      expandedPaths.add(row.path);
    }
  }

  return [...expandedPaths];
}

function assertMatchesRebuild(
  store: PathStore,
  {
    flattenEmptyDirectories = false,
  }: {
    flattenEmptyDirectories?: boolean;
  } = {}
): void {
  const rebuiltStore = new PathStore({
    flattenEmptyDirectories,
    initialExpandedPaths: getExpandedDirectoryPaths(store),
    paths: store.list(),
    presorted: true,
  });

  expect(rebuiltStore.list()).toEqual(store.list());
  expect(rebuiltStore.getVisibleCount()).toBe(store.getVisibleCount());

  const visibleCount = store.getVisibleCount();
  const windows =
    visibleCount === 0
      ? [{ end: 10, start: 0 }]
      : [
          { end: Math.min(visibleCount - 1, 49), start: 0 },
          {
            end: Math.min(
              visibleCount - 1,
              Math.max(0, Math.floor(visibleCount / 2) + 24)
            ),
            start: Math.max(0, Math.floor(visibleCount / 2) - 25),
          },
          {
            end: visibleCount - 1,
            start: Math.max(0, visibleCount - 50),
          },
        ];

  for (const window of windows) {
    expect(
      getVisibleRowsSansIds(rebuiltStore, window.start, window.end)
    ).toEqual(getVisibleRowsSansIds(store, window.start, window.end));
  }
}

function createDemoSmallStore(): PathStore {
  return new PathStore({
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    paths: demoSmallPaths,
  });
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
});

describe('PathStore', () => {
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

  test('supports nested batches and emits one top-level batch event', () => {
    const store = new PathStore({
      paths: ['src/old.ts', 'tmp/'],
    });
    const events: string[] = [];

    store.on('*', (event) => {
      events.push(event.operation);
    });

    store.batch(() => {
      store.batch(() => {
        store.move('src/old.ts', 'tmp/');
      });
      store.add('src/new.ts');
    });

    expect(events).toEqual(['batch']);
    expect(store.list()).toEqual(['src/new.ts', 'tmp/old.ts']);
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

  test('emits expand and collapse events with affected metadata', () => {
    const store = new PathStore({
      paths: ['src/index.ts', 'src/components/Button.tsx'],
    });
    const events: Array<{
      affectedAncestorIds?: readonly number[];
      affectedNodeIds?: readonly number[];
      operation: string;
      path?: string;
    }> = [];

    store.on('*', (event) => {
      events.push({
        affectedAncestorIds: event.affectedAncestorIds,
        affectedNodeIds: event.affectedNodeIds,
        operation: event.operation,
        path:
          typeof event.changeset?.path === 'string'
            ? event.changeset.path
            : undefined,
      });
    });

    store.expand('src/');
    store.collapse('src/');

    expect(events).toEqual([
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        operation: 'expand',
        path: 'src/',
      },
      {
        affectedAncestorIds: expect.any(Array),
        affectedNodeIds: expect.any(Array),
        operation: 'collapse',
        path: 'src/',
      },
    ]);
    expect(events[0]?.affectedNodeIds).toHaveLength(1);
    expect(events[1]?.affectedNodeIds).toHaveLength(1);
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

  test('splits and rejoins flattened chains when siblings are added and removed', () => {
    const store = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['a/b/c/file.ts'],
    });

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
