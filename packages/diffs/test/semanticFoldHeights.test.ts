import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type { ElementContent } from 'hast';

import { CodeView } from '../src/components/CodeView';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES, DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type {
  FileDiffMetadata,
  SemanticDiffFold,
  VirtualFileMetrics,
} from '../src/types';
import { computeEstimatedDiffHeights } from '../src/utils/computeEstimatedDiffHeights';
import {
  getVirtualFileHeaderRegion,
  getVirtualFilePaddingBottom,
} from '../src/utils/computeVirtualFileMetrics';
import {
  createFoldCursor,
  type FoldCursor,
  takeClosedFoldRows,
  takeHiddenRows,
} from '../src/utils/foldCursor';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFileItem,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { assertDefined, contentAST } from './testUtils';
import { createInitializedManager } from './workerPoolHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const metrics: VirtualFileMetrics = {
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

const NONE_OPEN: ReadonlySet<number> = new Set();
const VIEWS: ('split' | 'unified')[] = ['split', 'unified'];

function fold(start: number, end: number): SemanticDiffFold {
  return {
    old: { start, end },
    operations: [0],
    counts: { moved: end - start + 1, edited: 0, removed: 0 },
  };
}

// An 80-line file with three changes far enough apart to land in separate
// hunks: old lines 10-14 removed, old line 40 edited, old lines 60-63
// removed. One fold covers the first removed block and another the middle of
// the last.
function removedBlocksDiff(): FileDiffMetadata {
  const oldLines = Array.from(
    { length: 80 },
    (_, index) => `line ${index + 1}`
  );
  const newLines = oldLines
    .map((line, index) => (index + 1 === 40 ? 'line 40 edited' : line))
    .filter((_, index) => {
      const line = index + 1;
      return !(line >= 10 && line <= 14) && !(line >= 60 && line <= 63);
    });
  const fileDiff = parseDiffFromFile(
    { name: 'removed.txt', contents: `${oldLines.join('\n')}\n` },
    { name: 'removed.txt', contents: `${newLines.join('\n')}\n` }
  );
  fileDiff.semanticOperations = [];
  fileDiff.semanticFolds = [fold(10, 14), fold(61, 62)];
  return fileDiff;
}

// Neither file ends with a newline, and the old file's last two lines are
// gone from the new one. The fold hides the old file's last line.
function foldedFileEndDiff(): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'eof.txt', contents: 'a\nb\nc\nd\nmoved one\nmoved two' },
    { name: 'eof.txt', contents: 'a\nb\nc\nd' }
  );
  fileDiff.semanticOperations = [];
  fileDiff.semanticFolds = [fold(5, 6)];
  return fileDiff;
}

// The rows a rendered column takes up. A gap stands for several rows.
function countRows(content: ElementContent[] | undefined): number {
  let rows = 0;
  for (const node of content ?? []) {
    if (node.type !== 'element') continue;
    const size = node.properties['data-buffer-size'];
    rows += 'data-content-buffer' in node.properties ? Number(size) : 1;
  }
  return rows;
}

// Renders the whole diff with the given folds open, and counts its rows.
async function renderedRowCount(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  openSemanticFolds: ReadonlySet<number>
): Promise<number> {
  const renderer = new DiffHunksRenderer({ diffStyle, expandUnchanged: true });
  await renderer.asyncRender(fileDiff);
  for (const start of openSemanticFolds) {
    renderer.toggleSemanticFold(start);
  }
  const result = await renderer.asyncRender(fileDiff);
  return countRows(
    contentAST(result, diffStyle === 'split' ? 'deletions' : 'unified')
  );
}

function estimatedHeight(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  openSemanticFolds: ReadonlySet<number> | undefined
): number {
  const { splitHeight, unifiedHeight } = computeEstimatedDiffHeights({
    fileDiff,
    metrics,
    disableFileHeader: true,
    hunkSeparators: 'line-info',
    expandUnchanged: true,
    expandedHunks: undefined,
    collapsedContextThreshold: 0,
    canHydratePartialDiff: false,
    openSemanticFolds,
  });
  return diffStyle === 'split' ? splitHeight : unifiedHeight;
}

function heightOfRows(rows: number): number {
  return (
    getVirtualFileHeaderRegion(metrics, true) +
    rows * metrics.lineHeight +
    getVirtualFilePaddingBottom(metrics)
  );
}

