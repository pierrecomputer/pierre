import { afterAll, describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { DEFAULT_THEMES, DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { FoldManager } from '../src/managers/FoldManager';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type {
  FileContents,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../src/types';
import { linesFromFileContents } from '../src/utils/computeFileOffsets';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { installDom, waitFor } from './domHarness';

const metrics: VirtualFileMetrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

interface InspectableVirtualizedFile {
  cache: {
    heights: Map<number, number>;
    checkpoints: unknown[];
    fileAnnotationHeight: number;
  };
  editorFoldedLineIndex: {
    isHidden(lineIndex: number): boolean;
  };
  fileRenderer: {
    renderCache?: { result?: { code: unknown[] } };
    renderFile(
      file: FileContents,
      renderRange: RenderRange
    ): { rowCount: number } | undefined;
  };
  renderRange: RenderRange | undefined;
  computeApproximateSize(force?: boolean): void;
  computeRenderRangeFromWindow(
    file: FileContents,
    fileTop: number,
    window: RenderWindow
  ): RenderRange;
}

afterAll(async () => {
  await disposeHighlighter();
});

function inspect(instance: VirtualizedFile): InspectableVirtualizedFile {
  return instance as unknown as InspectableVirtualizedFile;
}

function createFile(lineCount: number): FileContents {
  return {
    name: 'folded.ts',
    contents: Array.from(
      { length: lineCount },
      (_, lineIndex) => `line ${lineIndex + 1}`
    ).join('\n'),
  };
}

function createVirtualizer(layoutChanges: boolean[]) {
  return {
    type: 'simple',
    config: {},
    connect() {},
    disconnect() {},
    getWindowSpecs() {
      return { top: 0, bottom: 1_000 };
    },
    getOffsetInScrollContainer() {
      return 0;
    },
    instanceChanged(_instance: unknown, layoutChanged: boolean) {
      layoutChanges.push(layoutChanged);
    },
    isInstanceVisible() {
      return true;
    },
    markDOMDirty() {},
    requestHeightReconcile() {},
  } as never;
}

describe('VirtualizedFile editor folding', () => {
  test('removes hidden rows from geometry and invalidates layout on toggles', () => {
    const layoutChanges: boolean[] = [];
    const file = createFile(20);
    const instance = new VirtualizedFile(
      {},
      createVirtualizer(layoutChanges),
      metrics
    );
    instance.updateCodeViewLayout(file, 0);

    expect(instance.getVirtualizedHeight()).toBe(234);

    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(instance.getVirtualizedHeight()).toBe(184);
    expect(instance.getLineHeight(3)).toBe(0);
    expect(instance.getLinePosition(4)).toEqual({ top: 60, height: 0 });
    expect(instance.getLinePosition(9)).toEqual({ top: 60, height: 10 });
    expect(layoutChanges).toEqual([true]);

    instance.__setFoldRanges([]);

    expect(instance.getVirtualizedHeight()).toBe(234);
    expect(instance.getLinePosition(9)).toEqual({ top: 110, height: 10 });
    expect(layoutChanges).toEqual([true, true]);

    instance.__setFoldRanges([]);
    expect(layoutChanges).toEqual([true, true]);
  });

  test('maps uniform-height windows through visible indexes to raw lines', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile({}, createVirtualizer([]), metrics);
    instance.updateCodeViewLayout(file, 0);
    instance.__setFoldRanges([{ startLine: 2, endLine: 11 }]);

    const range = inspect(instance).computeRenderRangeFromWindow(file, 0, {
      top: 80,
      bottom: 90,
    });

    expect(range).toEqual({
      startingLine: 12,
      totalLines: 4,
      bufferBefore: 20,
      bufferAfter: 40,
    });

    inspect(instance).renderRange = range;
    expect(instance.getNumericScrollAnchor(51)).toEqual({
      lineNumber: 14,
      top: 60,
    });
  });

  test('gives folded rows zero height in variable-height layout', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      createVirtualizer([]),
      metrics
    );
    instance.updateCodeViewLayout(file, 0);
    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(instance.getVirtualizedHeight()).toBe(184);
    expect(instance.getLinePosition(6)).toEqual({ top: 60, height: 0 });
    expect(instance.getLinePosition(9)).toEqual({ top: 60, height: 10 });
  });

  test('preserves measured heights while rebuilding folded layout', () => {
    const file = createFile(20);
    const instance = new VirtualizedFile(
      { overflow: 'wrap' },
      createVirtualizer([]),
      metrics
    );
    instance.updateCodeViewLayout(file, 0);
    const layout = inspect(instance);
    layout.cache.heights.set(8, 25);
    layout.cache.fileAnnotationHeight = 12;

    instance.__setFoldRanges([{ startLine: 3, endLine: 7 }]);

    expect(layout.cache.heights.get(8)).toBe(25);
    expect(layout.cache.fileAnnotationHeight).toBe(12);
    expect(instance.getVirtualizedHeight()).toBe(211);
  });

  test('jumps large folded bodies in layout and plain render windows', async () => {
    const lineCount = 20_000;
    const file = createFile(lineCount);
    const renderOptions = {
      theme: DEFAULT_THEMES,
      useTokenTransformer: false,
      tokenizeMaxLineLength: 1_000,
    };
    const workerManager = {
      highlighter: await getSharedHighlighter({
        themes: Object.values(DEFAULT_THEMES),
        langs: ['text'],
      }),
      renderOptions,
      getPlainFileAST: WorkerPoolManager.prototype.getPlainFileAST,
      getFileRenderOptions: () => renderOptions,
      getFileResultCache: () => undefined,
      isWorkingPool: () => true,
      subscribeToThemeChanges() {},
    } as unknown as WorkerPoolManager;
    const instance = new VirtualizedFile(
      { overflow: 'wrap', tokenizeMaxLength: 1 },
      createVirtualizer([]),
      metrics,
      workerManager
    );
    instance.updateCodeViewLayout(file, 0);
    instance.__setFoldRanges([{ startLine: 1, endLine: 19_990 }]);

    const layout = inspect(instance);
    const originalIsHidden = layout.editorFoldedLineIndex.isHidden.bind(
      layout.editorFoldedLineIndex
    );
    let hiddenChecks = 0;
    layout.editorFoldedLineIndex.isHidden = (lineIndex) => {
      hiddenChecks++;
      return originalIsHidden(lineIndex);
    };

    layout.computeApproximateSize(true);

    expect(instance.getVirtualizedHeight()).toBe(134);
    expect(hiddenChecks).toBe(0);

    expect(instance.getLinePosition(15_000)).toEqual({
      top: 40,
      height: 0,
    });
    expect(hiddenChecks).toBe(1);

    hiddenChecks = 0;
    const range = layout.computeRenderRangeFromWindow(file, 0, {
      top: 40,
      bottom: 60,
    });
    expect(range).toEqual({
      startingLine: 0,
      totalLines: 19_994,
      bufferBefore: 0,
      bufferAfter: 60,
    });
    expect(hiddenChecks).toBeLessThan(10);

    const result = layout.fileRenderer.renderFile(file, range);
    const code = layout.fileRenderer.renderCache?.result?.code;
    expect(result?.rowCount).toBe(4);
    expect(Object.keys(code ?? [])).toEqual(['0', '19991', '19992', '19993']);

    hiddenChecks = 0;
    layout.renderRange = {
      startingLine: 0,
      totalLines: lineCount,
      bufferBefore: 0,
      bufferAfter: 0,
    };
    expect(instance.getNumericScrollAnchor(50)).toEqual({
      lineNumber: 19_993,
      top: 50,
    });
    expect(hiddenChecks).toBe(0);

    instance.__setFoldRanges([]);
    const unfoldedResult = layout.fileRenderer.renderFile(file, range);
    const unfoldedCode = layout.fileRenderer.renderCache?.result?.code;
    expect(unfoldedResult?.rowCount).toBe(19_994);
    expect(unfoldedCode?.[1]).toBeDefined();
    expect(unfoldedCode?.[19_993]).toBeDefined();
  });
});

