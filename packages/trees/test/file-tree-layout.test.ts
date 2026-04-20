import { describe, expect, test } from 'bun:test';

import {
  computeFileTreeLayout,
  type FileTreeLayoutRow,
} from '../src/model/fileTreeLayout';

function directoryRow(
  path: string,
  ancestorPaths: readonly string[],
  isExpanded: boolean = true
): FileTreeLayoutRow {
  return {
    ancestorPaths,
    isExpanded,
    kind: 'directory',
    path,
  };
}

function fileRow(
  path: string,
  ancestorPaths: readonly string[]
): FileTreeLayoutRow {
  return {
    ancestorPaths,
    isExpanded: false,
    kind: 'file',
    path,
  };
}

function summarizeLayout(
  rows: readonly FileTreeLayoutRow[],
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  overscan: number
) {
  const snapshot = computeFileTreeLayout(rows, {
    itemHeight,
    overscan,
    scrollTop,
    viewportHeight,
  });

  return {
    occlusion: snapshot.occlusion,
    projected: snapshot.projected,
    scrollTop: snapshot.physical.scrollTop,
    sticky: snapshot.sticky.rows.map((entry) => ({
      path: entry.row.path,
      top: entry.top,
    })),
    stickyHeight: snapshot.sticky.height,
    visible: snapshot.visible,
    window: snapshot.window,
  };
}

const EXHAUSTIVE_CHAIN_ROWS = [
  directoryRow('a/', []),
  directoryRow('a/b/', ['a/']),
  directoryRow('a/b/c/', ['a/', 'a/b/']),
  fileRow('a/b/c/d.js', ['a/', 'a/b/', 'a/b/c/']),
  fileRow('z.ts', []),
] as const;

const DEEP_CHAIN_ROWS = [
  directoryRow('a/', []),
  directoryRow('a/b/', ['a/']),
  directoryRow('a/b/c/', ['a/', 'a/b/']),
  directoryRow('a/b/c/d/', ['a/', 'a/b/', 'a/b/c/']),
  directoryRow('a/b/c/d/e/', ['a/', 'a/b/', 'a/b/c/', 'a/b/c/d/']),
  fileRow('a/b/c/d/e/file.ts', [
    'a/',
    'a/b/',
    'a/b/c/',
    'a/b/c/d/',
    'a/b/c/d/e/',
  ]),
  fileRow('z.ts', []),
] as const;

const SUBTREE_HANDOFF_ROWS = [
  directoryRow('arch/', []),
  directoryRow('arch/alpha/', ['arch/']),
  directoryRow('arch/alpha/boot/', ['arch/', 'arch/alpha/']),
  directoryRow('arch/alpha/boot/tools/', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
  ]),
  fileRow('arch/alpha/boot/tools/mkbb.c', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
    'arch/alpha/boot/tools/',
  ]),
  fileRow('arch/alpha/boot/tools/objstrip.c', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
    'arch/alpha/boot/tools/',
  ]),
  fileRow('arch/alpha/boot/bootloader.lds', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
  ]),
  fileRow('arch/alpha/boot/bootp.c', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
  ]),
  fileRow('arch/alpha/boot/head.S', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
  ]),
  fileRow('arch/alpha/boot/main.c', [
    'arch/',
    'arch/alpha/',
    'arch/alpha/boot/',
  ]),
] as const;