// A cursor for a diff that has folds.
function foldCursor(
  diff: FileDiffMetadata,
  openSemanticFolds: ReadonlySet<number>
): FoldCursor {
  const cursor = createFoldCursor(diff, openSemanticFolds);
  assertDefined(cursor, 'the diff should have folds');
  return cursor;
}

describe('fold cursor', () => {
  const diff = removedBlocksDiff();

  test('counts the rows each hunk loses to its closed folds', () => {
    const closed = foldCursor(diff, NONE_OPEN);
    expect(diff.hunks.map((hunk) => takeHiddenRows(closed, hunk))).toEqual([
      4, 0, 1,
    ]);
    expect(closed.index).toBe(2);

    const firstOpen = foldCursor(diff, new Set([10]));
    expect(diff.hunks.map((hunk) => takeHiddenRows(firstOpen, hunk))).toEqual([
      0, 0, 1,
    ]);
  });

  test('there is no cursor without folds or without an open set', () => {
    expect(createFoldCursor(diff, undefined)).toBeUndefined();
    expect(
      createFoldCursor({ ...diff, semanticFolds: undefined }, NONE_OPEN)
    ).toBeUndefined();
  });

  test.each(VIEWS)(
    "finds each closed fold's row among its hunk's rows in the %s view",
    (diffStyle) => {
      // The rows the walk shows for closed folds, by hunk.
      const walked: { row: number; hiddenRows: number }[][] = diff.hunks.map(
        () => []
      );
      iterateOverDiff({
        diff,
        diffStyle,
        openSemanticFolds: NONE_OPEN,
        callback: ({ hunkIndex, hunk, foldRow, deletionLine }) => {
          if (foldRow == null || hunk == null || deletionLine == null) return;
          walked[hunkIndex].push({
            row:
              diffStyle === 'split'
                ? deletionLine.splitLineIndex - hunk.splitLineStart
                : deletionLine.unifiedLineIndex - hunk.unifiedLineStart,
            hiddenRows: foldRow.fold.old.end - foldRow.fold.old.start,
          });
        },
      });
      const cursor = foldCursor(diff, NONE_OPEN);
      expect(
        diff.hunks.map(
          (hunk) => takeClosedFoldRows(cursor, hunk, diffStyle) ?? []
        )
      ).toEqual(walked);
    }
  );

  test("says when a closed fold hides a hunk's last old line", () => {
    const atEnd = foldedFileEndDiff();
    const cursor = foldCursor(atEnd, NONE_OPEN);
    takeHiddenRows(cursor, atEnd.hunks[0]);
    expect(cursor.hidesLastOldLine).toBe(true);

    const open = foldCursor(atEnd, new Set([5]));
    takeHiddenRows(open, atEnd.hunks[0]);
    expect(open.hidesLastOldLine).toBe(false);
  });
});

describe('estimated heights with semantic folds', () => {
  const cases: [string, () => FileDiffMetadata, ReadonlySet<number>][] = [
    ['every fold closed', removedBlocksDiff, NONE_OPEN],
    ['one fold open', removedBlocksDiff, new Set([10])],
    ['every fold open', removedBlocksDiff, new Set([10, 61])],
    [
      "a closed fold over the old file's last line",
      foldedFileEndDiff,
      NONE_OPEN,
    ],
    [
      "an open fold over the old file's last line",
      foldedFileEndDiff,
      new Set([5]),
    ],
  ];

  for (const diffStyle of VIEWS) {
    test.each(cases)(
      `the ${diffStyle} view's height matches the rows drawn with %s`,
      async (_name, createDiff, openSemanticFolds) => {
        const fileDiff = createDiff();
        expect(estimatedHeight(fileDiff, diffStyle, openSemanticFolds)).toBe(
          heightOfRows(
            await renderedRowCount(fileDiff, diffStyle, openSemanticFolds)
          )
        );
      }
    );
  }

  test('leaving the open set out counts every line', () => {
    const fileDiff = removedBlocksDiff();
    for (const diffStyle of VIEWS) {
      expect(estimatedHeight(fileDiff, diffStyle, undefined)).toBe(
        estimatedHeight(fileDiff, diffStyle, new Set([10, 61]))
      );
    }
  });
});

