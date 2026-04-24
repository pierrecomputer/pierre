import { expect } from 'bun:test';

import { PathStore, StaticPathStore } from '../../src/index';
import type {
  PathStoreCleanupEvent,
  PathStoreEvent,
} from '../../src/public-types';

export const demoSmallPaths = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
];

interface ProjectionReadableStore {
  getVisibleCount(): number;
  getVisibleSlice(
    start: number,
    end: number
  ): readonly {
    depth: number;
    flattenedSegments?: readonly {
      isTerminal: boolean;
      name: string;
      nodeId: number;
      path: string;
    }[];
    hasChildren: boolean;
    id: number;
    isExpanded: boolean;
    isFlattened: boolean;
    isLoading: boolean;
    kind: 'directory' | 'file';
    loadState?: string;
    name: string;
    path: string;
  }[];
}

export function createWideRootFilePaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item${index + 1}.ts`);
}

export function createWideDirectoryPaths(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `wide/item${index + 1}.ts`
  );
}

export function createDeepChainPaths(depth: number): string[] {
  const nestedDirectoryPath = Array.from(
    { length: depth },
    (_, index) => `level${index + 1}`
  ).join('/');
  return [`${nestedDirectoryPath}/leaf.txt`, 'root.txt'];
}

export function createDeepChainWithSiblingDirectoryPaths(
  depth: number
): string[] {
  const nestedDirectoryPath = Array.from(
    { length: depth },
    (_, index) => `level${index + 1}`
  ).join('/');
  return [
    `${nestedDirectoryPath}/leaf.txt`,
    'sibling-folder/child.txt',
    'root.txt',
  ];
}

export function collectWildcardEvents(store: PathStore): PathStoreEvent[] {
  const events: PathStoreEvent[] = [];
  store.on('*', (event) => {
    events.push(event);
  });
  return events;
}

export function getVisiblePaths(
  store: ProjectionReadableStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
): string[] {
  return store.getVisibleSlice(start, end).map((row) => row.path);
}

export function getVisibleRowsSansIds(
  store: ProjectionReadableStore,
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

export function getVisibleRowIdentitySnapshot(
  store: ProjectionReadableStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
) {
  return store.getVisibleSlice(start, end).map((row) => ({
    flattenedSegments: row.flattenedSegments?.map((segment) => ({
      nodeId: segment.nodeId,
      path: segment.path,
    })),
    id: row.id,
    path: row.path,
  }));
}

export function getVisiblePathDepthSnapshot(
  store: ProjectionReadableStore,
  start = 0,
  end = Number.MAX_SAFE_INTEGER
) {
  return store
    .getVisibleSlice(start, end)
    .map((row) => ({ depth: row.depth, path: row.path }));
}

export function getVisiblePathDepthSnapshotViaSingleReads(
  store: ProjectionReadableStore
) {
  const rows: Array<{ depth: number; path: string }> = [];
  for (let index = 0; index < store.getVisibleCount(); index += 1) {
    const row = store.getVisibleSlice(index, index)[0];
    if (row == null) {
      throw new Error(`Missing visible row at index ${String(index)}`);
    }

    rows.push({ depth: row.depth, path: row.path });
  }

  return rows;
}

export function getExpandedDirectoryPaths(store: PathStore): string[] {
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

export function assertMatchesRebuild(
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

export function createDemoSmallStore(): PathStore {
  return new PathStore({
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    paths: demoSmallPaths,
  });
}

export function createStaticDemoSmallStore(): StaticPathStore {
  return new StaticPathStore({
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    paths: demoSmallPaths,
  });
}

// Creates stable cleanup pressure by leaving one real removal plus several
// trailing tombstones and fully materialized path caches.
export function applyCleanupChurn(store: PathStore): string {
  store.list();
  store.getVisibleSlice(0, Math.max(0, store.getVisibleCount() - 1));

  const removedPath = store.list()[0];
  if (removedPath == null) {
    throw new Error('Cleanup churn requires at least one canonical path.');
  }

  store.remove(removedPath, { recursive: removedPath.endsWith('/') });

  for (let index = 0; index < 12; index++) {
    const tempPath = `zzz-cleanup-temp-${index}.ts`;
    store.add(tempPath);
    store.remove(tempPath);
  }

  store.list();
  return removedPath;
}

export function filterCleanupEvents(
  events: readonly PathStoreEvent[]
): PathStoreCleanupEvent[] {
  return events.filter(
    (event): event is PathStoreCleanupEvent => event.operation === 'cleanup'
  );
}