describe('file-tree layout engine', () => {
  test('matches the full layout snapshot at every scroll pixel for a tiny chain fixture', () => {
    const summaries = Array.from({ length: 7 }, (_unused, scrollTop) =>
      summarizeLayout(EXHAUSTIVE_CHAIN_ROWS, scrollTop, 4, 2, 1)
    );

    expect(summaries).toEqual([
      {
        occlusion: {
          firstOccludedIndex: -1,
          lastOccludedIndex: -1,
          occludedCount: 0,
        },
        projected: {
          contentHeight: 10,
          paneHeight: 4,
          paneTop: 0,
        },
        scrollTop: 0,
        sticky: [],
        stickyHeight: 0,
        visible: {
          endIndex: 1,
          startIndex: 0,
        },
        window: {
          endIndex: 2,
          height: 6,
          offsetTop: 0,
          startIndex: 0,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 0,
          lastOccludedIndex: 2,
          occludedCount: 3,
        },
        projected: {
          contentHeight: 3,
          paneHeight: 0,
          paneTop: 7,
        },
        scrollTop: 1,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 2 },
          { path: 'a/b/c/', top: 4 },
        ],
        stickyHeight: 6,
        visible: {
          endIndex: -1,
          startIndex: -1,
        },
        window: {
          endIndex: -1,
          height: 0,
          offsetTop: 0,
          startIndex: -1,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 1,
          lastOccludedIndex: 3,
          occludedCount: 3,
        },
        projected: {
          contentHeight: 2,
          paneHeight: 0,
          paneTop: 8,
        },
        scrollTop: 2,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 2 },
          { path: 'a/b/c/', top: 4 },
        ],
        stickyHeight: 6,
        visible: {
          endIndex: -1,
          startIndex: -1,
        },
        window: {
          endIndex: -1,
          height: 0,
          offsetTop: 0,
          startIndex: -1,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 1,
          lastOccludedIndex: 3,
          occludedCount: 3,
        },
        projected: {
          contentHeight: 2,
          paneHeight: 0,
          paneTop: 8,
        },
        scrollTop: 3,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 2 },
          { path: 'a/b/c/', top: 3 },
        ],
        stickyHeight: 5,
        visible: {
          endIndex: -1,
          startIndex: -1,
        },
        window: {
          endIndex: -1,
          height: 0,
          offsetTop: 0,
          startIndex: -1,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 2,
          lastOccludedIndex: 3,
          occludedCount: 2,
        },
        projected: {
          contentHeight: 2,
          paneHeight: 0,
          paneTop: 8,
        },
        scrollTop: 4,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 2 },
          { path: 'a/b/c/', top: 2 },
        ],
        stickyHeight: 4,
        visible: {
          endIndex: -1,
          startIndex: -1,
        },
        window: {
          endIndex: -1,
          height: 0,
          offsetTop: 0,
          startIndex: -1,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 2,
          lastOccludedIndex: 3,
          occludedCount: 2,
        },
        projected: {
          contentHeight: 2,
          paneHeight: 1,
          paneTop: 8,
        },
        scrollTop: 5,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 1 },
          { path: 'a/b/c/', top: 1 },
        ],
        stickyHeight: 3,
        visible: {
          endIndex: 4,
          startIndex: 4,
        },
        window: {
          endIndex: 4,
          height: 2,
          offsetTop: 8,
          startIndex: 4,
        },
      },
      {
        occlusion: {
          firstOccludedIndex: 3,
          lastOccludedIndex: 3,
          occludedCount: 1,
        },
        projected: {
          contentHeight: 2,
          paneHeight: 2,
          paneTop: 8,
        },
        scrollTop: 6,
        sticky: [
          { path: 'a/', top: 0 },
          { path: 'a/b/', top: 0 },
          { path: 'a/b/c/', top: 0 },
        ],
        stickyHeight: 2,
        visible: {
          endIndex: 4,
          startIndex: 4,
        },
        window: {
          endIndex: 4,
          height: 2,
          offsetTop: 8,
          startIndex: 4,
        },
      },
    ]);
  });

  test('allows a deep leading folder chain to fill more than the physical viewport', () => {
    const snapshot = computeFileTreeLayout(DEEP_CHAIN_ROWS, {
      itemHeight: 30,
      overscan: 2,
      scrollTop: 1,
      viewportHeight: 120,
    });

    expect(snapshot.sticky.rows.map((entry) => entry.row.path)).toEqual([
      'a/',
      'a/b/',
      'a/b/c/',
      'a/b/c/d/',
      'a/b/c/d/e/',
    ]);
    expect(snapshot.sticky.height).toBe(150);
    expect(snapshot.projected.paneHeight).toBe(0);
    expect(snapshot.visible).toEqual({ endIndex: -1, startIndex: -1 });
    expect(snapshot.window).toEqual({
      endIndex: -1,
      height: 0,
      offsetTop: 0,
      startIndex: -1,
    });
  });

  test('pushes a deep sticky folder upward while the next row outside its subtree reaches the slot', () => {
    const beforeHandoff = computeFileTreeLayout(SUBTREE_HANDOFF_ROWS, {
      itemHeight: 30,
      overscan: 2,
      scrollTop: 59,
      viewportHeight: 180,
    });
    const atBoundary = computeFileTreeLayout(SUBTREE_HANDOFF_ROWS, {
      itemHeight: 30,
      overscan: 2,
      scrollTop: 60,
      viewportHeight: 180,
    });
    const afterHandoff = computeFileTreeLayout(SUBTREE_HANDOFF_ROWS, {
      itemHeight: 30,
      overscan: 2,
      scrollTop: 61,
      viewportHeight: 180,
    });

    expect(beforeHandoff.sticky.rows).toEqual([
      { row: SUBTREE_HANDOFF_ROWS[0], top: 0 },
      { row: SUBTREE_HANDOFF_ROWS[1], top: 30 },
      { row: SUBTREE_HANDOFF_ROWS[2], top: 60 },
      { row: SUBTREE_HANDOFF_ROWS[3], top: 90 },
    ]);
    expect(beforeHandoff.projected).toEqual({
      contentHeight: 121,
      paneHeight: 60,
      paneTop: 179,
    });
    expect(beforeHandoff.occlusion).toEqual({
      firstOccludedIndex: 1,
      lastOccludedIndex: 4,
      occludedCount: 4,
    });
    expect(beforeHandoff.visible).toEqual({ endIndex: 7, startIndex: 5 });

    expect(atBoundary.sticky.rows).toEqual([
      { row: SUBTREE_HANDOFF_ROWS[0], top: 0 },
      { row: SUBTREE_HANDOFF_ROWS[1], top: 30 },
      { row: SUBTREE_HANDOFF_ROWS[2], top: 60 },
      { row: SUBTREE_HANDOFF_ROWS[3], top: 90 },
    ]);
    expect(atBoundary.projected).toEqual({
      contentHeight: 120,
      paneHeight: 60,
      paneTop: 180,
    });
    expect(atBoundary.occlusion).toEqual({
      firstOccludedIndex: 2,
      lastOccludedIndex: 5,
      occludedCount: 4,
    });
    expect(atBoundary.visible).toEqual({ endIndex: 7, startIndex: 6 });

    expect(afterHandoff.sticky.rows).toEqual([
      { row: SUBTREE_HANDOFF_ROWS[0], top: 0 },
      { row: SUBTREE_HANDOFF_ROWS[1], top: 30 },
      { row: SUBTREE_HANDOFF_ROWS[2], top: 60 },
      { row: SUBTREE_HANDOFF_ROWS[3], top: 89 },
    ]);
    expect(afterHandoff.sticky.height).toBe(119);
    expect(afterHandoff.projected).toEqual({
      contentHeight: 120,
      paneHeight: 61,
      paneTop: 180,
    });
    expect(afterHandoff.occlusion).toEqual({
      firstOccludedIndex: 2,
      lastOccludedIndex: 5,
      occludedCount: 4,
    });
    expect(afterHandoff.visible).toEqual({ endIndex: 8, startIndex: 6 });
  });

  test('never sticks a collapsed directory and keeps physical metrics separate from the projected pane', () => {
    const rows = [
      directoryRow('src/', [], false),
      fileRow('src/lib/util.ts', ['src/']),
      fileRow('z.ts', []),
    ] as const;

    const collapsedSnapshot = computeFileTreeLayout(rows, {
      itemHeight: 30,
      overscan: 1,
      scrollTop: 1,
      viewportHeight: 60,
    });
    expect(collapsedSnapshot.sticky.rows).toEqual([]);

    const expandedRows = [
      directoryRow('src/', []),
      directoryRow('src/lib/', ['src/']),
      fileRow('src/lib/util.ts', ['src/', 'src/lib/']),
      fileRow('z.ts', []),
    ] as const;
    const expandedSnapshot = computeFileTreeLayout(expandedRows, {
      itemHeight: 30,
      overscan: 1,
      scrollTop: 30,
      viewportHeight: 60,
    });

    expect(expandedSnapshot.physical.viewportHeight).toBe(60);
    expect(expandedSnapshot.projected.paneHeight).toBe(0);
    expect(expandedSnapshot.projected.paneTop).toBe(90);
    expect(expandedSnapshot.sticky.rows).toEqual([
      { row: expandedRows[0], top: 0 },
      { row: expandedRows[1], top: 30 },
    ]);
  });

  test('never includes sticky rows in the mounted list window at any tested scroll pixel', () => {
    const totalHeight = SUBTREE_HANDOFF_ROWS.length * 30;
    const maxScrollTop = totalHeight - 180;

    for (let scrollTop = 0; scrollTop <= maxScrollTop; scrollTop += 1) {
      const snapshot = computeFileTreeLayout(SUBTREE_HANDOFF_ROWS, {
        itemHeight: 30,
        overscan: 3,
        scrollTop,
        viewportHeight: 180,
      });
      const stickyPathSet = new Set(
        snapshot.sticky.rows.map((entry) => entry.row.path)
      );
      const mountedRows =
        snapshot.window.startIndex < 0 ||
        snapshot.window.endIndex < snapshot.window.startIndex
          ? []
          : SUBTREE_HANDOFF_ROWS.slice(
              snapshot.window.startIndex,
              snapshot.window.endIndex + 1
            );

      expect(
        mountedRows.every((row) => !stickyPathSet.has(row.path))
      ).toBeTrue();
    }
  });
});