describe('a new diff starts with its folds closed', () => {
  // Old lines 2-4 are gone from the new file, and a fold covers two of them.
  // `suffix` changes the last line, so each call gives a different diff with
  // the same fold.
  function replacementDiff(suffix: string): FileDiffMetadata {
    const fileDiff = parseDiffFromFile(
      {
        name: 'a.ts',
        contents: 'keep\nmoved1\nmoved2\nmoved3\nlast\n',
        cacheKey: 'old',
      },
      { name: 'a.ts', contents: `keep\nlast ${suffix}\n`, cacheKey: suffix }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = [fold(2, 3)];
    return fileDiff;
  }

  test('a virtualized diff that replaces one with an open fold is as tall as its rows', async () => {
    const { lineHeight } = DEFAULT_VIRTUAL_FILE_METRICS;
    const dom = installDom();
    // Every row measures one line high.
    const rects = spyOn(
      Element.prototype,
      'getBoundingClientRect'
    ).mockImplementation(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: lineHeight,
      width: 100,
      height: lineHeight,
      toJSON: () => ({}),
    }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fileContainer = document.createElement('div');
    root.appendChild(fileContainer);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const instance = new VirtualizedFileDiff<undefined>(
      {
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        diffStyle: 'split',
        expandUnchanged: true,
      },
      virtualizer
    );
    const foldRows = () =>
      fileContainer.shadowRoot?.querySelectorAll('[data-semantic-fold]')
        .length ?? 0;
    const lastNewLine = () =>
      fileContainer.shadowRoot?.querySelector(
        '[data-additions] [data-content] > [data-line="2"]'
      )?.textContent;
    try {
      instance.render({
        fileDiff: replacementDiff('A'),
        fileContainer,
        forceRender: true,
      });
      await waitFor(() => foldRows() === 1);
      const closedHeight = instance.getVirtualizedHeight();

      // Open the fold by pressing its row's button.
      fileContainer.shadowRoot
        ?.querySelector('[data-semantic-fold-toggle]')
        ?.dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, composed: true })
        );
      await waitFor(() => foldRows() === 0);

      // The second diff has the same rows as the first had with its fold
      // closed.
      instance.render({ fileDiff: replacementDiff('B'), forceRender: true });
      await waitFor(() => lastNewLine()?.includes('last B') === true);
      await wait(20);
      expect(foldRows()).toBe(1);
      expect(instance.getVirtualizedHeight()).toBe(closedHeight);
    } finally {
      rects.mockRestore();
      instance.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });

  test('a renderer that was cleaned up starts with its folds closed', async () => {
    const renderer = new DiffHunksRenderer({
      diffStyle: 'split',
      expandUnchanged: true,
    });
    const first = replacementDiff('A');
    await renderer.asyncRender(first);
    renderer.toggleSemanticFold(2);
    await renderer.asyncRender(first);
    expect([...renderer.getOpenSemanticFolds()]).toEqual([2]);

    renderer.cleanUp();
    const result = await renderer.asyncRender(replacementDiff('B'));
    expect([...renderer.getOpenSemanticFolds()]).toEqual([]);
    expect(
      (contentAST(result, 'deletions') ?? []).filter(
        (node) =>
          node.type === 'element' && 'data-semantic-fold' in node.properties
      )
    ).toHaveLength(1);
  });

  // The fold rows the CodeView's diff item shows, or undefined while the
  // item is not rendered.
  function foldRowCount(viewer: CodeView<undefined>): number | undefined {
    return viewer
      .getRenderedItems()
      .find((item) => item.id === 'diff')
      ?.element.shadowRoot?.querySelectorAll('[data-semantic-fold]').length;
  }

  // Presses the fold's row, or the open fold's first-line button.
  function pressFoldToggle(viewer: CodeView<undefined>): void {
    viewer
      .getRenderedItems()
      .find((item) => item.id === 'diff')
      ?.element.shadowRoot?.querySelector('[data-semantic-fold-toggle]')
      ?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, composed: true })
      );
  }

  test('a fold opened on the old diff while its replacement highlights does not carry over', async () => {
    const dom = installDom();
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
      preferredHighlighter: 'shiki-js',
    });
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView<undefined>(
      {
        theme: 'pierre-dark',
        disableFileHeader: true,
        expandUnchanged: true,
        diffStyle: 'split',
      },
      manager
    );
    const first = replacementDiff('A');
    const second = replacementDiff('B');
    // Answers the worker's next highlight request with the diff's result.
    const highlight = async (fileDiff: FileDiffMetadata) => {
      const request = await worker.waitForDiffRequest();
      const options = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(fileDiff, highlighter, options),
        options,
        sentAt: Date.now(),
      });
    };
    try {
      viewer.setup(createRoot({ height: 800 }));
      await renderItems(viewer, [
        { id: 'diff', type: 'diff', fileDiff: first, version: 0 },
      ]);
      await highlight(first);
      await waitFor(() => foldRowCount(viewer) === 1);
      viewer.render(true);
      await wait(30);
      const closedScrollHeight = viewer.getScrollHeight();

      // The second diff is asked for, and the first stays on screen while
      // the worker highlights it.
      viewer.setItems([
        { id: 'diff', type: 'diff', fileDiff: second, version: 1 },
      ]);
      viewer.render(true);
      await waitFor(() => worker.diffRequestCount === 2);
      pressFoldToggle(viewer);
      viewer.render(true);
      await waitFor(() => foldRowCount(viewer) === 0);

      // The second diff has the same rows as the first had with its fold
      // closed.
      await highlight(second);
      await wait(40);
      viewer.render(true);
      await wait(40);
      expect(foldRowCount(viewer)).toBe(1);
      expect(viewer.getScrollHeight()).toBe(closedScrollHeight);
    } finally {
      viewer.cleanUp();
      manager.terminate();
      await wait(0);
      dom.cleanup();
    }
  });

  test('an open fold stays open, with its height, after its item scrolls away and back', async () => {
    const dom = installDom();
    const options = {
      disableFileHeader: true,
      expandUnchanged: true,
      diffStyle: 'split' as const,
    };
    const viewer = new CodeView<undefined>(options);
    const root = createRoot({ height: 120 });
    try {
      viewer.setup(root);
      await renderItems(viewer, [
        { id: 'diff', type: 'diff', fileDiff: replacementDiff('A') },
        makeFileItem('spacer', 600),
      ]);
      await waitFor(() => foldRowCount(viewer) === 1);
      pressFoldToggle(viewer);
      viewer.render(true);
      await waitFor(() => foldRowCount(viewer) === 0);

      // Scroll the diff out of view, then change the line height, so its
      // height is worked out again while it is not rendered.
      root.scrollTop = 5000;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => foldRowCount(viewer) === undefined);
      viewer.setOptions({ ...options, itemMetrics: { lineHeight: 21 } });
      viewer.render(true);
      await wait(30);
      const offscreenScrollHeight = viewer.getScrollHeight();

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => foldRowCount(viewer) != null);
      viewer.render(true);
      await wait(50);
      expect(foldRowCount(viewer)).toBe(0);
      expect(viewer.getScrollHeight()).toBe(offscreenScrollHeight);
    } finally {
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });
});