// Protected read-only fold state, reached the way the FoldManager's click
// handler reaches it.
interface ReadOnlyFoldingInternals {
  foldManager: FoldManager;
  foldRanges: { startLine: number; endLine: number }[];
  toggleFold(startLine: number, restoreFocus?: boolean): void;
}

function readOnlyFolding(instance: VirtualizedFile): ReadOnlyFoldingInternals {
  return instance as unknown as ReadOnlyFoldingInternals;
}

// Line 0 folds lines 1-5; the closing brace on line 6 stays visible.
const FOLDABLE_CONTENTS = [
  'function outer() {',
  '  const before = 1;',
  '  if (before) {',
  '    console.log(before);',
  '  }',
  '  return before;',
  '}',
  'const after = true;',
].join('\n');

describe('VirtualizedFile read-only folding', () => {
  // Header, 8 rows of 10px, and bottom spacing.
  const unfoldedHeight = 30 + 80 + 4;
  const foldedHeight = unfoldedHeight - 50;

  test('drops folds when a different file is laid out', () => {
    const instance = new VirtualizedFile({}, createVirtualizer([]), metrics);
    instance.updateCodeViewLayout(
      { name: 'a.ts', contents: FOLDABLE_CONTENTS },
      0
    );
    readOnlyFolding(instance).toggleFold(0);
    expect(instance.getVirtualizedHeight()).toBe(foldedHeight);

    instance.updateCodeViewLayout(
      { name: 'b.ts', contents: FOLDABLE_CONTENTS },
      0
    );

    expect(readOnlyFolding(instance).foldManager.hasFolds()).toBe(false);
    expect(readOnlyFolding(instance).foldRanges).toEqual([]);
    expect(instance.getVirtualizedHeight()).toBe(unfoldedHeight);
  });

  test('applies fold state to the layout it computes', () => {
    const file = { name: 'a.ts', contents: FOLDABLE_CONTENTS };
    const instance = new VirtualizedFile({}, createVirtualizer([]), metrics);
    instance.updateCodeViewLayout(file, 0);
    expect(instance.getVirtualizedHeight()).toBe(unfoldedHeight);

    // Fold state that changed outside a toggle must reach layout before the
    // rows are measured, not only the render that follows it.
    readOnlyFolding(instance).foldManager.toggleFold(
      0,
      file,
      linesFromFileContents(file.contents)
    );
    instance.updateCodeViewLayout(file, 0);

    expect(readOnlyFolding(instance).foldRanges).toEqual([
      { startLine: 1, endLine: 5 },
    ]);
    expect(instance.getVirtualizedHeight()).toBe(foldedHeight);
  });

  test('unfolds a line revealed as a scroll target', () => {
    const layoutChanges: boolean[] = [];
    const instance = new VirtualizedFile(
      {},
      createVirtualizer(layoutChanges),
      metrics
    );
    instance.updateCodeViewLayout(
      { name: 'a.ts', contents: FOLDABLE_CONTENTS },
      0
    );
    readOnlyFolding(instance).toggleFold(0);
    expect(instance.getLinePosition(4)?.height).toBe(0);

    expect(instance.revealLine(4)).toBe(true);

    expect(instance.getLinePosition(4)).toEqual({ top: 60, height: 10 });
    expect(instance.getVirtualizedHeight()).toBe(unfoldedHeight);
    expect(layoutChanges.at(-1)).toBe(true);
    expect(instance.revealLine(4)).toBe(false);
  });

  test('treats the folding option as a layout option', () => {
    const layoutChanges: boolean[] = [];
    const instance = new VirtualizedFile(
      {},
      createVirtualizer(layoutChanges),
      metrics
    );
    instance.updateCodeViewLayout(
      { name: 'a.ts', contents: FOLDABLE_CONTENTS },
      0
    );

    instance.setOptions({ folding: false });

    expect(layoutChanges).toEqual([true]);
  });

  test('restores keyboard focus after the deferred fold render', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const instance = new VirtualizedFile(
      { disableFileHeader: true, theme: DEFAULT_THEMES },
      createVirtualizer([]),
      metrics
    );
    try {
      const file = { name: 'a.ts', contents: FOLDABLE_CONTENTS };
      instance.render({ file, fileContainer: container });
      const toggle = (): HTMLButtonElement | null | undefined =>
        container.shadowRoot?.querySelector<HTMLButtonElement>(
          '[data-column-number="1"] [data-fold-toggle]'
        );
      await waitFor(() => toggle() != null, { timeout: 3000 });

      readOnlyFolding(instance).toggleFold(0, true);
      // The virtualizer renders the folded rows on its next frame.
      instance.onRender(true);

      const rerenderedToggle = toggle();
      expect(rerenderedToggle?.hasAttribute('data-folded')).toBe(true);
      expect(container.shadowRoot?.activeElement).toBe(rerenderedToggle);
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });
});

