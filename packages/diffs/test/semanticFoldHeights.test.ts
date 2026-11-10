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