describe('positions around a closed fold', () => {
  const layoutMetrics: VirtualFileMetrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    hunkLineCount: 1,
    lineHeight: 10,
    diffHeaderHeight: 30,
    spacing: 4,
  };
  const { lineHeight, diffHeaderHeight } = layoutMetrics;

  // A 12,000-line file with old lines 100-119 gone and a fold over them, so
  // the closed fold hides 19 rows near the top. Rendered with every
  // unchanged line, it is tall enough to have layout checkpoints after the
  // fold.
  function tallFoldedDiff(): FileDiffMetadata {
    const oldLines = Array.from(
      { length: 12_000 },
      (_, index) => `line ${index + 1}`
    );
    const newLines = oldLines.filter(
      (_, index) => !(index + 1 >= 100 && index + 1 <= 119)
    );
    const fileDiff = parseDiffFromFile(
      { name: 'tall.txt', contents: `${oldLines.join('\n')}\n` },
      { name: 'tall.txt', contents: `${newLines.join('\n')}\n` }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = [fold(100, 119)];
    return fileDiff;
  }

  // The top of the row `rows` rows down from the first.
  const topOfRow = (rows: number) => diffHeaderHeight + rows * lineHeight;

  function layOut(diffStyle: 'split' | 'unified') {
    const dom = installDom();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const instance = new VirtualizedFileDiff<undefined>(
      { diffStyle, expandUnchanged: true },
      virtualizer,
      layoutMetrics
    );
    instance.updateCodeViewLayout(tallFoldedDiff(), 0);
    return {
      instance,
      cleanUp() {
        instance.cleanUp();
        dom.cleanup();
      },
    };
  }

  test.each(VIEWS)(
    'a line the fold hides is at the fold row, in the %s view',
    (diffStyle) => {
      const { instance, cleanUp } = layOut(diffStyle);
      try {
        const foldRow = { top: topOfRow(99), height: lineHeight };
        expect(instance.getLinePosition(99, 'deletions')).toEqual({
          top: topOfRow(98),
          height: lineHeight,
        });
        expect(instance.getLinePosition(100, 'deletions')).toEqual(foldRow);
        expect(instance.getLinePosition(110, 'deletions')).toEqual(foldRow);
        expect(instance.getLinePosition(119, 'deletions')).toEqual(foldRow);
        // The first line after the fold is on the next row.
        expect(instance.getLinePosition(120, 'deletions')).toEqual({
          top: topOfRow(100),
          height: lineHeight,
        });
      } finally {
        cleanUp();
      }
    }
  );

  test.each(VIEWS)(
    'a line far below the fold is found from a checkpoint, in the %s view',
    (diffStyle) => {
      const { instance, cleanUp } = layOut(diffStyle);
      try {
        // New line 10,000 is old line 10,020: 10,000 rows down, with the
        // fold's 19 hidden rows left out.
        expect(instance.getLinePosition(10_000, 'additions')?.top).toBe(
          topOfRow(10_000)
        );
        expect(instance.getLinePosition(10_020, 'deletions')?.top).toBe(
          topOfRow(10_000)
        );
        expect(instance.getNumericScrollAnchor(topOfRow(10_000))).toEqual({
          lineNumber: 10_020,
          side: 'deletions',
          top: topOfRow(10_000),
        });
      } finally {
        cleanUp();
      }
    }
  );

  test.each(VIEWS)(
    "a scroll anchor on the fold's row is the fold's first line, in the %s view",
    (diffStyle) => {
      const { instance, cleanUp } = layOut(diffStyle);
      try {
        expect(instance.getNumericScrollAnchor(topOfRow(99))).toEqual({
          lineNumber: 100,
          side: 'deletions',
          top: topOfRow(99),
        });
        // The row after it is the first line the fold does not hide.
        expect(instance.getNumericScrollAnchor(topOfRow(100))).toEqual({
          lineNumber: 120,
          side: 'deletions',
          top: topOfRow(100),
        });
      } finally {
        cleanUp();
      }
    }
  );
});