describe('FileRenderer windowed plain text', () => {
  test('does not reuse a plain-text window for another range while themes load', async () => {
    await getSharedHighlighter({
      themes: Object.values(DEFAULT_THEMES),
      langs: ['text'],
    });
    let onHighlight: () => void = () => {};
    const highlighted = new Promise<void>((resolve) => {
      onHighlight = resolve;
    });
    // A one-character tokenize limit renders every file as plain text.
    const renderer = new FileRenderer(
      { theme: DEFAULT_THEMES, tokenizeMaxLength: 1 },
      undefined,
      () => onHighlight()
    );
    const file = createFile(100);
    const firstRange = {
      startingLine: 0,
      totalLines: 10,
      bufferBefore: 0,
      bufferAfter: 900,
    };
    const scrolledRange = {
      startingLine: 50,
      totalLines: 10,
      bufferBefore: 500,
      bufferAfter: 400,
    };
    expect(renderer.renderFile(file, firstRange)?.rowCount).toBe(10);

    renderer.setOptions({ ...renderer.options, theme: 'vitesse-dark' });

    // The cached window only has rows 0-9 and the new theme isn't loaded, so
    // there is nothing to render until the highlight lands.
    expect(renderer.renderFile(file, scrolledRange)).toBeUndefined();
    await highlighted;
    expect(renderer.renderFile(file, scrolledRange)?.rowCount).toBe(10);
  });
});