describe('collapsed lines after a fold that ends the last hunk', () => {
  const layoutMetrics: VirtualFileMetrics = {
    ...DEFAULT_VIRTUAL_FILE_METRICS,
    hunkLineCount: 1,
    lineHeight: 10,
    diffHeaderHeight: 30,
    spacing: 4,
  };

  // 25 lines with old lines 3-5 gone and no context lines kept, so the only
  // hunk is those three lines and old lines 6-25 are collapsed below it.
  function tailDiff(withFold: boolean): FileDiffMetadata {
    const oldLines = Array.from({ length: 25 }, (_, index) => `${index + 1}`);
    const newLines = oldLines.filter((_, index) => index < 2 || index > 4);
    const fileDiff = parseDiffFromFile(
      { name: 'tail.txt', contents: `${oldLines.join('\n')}\n` },
      { name: 'tail.txt', contents: `${newLines.join('\n')}\n` },
      { context: 0 }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = withFold ? [fold(3, 5)] : undefined;
    return fileDiff;
  }

  test.each(VIEWS)(
    'they resolve to the separator below the fold, in the %s view',
    (diffStyle) => {
      const dom = installDom();
      const root = document.createElement('div');
      document.body.appendChild(root);
      const virtualizer = new Virtualizer();
      virtualizer.setup(root);
      const layOut = (withFold: boolean) => {
        const instance = new VirtualizedFileDiff<undefined>(
          { diffStyle },
          virtualizer,
          layoutMetrics
        );
        instance.updateCodeViewLayout(tailDiff(withFold), 0);
        return instance;
      };
      const folded = layOut(true);
      const unfolded = layOut(false);
      try {
        for (const line of [6, 24, 25]) {
          const expected = unfolded.getLinePosition(line, 'deletions');
          assertDefined(expected, 'the separator should have a position');
          // The fold shows one row where the unfolded hunk shows three.
          expect(folded.getLinePosition(line, 'deletions')).toEqual({
            top: expected.top - 2 * layoutMetrics.lineHeight,
            height: expected.height,
          });
        }
      } finally {
        folded.cleanUp();
        unfolded.cleanUp();
        dom.cleanup();
      }
    }
  );
});

describe('render windows below a closed fold', () => {
  const { lineHeight } = DEFAULT_VIRTUAL_FILE_METRICS;

  // A 12,000-line file with old lines 100-1,100 gone and a fold over them:
  // the closed fold hides 1,000 rows near the top.
  function deepFoldDiff(): FileDiffMetadata {
    const oldLines = Array.from(
      { length: 12_000 },
      (_, index) => `line ${index + 1}`
    );
    const newLines = oldLines.filter(
      (_, index) => !(index + 1 >= 100 && index + 1 <= 1_100)
    );
    const fileDiff = parseDiffFromFile(
      { name: 'deep.ts', contents: `${oldLines.join('\n')}\n` },
      { name: 'deep.ts', contents: `${newLines.join('\n')}\n` }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = [fold(100, 1_100)];
    return fileDiff;
  }

  // The old line numbers the CodeView's diff item has rendered.
  function renderedOldLines(viewer: CodeView<undefined>): number[] {
    const rows =
      viewer
        .getRenderedItems()
        .find((item) => item.id === 'diff')
        ?.element.shadowRoot?.querySelectorAll(
          '[data-deletions] [data-content] > [data-line]'
        ) ?? [];
    return [...rows].map((row) => Number(row.getAttribute('data-line')));
  }

  // Old line 5,000 is 3,999 rows down once the fold's 1,000 rows are left
  // out. Scrolling there must render it, not the line 1,000 rows earlier.
  async function scrollToOldLine5000(
    viewer: CodeView<undefined>,
    root: HTMLElement
  ): Promise<number[]> {
    root.scrollTop = 3_999 * lineHeight;
    dispatchScroll(root);
    viewer.render(true);
    await waitFor(() => renderedOldLines(viewer).includes(5_000));
    return renderedOldLines(viewer);
  }

  const options = {
    theme: 'pierre-dark',
    disableFileHeader: true,
    expandUnchanged: true,
    diffStyle: 'split' as const,
  };

  test('the window at a scroll position holds the lines at that position', async () => {
    const dom = installDom();
    const consoleError = spyOn(console, 'error');
    const viewer = new CodeView<undefined>(options);
    const root = createRoot({ height: 400 });
    try {
      viewer.setup(root);
      await renderItems(viewer, [
        { id: 'diff', type: 'diff', fileDiff: deepFoldDiff() },
      ]);
      await waitFor(() => renderedOldLines(viewer).length > 0);
      const lines = await scrollToOldLine5000(viewer, root);
      expect(lines).toContain(5_000);
      expect(lines).not.toContain(4_000);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });

  test('a plain windowed render holds the lines of the folded window', async () => {
    // The worker pool, which the render options come from, needs a DOM.
    const dom = installDom();
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
      preferredHighlighter: 'shiki-js',
    });
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const fileDiff = deepFoldDiff();
      // Ten rows from row 3,999: old lines 5,000-5,009 with the fold closed,
      // and old lines 4,000-4,009 when every line is counted.
      const renderWindow = (openSemanticFolds?: ReadonlySet<number>) =>
        renderDiffWithHighlighter(
          fileDiff,
          highlighter,
          manager.getDiffRenderOptions(),
          {
            forcePlainText: true,
            startingLine: 3_999,
            totalLines: 10,
            expandedHunks: true,
            openSemanticFolds,
          }
        ).code.deletionLines;

      const folded = renderWindow(NONE_OPEN);
      expect(folded[4_999]).toBeDefined();
      expect(folded[5_008]).toBeDefined();
      expect(folded[3_999]).toBeUndefined();

      const unfolded = renderWindow(undefined);
      expect(unfolded[3_999]).toBeDefined();
      expect(unfolded[4_999]).toBeUndefined();
    } finally {
      manager.terminate();
      await wait(0);
      dom.cleanup();
    }
  });
});

describe('toggling a fold in a virtualized view', () => {
  const { lineHeight } = DEFAULT_VIRTUAL_FILE_METRICS;

  // Old lines 2-4 are gone from the new file and one fold covers them, so
  // the closed fold hides two rows.
  function toggleDiff(): FileDiffMetadata {
    const fileDiff = parseDiffFromFile(
      { name: 'a.txt', contents: 'keep\nmoved1\nmoved2\nmoved3\nlast\n' },
      { name: 'a.txt', contents: 'keep\nlast\n' }
    );
    fileDiff.semanticOperations = [];
    fileDiff.semanticFolds = [fold(2, 4)];
    return fileDiff;
  }

  function pressToggle(shadowRoot: ShadowRoot | null | undefined): void {
    shadowRoot
      ?.querySelector('[data-semantic-fold-toggle]')
      ?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, composed: true })
      );
  }

  test('the Virtualizer follows the fold, and forgets what its lines measured', async () => {
    const dom = installDom();
    // Every row measures one line high, except the one holding "moved2",
    // which measures two.
    const rects = spyOn(
      Element.prototype,
      'getBoundingClientRect'
    ).mockImplementation(function (this: Element) {
      const height =
        this instanceof HTMLElement &&
        this.dataset.lineIndex != null &&
        this.textContent?.includes('moved2') === true
          ? lineHeight * 2
          : lineHeight;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: height,
        width: 100,
        height,
        toJSON: () => ({}),
      };
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fileContainer = document.createElement('div');
    root.appendChild(fileContainer);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const instance = new VirtualizedFileDiff<undefined>(
      {
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        diffStyle: 'split',
        expandUnchanged: true,
        // Rows are only measured when they can wrap.
        overflow: 'wrap',
      },
      virtualizer
    );
    const foldRows = () =>
      fileContainer.shadowRoot?.querySelectorAll('[data-semantic-fold]')
        .length ?? 0;
    const settle = async () => {
      await wait(20);
      instance.reconcileHeights();
      return instance.getVirtualizedHeight();
    };
    try {
      instance.render({
        fileDiff: toggleDiff(),
        fileContainer,
        forceRender: true,
      });
      await waitFor(() => foldRows() === 1);
      const closedHeight = await settle();

      pressToggle(fileContainer.shadowRoot);
      await waitFor(() => foldRows() === 0);
      // Two more rows show, and one of them is two lines high.
      expect(await settle()).toBe(closedHeight + 3 * lineHeight);

      pressToggle(fileContainer.shadowRoot);
      await waitFor(() => foldRows() === 1);
      expect(await settle()).toBe(closedHeight);
    } finally {
      rects.mockRestore();
      instance.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });

  test('CodeView follows the fold and keeps its scroll position', async () => {
    const dom = installDom();
    const viewer = new CodeView<undefined>({
      disableFileHeader: true,
      expandUnchanged: true,
      diffStyle: 'split',
    });
    const root = createRoot({ height: 120 });
    const diffShadowRoot = () =>
      viewer.getRenderedItems().find((item) => item.id === 'diff')?.element
        .shadowRoot;
    const foldRows = () =>
      diffShadowRoot()?.querySelectorAll('[data-semantic-fold]').length;
    try {
      viewer.setup(root);
      await renderItems(viewer, [
        makeFileItem('above', 30),
        { id: 'diff', type: 'diff', fileDiff: toggleDiff() },
        makeFileItem('below', 600),
      ]);
      // Bring the diff into view, below a file that is taller than the root.
      root.scrollTop = 30 * lineHeight;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => foldRows() === 1);
      viewer.render(true);
      await wait(30);
      const closedScrollHeight = viewer.getScrollHeight();
      const { scrollTop } = root;

      pressToggle(diffShadowRoot());
      viewer.render(true);
      await waitFor(() => foldRows() === 0);
      viewer.render(true);
      await wait(30);
      expect(viewer.getScrollHeight()).toBe(
        closedScrollHeight + 2 * lineHeight
      );
      expect(root.scrollTop).toBe(scrollTop);

      pressToggle(diffShadowRoot());
      viewer.render(true);
      await waitFor(() => foldRows() === 1);
      viewer.render(true);
      await wait(30);
      expect(viewer.getScrollHeight()).toBe(closedScrollHeight);
      expect(root.scrollTop).toBe(scrollTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });
});
